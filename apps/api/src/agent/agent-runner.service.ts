/**
 * AgentRunnerService — feat-300.3 任务 6（核心）
 *
 * ReAct 主循环编排：
 *   1. 鉴权 + 加载 settings / memory / platform_rules
 *   2. 创建 generations + agent_runs 记录
 *   3. 构造 LLM model + embedding client + tools
 *   4. ContextManager 预压缩
 *   5. ai-sdk generateText(maxSteps, onStepFinish)
 *      每步：duration / 入库 agent_steps / SSE 推流 / 累计 cost / budget 闸门
 *   6. 收尾：success / budget / max_steps / aborted / error 分别走对应路径
 *
 * 设计参考 docs/agent/feat-300.3-plan.md §3.1-3.10 的全部决策点。
 *
 * **pgClient 生命周期**（feat-300.3-plan §3.6 决策）：
 *   Controller 用 DbService.withClient 包整个 run，pgClient 作为参数传入。
 *   所有 tool / memory / repository 都复用同一 client，事务边界清晰，
 *   pool 容量需 ≥ 最大并发 run（POOL_MAX env 调到 20）。
 *
 * **错误脱敏**：白名单异常（Budget/Abort/Validation）保留原始 message；
 *   其他抛错归一为 "Internal error: <eventId>"，stack 写 Logger。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Client as PgClient } from "pg";
import { generateText, type CoreMessage } from "ai";

import { LlmService } from "../llm/llm.service";
import { ProvidersService } from "../pipeline/providers.service";
import { ProjectsService } from "../projects/projects.service";
import { CostService } from "../cost/cost.service";
import { PlatformRulesService } from "../platform-rules/platform-rules.service";
import { adaptPlatformRules } from "./platform-rules-adapter";

import { AgentRunsRepository } from "./agent-runs.repository";
import { AgentSseService } from "./agent-sse.service";
import { AgentToolsService } from "./agent-tools.service";
import { ContextManager } from "./context-manager";
import { MemoryReader } from "./memory-reader";
import { CostTracker, BudgetExceededError } from "./cost-tracker";
import { SpillStorage } from "./spill-storage.service";

import {
  agentSystemPrompt,
  toPromptTraceTag,
} from "./prompts";
import {
  type AgentFinishReason,
  type AgentRunInput,
  type AgentRunOutput,
  type ChatMessage,
} from "./agent.types";
import { TRACE_FIELD } from "./tools/util/spill-if-large";

/** 默认 maxSteps：12（plan §SLA） */
const DEFAULT_MAX_STEPS = 12;
/** 默认 budget：$0.20（plan §SLA） */
const DEFAULT_BUDGET_USD = 0.2;

/**
 * 已注册的 AbortController 维护表。
 *
 * 进程内 Map：DELETE /agent/runs/:id 端点查 map → controller.abort() → 主循环里
 * ai-sdk 的 abortSignal 触发 AbortError → catch 走 'aborted' 收尾。
 *
 * **限制**：单进程内有效。多实例部署时一个实例发起的 run 无法被另一个实例的
 * DELETE 中止。MVP 不解决；未来上 Redis pub/sub 或固定路由实例。
 */
type AbortRegistry = Map<string, AbortController>;

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);
  private readonly abortRegistry: AbortRegistry = new Map();

  constructor(
    private readonly projects: ProjectsService,
    private readonly llm: LlmService,
    private readonly providers: ProvidersService,
    private readonly memory: MemoryReader,
    private readonly tools: AgentToolsService,
    private readonly contextManager: ContextManager,
    private readonly repo: AgentRunsRepository,
    private readonly sse: AgentSseService,
    private readonly spillStorage: SpillStorage,
    private readonly costs: CostService,
    private readonly platformRulesService: PlatformRulesService,
  ) {}

  /**
   * 暴露给 controller 的 abort 入口。返回是否成功 abort（false 表示未找到 run）。
   */
  abort(runId: string): boolean {
    const controller = this.abortRegistry.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * 主入口。**pgClient 由调用方持有**（controller 用 DbService.withClient 包外层）。
   */
  async run(pgClient: PgClient, input: AgentRunInput): Promise<AgentRunOutput> {
    const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
    const budgetUsd = input.budgetUsd ?? DEFAULT_BUDGET_USD;

    // ── 1. 鉴权 + 加载项目配置 ────────────────────────────────────────────
    // get() 既校验 ownership（不属于用户抛 404）又拿到 project row，name 后面
    // 注入 system prompt 让 LLM 知道"在为哪个项目工作"
    const project = await this.projects.get(input.userId, input.projectId);
    const settings = await this.projects.getSettings(input.userId, input.projectId);

    // ── 2. 构造 LLM + embedding 客户端 ───────────────────────────────────
    const modelName = input.modelOverride ?? settings.model ?? "gpt-4o-mini";
    const llmModel = this.llm.create({
      provider: settings.provider,
      apiKey: settings.encryptedApiKey,
      model: modelName,
    });
    const embedding = this.providers.createEmbeddingClient(
      settings.encryptedApiKey ?? undefined,
    );

    // ── 3. 加载 memory + platform_rules ───────────────────────────────────
    const memoryEntries = await this.memory.load(pgClient, input.projectId);
    // PlatformRulesService.list 走 DbService.withClient（短查询），不复用本 run 的
    // pgClient——projectId 隔离 + enabled 过滤都在 adapter 里完成
    const ruleRows = await this.platformRulesService.list(input.userId, input.projectId);
    const platformRules = adaptPlatformRules(ruleRows);

    // ── 4. 创建 generations + agent_runs 记录 ────────────────────────────
    const generationId = await this.createPendingGeneration(
      pgClient,
      input.projectId,
      input.messages,
    );
    const runId = await this.repo.createRun(pgClient, {
      projectId: input.projectId,
      generationId,
      maxSteps,
      budgetUsd,
    });

    // ── 5. AbortController 注册 ──────────────────────────────────────────
    const abortController = new AbortController();
    this.abortRegistry.set(runId, abortController);

    // ── 6. ContextManager 预压缩（如有需要） ───────────────────────────
    let messages = input.messages;
    let contextSummary: string | undefined;
    let stepIndex = 0;

    if (this.contextManager.shouldCompress(messages)) {
      const compressed = await this.contextManager.compress(messages, llmModel);
      messages = compressed.trimmedMessages;
      contextSummary = compressed.summary;
      // context_compress 写一条 step，trace 完整可观测
      await this.repo.appendStep(pgClient, runId, {
        stepIndex: stepIndex++,
        stepType: "context_compress",
        input: { compressedTurnCount: compressed.compressedTurnCount },
        output: { summary: compressed.summary },
        tokenUsage: compressed.usage,
      });
      this.sse.emitStep({
        runId,
        stepIndex: stepIndex - 1,
        stepType: "context_compress",
        input: { compressedTurnCount: compressed.compressedTurnCount },
        output: { summary: compressed.summary },
      });
    }

    // ── 7. 组装 system prompt（base + memory + rules + 早期摘要） ─────────
    const systemPrompt = agentSystemPrompt.render({
      // 走 projects.name，缺省时回落到 projectId（防 NULL/空字符串边界）
      projectName: project.name?.trim() || input.projectId,
      memory: memoryEntries,
      platformRules,
      contextSummary,
    });

    // ── 8. 构造 tools ────────────────────────────────────────────────────
    const ctx = {
      projectId: input.projectId,
      userId: input.userId,
      runId,
      generationId,
      pgClient,
      embeddingClient: embedding.client,
      llmModel,
      llmDefaultModel: modelName,
    };
    const tools = this.tools.build(ctx, {
      criticCriteria: {
        platformRules: platformRules.flatMap((r) => r.constraints),
        memoryPreferences: memoryEntries.map((m) => m.content),
      },
    });

    // ── 9. ReAct 主循环 ─────────────────────────────────────────────────
    const cost = new CostTracker(modelName);
    let lastStepEndedAt = Date.now();

    try {
      const result = await generateText({
        model: llmModel,
        system: systemPrompt,
        messages: this.toCoreMessages(messages),
        tools,
        toolChoice: "auto",
        maxSteps,
        abortSignal: abortController.signal,
        onStepFinish: async (step) => {
          const now = Date.now();
          const durationMs = now - lastStepEndedAt;
          lastStepEndedAt = now;

          // 一次 ai-sdk step 可能含 reasoning text + 多次 tool 调用。
          // 拆成多条 agent_steps 记录，便于前端 trace 时间轴渲染。
          if (step.text?.trim()) {
            await this.recordStep(pgClient, runId, stepIndex++, {
              stepType: "reasoning",
              output: { text: step.text },
              durationMs,
              tokenUsage: step.usage,
            });
          }

          // ai-sdk 的 toolCalls / toolResults 是 generic 推导 never，cast 一层
          const toolCalls = (step.toolCalls ?? []) as Array<{
            toolName: string;
            args: unknown;
          }>;
          const toolResults = (step.toolResults ?? []) as Array<{
            toolName: string;
            result: unknown;
          }>;

          for (const tc of toolCalls) {
            await this.recordStep(pgClient, runId, stepIndex++, {
              stepType: "tool_call",
              toolName: tc.toolName,
              input: tc.args,
            });
          }
          for (const tr of toolResults) {
            // tool result 可能带 __trace 隐藏字段（spillIfLarge），剥出来写库不给 LLM
            const trWithTrace = tr.result as Record<string, unknown>;
            const traceMeta = trWithTrace?.[TRACE_FIELD] as
              | { path: string; size: number; hash: string }
              | undefined;
            const sanitizedResult = traceMeta
              ? this.stripTraceField(trWithTrace)
              : tr.result;
            await this.recordStep(pgClient, runId, stepIndex++, {
              stepType: "tool_result",
              toolName: tr.toolName,
              output: {
                result: sanitizedResult,
                // 把 path/size/hash 放到 output 的"_spill"字段，前端 trace 详情用
                ...(traceMeta ? { _spill: traceMeta } : {}),
              },
            });
          }

          // ── cost 累计 + budget 闸门 ──
          if (step.usage) {
            cost.add({
              promptTokens: step.usage.promptTokens,
              completionTokens: step.usage.completionTokens,
            });
            await this.repo.updateProgress(pgClient, runId, stepIndex, cost.total);
            this.sse.emitCost({
              runId,
              usedUsd: cost.total,
              percentBudget: cost.percentOf(budgetUsd),
              stepIndex,
            });
            if (cost.over(budgetUsd)) {
              throw new BudgetExceededError(cost.total, budgetUsd);
            }
          }
        },
      });

      // ── 10. 成功收尾 ─────────────────────────────────────────────────
      const finalText = result.text;
      const finishReason: AgentFinishReason = this.mapAiSdkFinishReason(result.finishReason);
      const status = finishReason === "done" ? "succeeded" : "succeeded";
      await this.repo.finalize(pgClient, runId, {
        status,
        finishReason,
      });
      await this.updateGenerationSuccess(pgClient, generationId, finalText, runId);
      // 写 cost_summary 让 agent 跑的钱出现在项目级仪表盘（与 pipeline 路径共用 CostService）
      await this.recordCostSummary(pgClient, input.projectId, cost.total);

      const output: AgentRunOutput = {
        runId,
        generationId,
        text: finishReason === "done" ? finalText : await this.buildFallbackText(pgClient, runId),
        finishReason,
        costUsedUsd: cost.total,
        stepsUsed: stepIndex,
      };
      this.sse.emitFinish({ ...output, status: "succeeded" });
      return output;
    } catch (err) {
      return await this.handleError(
        err,
        pgClient,
        runId,
        generationId,
        input.projectId,
        cost,
        stepIndex,
      );
    } finally {
      this.abortRegistry.delete(runId);
    }
  }

  // ─── 私有：step 入库 + SSE 推流 ───────────────────────────────────────────

  private async recordStep(
    pgClient: PgClient,
    runId: string,
    stepIndex: number,
    step: {
      stepType: "reasoning" | "tool_call" | "tool_result" | "context_compress" | "finish";
      toolName?: string;
      input?: unknown;
      output?: unknown;
      durationMs?: number;
      tokenUsage?: { promptTokens?: number; completionTokens?: number };
    },
  ): Promise<void> {
    await this.repo.appendStep(pgClient, runId, { stepIndex, ...step });
    this.sse.emitStep({
      runId,
      stepIndex,
      stepType: step.stepType,
      toolName: step.toolName,
      input: step.input,
      output: step.output,
      durationMs: step.durationMs,
    });
  }

  // ─── 私有：错误处理（分类、脱敏、收尾） ────────────────────────────────

  private async handleError(
    err: unknown,
    pgClient: PgClient,
    runId: string,
    generationId: string,
    projectId: string,
    cost: CostTracker,
    stepIndex: number,
  ): Promise<AgentRunOutput> {
    // Budget 超限 → fallback 拼 chunks
    if (err instanceof BudgetExceededError) {
      const fallback = await this.buildFallbackText(pgClient, runId);
      await this.repo.finalize(pgClient, runId, {
        status: "succeeded",
        finishReason: "budget",
      });
      await this.updateGenerationSuccess(pgClient, generationId, fallback, runId);
      // 超 budget 的钱也是花掉的钱，照样入 cost_summary（账要算干净）
      await this.recordCostSummary(pgClient, projectId, cost.total);
      const out: AgentRunOutput = {
        runId,
        generationId,
        text: fallback,
        finishReason: "budget",
        costUsedUsd: cost.total,
        stepsUsed: stepIndex,
      };
      this.sse.emitFinish({ ...out, status: "succeeded" });
      return out;
    }

    // AbortError（用户调 DELETE 触发）
    if (this.isAbortError(err)) {
      await this.repo.finalize(pgClient, runId, {
        status: "succeeded",
        finishReason: "aborted",
      });
      const partial = await this.buildFallbackText(pgClient, runId);
      await this.updateGenerationSuccess(pgClient, generationId, partial, runId);
      // abort 前累计的 token 也是真花的，照入账
      await this.recordCostSummary(pgClient, projectId, cost.total);
      const out: AgentRunOutput = {
        runId,
        generationId,
        text: partial,
        finishReason: "aborted",
        costUsedUsd: cost.total,
        stepsUsed: stepIndex,
      };
      this.sse.emitFinish({ ...out, status: "succeeded" });
      return out;
    }

    // 其他异常 → 脱敏 + status='failed'
    const eventId = randomUUID().slice(0, 8);
    this.logger.error(`Agent run ${runId} failed (eventId=${eventId})`, err as Error);
    const safeMessage = `Internal error: ${eventId}`;

    await this.repo.finalize(pgClient, runId, {
      status: "failed",
      finishReason: "error",
      error: safeMessage,
    });
    await this.updateGenerationFailure(pgClient, generationId, safeMessage);
    this.sse.emitError({
      runId,
      code: "internal",
      message: safeMessage,
      eventId,
    });
    throw new Error(safeMessage);
  }

  /**
   * 包一层 CostService.recordGeneration：
   * - 只记 LLM token + cost，agent 不直接调 embedding/retrieval/rerank
   *   （tool 内部 rag-core 会调；但那些 trace 由 rag-core 自己回填，agent 层不重复算）
   * - **失败时静默吞错**：cost_summary 写失败不应该让用户拿不到生成结果。
   *   错误进 Logger，运维侧追。
   */
  private async recordCostSummary(
    pgClient: PgClient,
    projectId: string,
    costUsd: number,
  ): Promise<void> {
    try {
      await this.costs.recordGeneration(pgClient, projectId, {
        // TODO(精度)：CostTracker 当前只暴露累计 USD；token 分项可在 feat-300.5
        //          eval 接入后扩展，agent 暂记 0 不影响汇总金额
        llmTokensPrompt: 0,
        llmTokensCompletion: 0,
        embeddingCalls: 0,
        retrievalCalls: 0,
        rerankerCalls: 0,
        costUsd,
      });
    } catch (e) {
      this.logger.warn(
        `recordCostSummary failed (runId=N/A, projectId=${projectId}): ${(e as Error).message}`,
      );
    }
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "DOMException")) {
      return true;
    }
    return false;
  }

  // ─── 私有：fallback 拼 chunks ─────────────────────────────────────────────

  /**
   * 从 agent_steps 里 search_kb / search_web 的 tool_result 提取 chunks/results 文本，
   * 按 score 降序取前 N 拼成 markdown，作为 budget/abort/max_steps 的兜底回复。
   *
   * 不再调 LLM——budget 已超就不能继续烧；abort 是用户主动停就别多干活；
   * max_steps 同理。直接返回原始材料，UI 提示用户"以下是已搜到的资料"。
   */
  private async buildFallbackText(pgClient: PgClient, runId: string): Promise<string> {
    const steps = await this.repo.getSteps(pgClient, runId);
    const evidenceLines: string[] = [];

    for (const s of steps) {
      if (s.stepType !== "tool_result") continue;
      if (s.toolName !== "search_kb" && s.toolName !== "search_web") continue;
      const out = s.output as { result?: { chunks?: unknown[]; results?: unknown[] } } | null;
      const result = out?.result;
      if (!result) continue;

      const chunks = (result.chunks ?? []) as Array<{ text?: string; source?: string }>;
      for (const c of chunks) {
        if (c.text) evidenceLines.push(`- (${c.source ?? "kb"}) ${c.text}`);
      }
      const webResults = (result.results ?? []) as Array<{ title?: string; url?: string; content?: string }>;
      for (const r of webResults) {
        if (r.content) evidenceLines.push(`- (${r.title ?? "web"} ${r.url ?? ""}) ${r.content}`);
      }
    }

    if (evidenceLines.length === 0) {
      return "（本次运行未收集到足够材料即被中断，请重试或提高预算。）";
    }
    return `**注：本次运行因预算/步数/中断未能完整生成，以下是已搜集到的资料：**\n\n${evidenceLines.slice(0, 12).join("\n")}`;
  }

  // ─── 私有：generations 行 CRUD（最小 SQL，避免引入 GenerationsService 全栈） ──

  private async createPendingGeneration(
    pgClient: PgClient,
    projectId: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const generationId = randomUUID();
    const query = messages.find((m) => m.role === "user")?.content ?? "";
    await pgClient.query(
      `INSERT INTO generations (id, project_id, query, status, source)
       VALUES ($1, $2, $3, 'running', 'agent')`,
      [generationId, projectId, query.slice(0, 2000)],
    );
    return generationId;
  }

  private async updateGenerationSuccess(
    pgClient: PgClient,
    generationId: string,
    resultText: string,
    runId: string,
  ): Promise<void> {
    await pgClient.query(
      `UPDATE generations
       SET status = 'succeeded',
           result_notes = $2,
           agent_run_id = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [generationId, resultText, runId],
    );
  }

  private async updateGenerationFailure(
    pgClient: PgClient,
    generationId: string,
    errorMessage: string,
  ): Promise<void> {
    await pgClient.query(
      `UPDATE generations
       SET status = 'failed', error = $2, updated_at = NOW()
       WHERE id = $1`,
      [generationId, errorMessage],
    );
  }

  // ─── 工具：类型转换 ─────────────────────────────────────────────────────

  private toCoreMessages(messages: ChatMessage[]): CoreMessage[] {
    // 我们的 ChatMessage 与 ai-sdk CoreMessage 的 user/assistant/system + string content
    // 部分子集完全兼容，as 即可
    return messages as unknown as CoreMessage[];
  }

  /** ai-sdk finishReason → 我们的 AgentFinishReason */
  private mapAiSdkFinishReason(reason: string): AgentFinishReason {
    if (reason === "stop") return "done";
    if (reason === "length" || reason === "tool-calls") return "max_steps";
    // 其他（content-filter / error / other）归一为 done——result.text 仍可用
    return "done";
  }

  /** 剥掉 __trace 隐藏字段，得到 LLM 视角的干净 SpillRef */
  private stripTraceField(obj: Record<string, unknown>): Record<string, unknown> {
    const { [TRACE_FIELD]: _omit, ...rest } = obj;
    return rest;
  }
}
