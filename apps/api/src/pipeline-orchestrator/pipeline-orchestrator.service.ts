/**
 * PipelineOrchestratorService — feat-200.3 Week 3
 *
 * 核心职责：
 *   1. 加载 default.yaml 配置（固定 11-stage 编排顺序）
 *   2. 按序调用 rag-core 各 stage 函数，传递 upstream output
 *   3. 每个 stage 记录 durationMs + output + trace + warnings
 *   4. LLM / embedding 调用后累计 cost 到 TraceContextService
 *   5. 遇到错误时标记 stage 为 error 并跳过后续（或走 fallback）
 *
 * 设计选择：
 *   - 不注入 pipeline controller（那些是给 Playground HTTP API 用的），直接调 rag-core
 *   - 不做 Agent（无 LLM 决策循环 / 工具选择 / 自动重试），仅固定顺序串行
 *   - ProvidersService 负责创建 client（LLM / Embedding / PG），本 service 只编排
 *
 * 注意：
 *   - MVP 阶段 context-management 传空 history（无多轮对话）
 *   - fallback 是条件触发：只有 retrieval 返回 0 结果时才执行，跳过后续
 *   - evaluation 允许失败（降级到无评分），不阻塞最终结果
 */

import { Injectable } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { Client as PgClient } from "pg";
import {
  runQueryRewrite,
  runIntentRecognition,
  runRetrieval,
  runFilter,
  runRerank,
  runCitation,
  runContextManagement,
  runPromptBuild,
  runGeneration,
  runEvaluation,
  runFallback,
  PipelineError,
} from "@harness/rag-core";
import {
  QueryRewriteMethodId,
  QueryRewriteParamsSchema,
  IntentRecognitionMethodId,
  IntentRecognitionParamsSchema,
  RetrievalMethodId,
  RetrievalParamsSchema,
  FilterMethodId,
  FilterParamsSchema,
  RerankMethodId,
  RerankParamsSchema,
  CitationMethodId,
  CitationParamsSchema,
  ContextManagementMethodId,
  ContextManagementParamsSchema,
  PromptBuildMethodId,
  PromptBuildParamsSchema,
  GenerationMethodId,
  GenerationParamsSchema,
  EvaluationMethodId,
  EvaluationParamsSchema,
  FallbackMethodId,
  FallbackParamsSchema,
  type QueryRewriteOutput,
  type RetrievalOutput,
  type FilterOutput,
  type RerankOutput,
  type CitationOutput,
  type PromptBuildOutput,
  type GenerationOutput,
  type ContextManagementOutput,
  type OpenAICompatibleClient,
  type LLMChatClient,
} from "@harness/shared-types";
import { ProvidersService } from "../pipeline/providers.service";
import { TraceContextService } from "../common/trace-context.service";
import type { PipelineConfig, PipelineTrace, StageResult } from "./pipeline-orchestrator.types";

@Injectable()
export class PipelineOrchestratorService {
  private readonly config: PipelineConfig;

  constructor(
    private readonly providers: ProvidersService,
    private readonly tracer: TraceContextService,
  ) {
    // 启动时加载 YAML 配置（同步，只做一次）
    // 优先用 src/ 路径（ts-node-dev 开发模式），如不存在回退 __dirname（nest build 后手动 copy）
    const candidates = [
      join(process.cwd(), "src", "pipeline-orchestrator", "pipelines", "default.yaml"),
      join(__dirname, "pipelines", "default.yaml"),
    ];
    let raw: string | undefined;
    for (const p of candidates) {
      try { raw = readFileSync(p, "utf-8"); break; } catch { /* try next */ }
    }
    if (!raw) throw new Error(`default.yaml 未找到，搜索路径：${candidates.join(", ")}`);
    this.config = parseYaml(raw) as PipelineConfig;
  }

  /**
   * 执行完整 pipeline，返回 trace + 结果。
   * 调用方（GenerationsService）负责写 DB、错误包装。
   */
  async run(query: string): Promise<{
    trace: PipelineTrace;
    resultNotes: string | null;
    retrievedChunks: unknown[];
  }> {
    const startMs = Date.now();
    const stages: StageResult[] = [];

    // ── 创建共享 client ──────────────────────────────────────────────────
    let pgClient: PgClient | undefined;
    let llmConfig: { client: LLMChatClient; defaultModel: string } | undefined;
    let embeddingClient: OpenAICompatibleClient | undefined;

    try {
      pgClient = this.providers.createPgClient();
      await pgClient.connect();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stages.push({ stageId: "init", methodId: "pg-connect", status: "error", durationMs: 0, error: msg });
      return this.buildResult(stages, startMs, null, []);
    }

    try {
      llmConfig = this.providers.createLLMClient();
    } catch {
      // LLM 不可用时 generation/rerank/evaluation 会降级
    }

    try {
      embeddingClient = this.providers.createEmbeddingClient().client;
    } catch {
      // embedding 不可用时 retrieval 会报错
    }

    // ── Stage 变量（upstream 传递）──────────────────────────────────────
    let contextOutput: ContextManagementOutput | undefined;
    let queryRewriteOutput: QueryRewriteOutput | undefined;
    let retrievalOutput: RetrievalOutput | undefined;
    let filterOutput: FilterOutput | undefined;
    let rerankOutput: RerankOutput | undefined;
    let citationOutput: CitationOutput | undefined;
    let promptBuildOutput: PromptBuildOutput | undefined;
    let generationOutput: GenerationOutput | undefined;
    let retrievedChunks: unknown[] = [];
    let resultNotes: string | null = null;
    let useFallback = false;

    try {
      // ── 1. context-management ────────────────────────────────────────
      contextOutput = await this.runStage(stages, "context-management", async (cfg) => {
        const methodId = ContextManagementMethodId.parse(cfg.method);
        const params = ContextManagementParamsSchema.parse({
          ...cfg.params,
          currentMessage: query,
          history: [], // MVP 无多轮
        });
        const result = await runContextManagement({ methodId, params });
        return result;
      });

      const resolvedQuery = contextOutput?.query ?? query;

      // ── 2. query-rewrite ─────────────────────────────────────────────
      queryRewriteOutput = await this.runStage(stages, "query-rewrite", async (cfg) => {
        const methodId = QueryRewriteMethodId.parse(cfg.method);
        const params = QueryRewriteParamsSchema.parse({
          ...cfg.params,
          query: resolvedQuery,
        });
        let llmClient: LLMChatClient | undefined;
        if (methodId === "llm-marketing-rewrite" && llmConfig) {
          llmClient = llmConfig.client;
        }
        const result = await runQueryRewrite({ methodId, params, llmClient });
        return result;
      });

      // ── 3. intent-recognition ────────────────────────────────────────
      await this.runStage(stages, "intent-recognition", async (cfg) => {
        const methodId = IntentRecognitionMethodId.parse(cfg.method);
        const params = IntentRecognitionParamsSchema.parse({
          ...cfg.params,
          query: resolvedQuery,
        });
        let llmClient: LLMChatClient | undefined;
        if (methodId === "llm-router" && llmConfig) {
          llmClient = llmConfig.client;
        }
        const result = await runIntentRecognition({
          methodId,
          params,
          upstreamQuery: resolvedQuery,
          llmClient,
        });
        return result;
      });

      // ── 4. retrieval ─────────────────────────────────────────────────
      const queries = queryRewriteOutput?.rewrittenQueries ?? [resolvedQuery];
      retrievalOutput = await this.runStage(stages, "retrieval", async (cfg) => {
        const methodId = RetrievalMethodId.parse(cfg.method);
        const params = RetrievalParamsSchema.parse(cfg.params);
        const result = await runRetrieval({
          methodId,
          params,
          queries,
          pgClient: pgClient!,
          openaiClient: embeddingClient,
          hfTeiEndpoint: this.providers.resolveTeiEndpoint(),
        });
        this.tracer.addCost({ retrievalCalls: 1, embeddingCalls: 1 });
        return result;
      });

      // 检查是否需要 fallback（0 结果）
      const matches = retrievalOutput?.matches ?? [];
      retrievedChunks = matches;
      if (matches.length === 0) {
        useFallback = true;
      }

      if (useFallback) {
        // ── fallback 路径 ──────────────────────────────────────────────
        await this.runStage(stages, "fallback", async (cfg) => {
          const methodId = FallbackMethodId.parse(cfg.method);
          const params = FallbackParamsSchema.parse(cfg.params);
          const result = await runFallback({
            methodId,
            params,
            upstream: {
              rankedMatches: [],
              rankChanges: [],
              method: "none",
              warnings: [],
              originalQuery: resolvedQuery,
            } as RerankOutput,
            llmClient: llmConfig?.client,
          });
          resultNotes = result.output.fallbackResponse ?? null;
          return result;
        });
      } else {
        // ── 5. filter ──────────────────────────────────────────────────
        filterOutput = await this.runStage(stages, "filter", async (cfg) => {
          const methodId = FilterMethodId.parse(cfg.method);
          const params = FilterParamsSchema.parse(cfg.params);
          const result = runFilter({
            methodId,
            params,
            upstreamMatches: retrievalOutput!.matches ?? [],
            originalQuery: retrievalOutput!.originalQuery ?? resolvedQuery,
            upstreamWarnings: retrievalOutput!.warnings,
          });
          return result;
        });

        // ── 6. rerank ──────────────────────────────────────────────────
        rerankOutput = await this.runStage(stages, "rerank", async (cfg) => {
          const methodId = RerankMethodId.parse(cfg.method);
          const params = RerankParamsSchema.parse(cfg.params);
          const result = await runRerank({
            methodId,
            params,
            upstreamMatches: filterOutput!.filteredMatches ?? [],
            upstreamQuery: filterOutput!.originalQuery,
            hfTeiEndpoint: this.providers.resolveTeiEndpoint(),
            llmClient: llmConfig?.client,
          });
          if (llmConfig) {
            this.tracer.addCost({ rerankerCalls: 1 });
          }
          return result;
        });

        // ── 7. citation ────────────────────────────────────────────────
        citationOutput = await this.runStage(stages, "citation", async (cfg) => {
          const methodId = CitationMethodId.parse(cfg.method);
          const params = CitationParamsSchema.parse(cfg.params);
          const result = await runCitation({
            methodId,
            params,
            upstreamMatches: rerankOutput!.rankedMatches ?? [],
            originalQuery: rerankOutput!.originalQuery,
            pgClient,
          });
          return result;
        });

        // ── 8. prompt-build ────────────────────────────────────────────
        promptBuildOutput = await this.runStage(stages, "prompt-build", async (cfg) => {
          const methodId = PromptBuildMethodId.parse(cfg.method);
          const params = PromptBuildParamsSchema.parse(cfg.params);
          const result = runPromptBuild({
            methodId,
            params,
            upstream: citationOutput!,
          });
          return result;
        });

        // ── 9. generation ──────────────────────────────────────────────
        if (llmConfig) {
          generationOutput = await this.runStage(stages, "generation", async (cfg) => {
            const methodId = GenerationMethodId.parse(cfg.method);
            const params = GenerationParamsSchema.parse(cfg.params);
            const result = await runGeneration({
              methodId,
              params,
              upstream: promptBuildOutput!,
              llmClient: llmConfig!.client,
              defaultModel: llmConfig!.defaultModel,
            });
            // 累计 LLM token（从 trace 取）
            const trace = result.trace as { promptTokens?: number; completionTokens?: number };
            this.tracer.addCost({
              llmTokensPrompt: trace.promptTokens ?? 0,
              llmTokensCompletion: trace.completionTokens ?? 0,
              costUsd: this.estimateCost(trace.promptTokens ?? 0, trace.completionTokens ?? 0),
            });
            return result;
          });

          // 提取最终文本
          resultNotes = this.extractResultText(generationOutput);
        } else {
          stages.push({
            stageId: "generation",
            methodId: "skipped",
            status: "skipped",
            durationMs: 0,
            warnings: ["LLM ��配置，跳过 generation"],
          });
        }

        // ── 10. evaluation（允许失败） ─────────────────────────────────
        await this.runStage(stages, "evaluation", async (cfg) => {
          const methodId = EvaluationMethodId.parse(cfg.method);
          const params = EvaluationParamsSchema.parse(cfg.params);
          // 从 citation output 取 evidencePack（已是 EvidenceItem[] 格式）
          const evidencePack = citationOutput?.evidencePack ?? [];
          const result = await runEvaluation({
            methodId,
            params,
            upstream: {
              originalQuery: resolvedQuery,
              generatedContent: resultNotes ?? "",
              evidencePack,
              citedEvidenceIds: evidencePack.map((e) => e.evidenceId),
            },
            llmClient: llmConfig?.client,
            defaultModel: llmConfig?.defaultModel,
          });
          return result;
        });
      }
    } catch (err) {
      // 未被 runStage catch 住的意外错误（理论上不应该到这里）
      const msg = err instanceof Error ? err.message : String(err);
      stages.push({ stageId: "unexpected", methodId: "unknown", status: "error", durationMs: 0, error: msg });
    } finally {
      if (pgClient) {
        await pgClient.end().catch(() => {});
      }
    }

    return this.buildResult(stages, startMs, resultNotes, retrievedChunks);
  }

  // ── 私有方法 ───────────────────────────────────────────────────────────────

  /**
   * 通用 stage 执行器：找配置 → 计时 → 调用 → 记录 result → 返回 output。
   * 如果该 stage 不在 YAML 配置中，跳过。
   * 如果执行报错，记录 error 但不抛出（让后续 stage 决定是否能继续）。
   */
  private async runStage<T>(
    stages: StageResult[],
    stageId: string,
    executor: (cfg: { method: string; params: Record<string, unknown> }) => Promise<{ output: T; trace: unknown; warnings: string[] }>,
  ): Promise<T | undefined> {
    const cfg = this.config.stages.find((s) => s.id === stageId);
    if (!cfg) {
      stages.push({ stageId, methodId: "not-configured", status: "skipped", durationMs: 0 });
      return undefined;
    }

    const stageStart = Date.now();
    try {
      const result = await executor(cfg);
      stages.push({
        stageId,
        methodId: cfg.method,
        status: "success",
        durationMs: Date.now() - stageStart,
        output: result.output,
        trace: result.trace,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      });
      return result.output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isPipelineErr = err instanceof PipelineError;
      stages.push({
        stageId,
        methodId: cfg.method,
        status: "error",
        durationMs: Date.now() - stageStart,
        error: isPipelineErr ? `[${(err as PipelineError).code}] ${msg}` : msg,
      });
      return undefined;
    }
  }

  private buildResult(
    stages: StageResult[],
    startMs: number,
    resultNotes: string | null,
    retrievedChunks: unknown[],
  ) {
    const cost = this.tracer.current()?.cost ?? {
      llmTokensPrompt: 0,
      llmTokensCompletion: 0,
      embeddingCalls: 0,
      retrievalCalls: 0,
      rerankerCalls: 0,
      costUsd: 0,
    };
    const trace: PipelineTrace = {
      pipelineName: this.config.name,
      pipelineVersion: this.config.version,
      stages,
      totalDurationMs: Date.now() - startMs,
      cost,
    };
    return { trace, resultNotes, retrievedChunks };
  }

  /**
   * 从 GenerationOutput（多态：marketing-ideas / product-persona / selling-points / content-ideas）
   * 提取可读文本。MVP 做简单 JSON.stringify，Week 6 前端负责格式化。
   */
  private extractResultText(output: GenerationOutput | undefined): string | null {
    if (!output) return null;
    // marketing-ideas 有 ideas[]；其他有 result / text 字段
    if ("ideas" in output && Array.isArray(output.ideas)) {
      return output.ideas.map((idea, i) => `${i + 1}. ${(idea as { title?: string; content?: string }).title ?? (idea as { content?: string }).content ?? JSON.stringify(idea)}`).join("\n");
    }
    if ("result" in output && typeof output.result === "string") {
      return output.result;
    }
    return JSON.stringify(output, null, 2);
  }

  /** 粗估 LLM 成本（GPT-4o-mini 价格：$0.15/1M input, $0.60/1M output） */
  private estimateCost(promptTokens: number, completionTokens: number): number {
    return (promptTokens * 0.15 + completionTokens * 0.6) / 1_000_000;
  }
}
