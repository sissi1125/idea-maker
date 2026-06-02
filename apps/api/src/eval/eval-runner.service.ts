/**
 * EvalRunnerService — feat-300.5
 *
 * 把 golden 测试集跑过 AgentRunner，对结果做：
 *   1. trajectory match（与 expectedTools 集合对比）
 *   2. LLM-as-judge 三维打分
 *   3. 综合判定 passed = (faithfulness >= τ.f && completeness >= τ.c && style >= τ.s && jaccard >= 0.5)
 *   4. 聚合 avg + 与 baseline 对比 → shouldFailCI
 *
 * 设计点：
 *   - **串行跑**：MVP 阶段 golden < 30 条，串行 60s 内可完成；并行需要 BYOK 限流 + cost 平台限速控制，留 feat-300.7
 *   - **单 item 失败不阻断整批**：try/catch 一条，标 error 后继续；保留可观测性
 *   - **judge 用同一项目的 LLM**：复用项目 settings，避免引入第二套 BYOK 配置
 *   - **每条 eval_item 包独立 withClient**：避免一条卡死锁住整个连接生命周期
 *
 * 与 AgentRunner 的关系：
 *   EvalRunner 是 AgentRunner 的「测试外壳」——本身不写 LLM 主循环，而是反复调用
 *   AgentRunner.run + 评分。这样保证「eval 跑的就是生产路径」，避免「测试通过但
 *   生产挂」的常见 trap。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { generateText } from "ai";
import { DbService } from "../db/db.service";
import { LlmService } from "../llm/llm.service";
import { ProjectsService } from "../projects/projects.service";
import { AgentRunnerService } from "../agent/agent-runner.service";
import { AgentRunsRepository } from "../agent/agent-runs.repository";
import { judgePrompt } from "../agent/prompts/eval/judge.prompt";
import { EvalRepository } from "./eval.repository";
import { loadGoldenSet } from "./golden-loader";
import { trajectoryMatch } from "./trajectory-match";
import type {
  EvalItemResult,
  EvalRunSummary,
  GoldenItem,
  JudgeScores,
} from "./eval.types";

export interface RunEvalInput {
  userId: string;
  projectId: string;
  triggeredBy?: "manual" | "cli" | "ci" | "cron";
  gitCommit?: string | null;
  gitBranch?: string | null;
  /** 默认 0.5：avgOverall 比 baseline 退步超过该分数则 fail */
  thresholdDrop?: number;
  /** 可选过滤：只跑某些 golden id 或 tag */
  filter?: { ids?: string[]; tags?: string[] };
}

@Injectable()
export class EvalRunnerService {
  private readonly logger = new Logger(EvalRunnerService.name);

  constructor(
    private readonly db: DbService,
    private readonly llm: LlmService,
    private readonly projects: ProjectsService,
    private readonly agentRunner: AgentRunnerService,
    private readonly agentRunsRepo: AgentRunsRepository,
    private readonly repo: EvalRepository,
  ) {}

  async run(input: RunEvalInput): Promise<EvalRunSummary> {
    // owner 校验（404 复用既有语义）
    await this.projects.get(input.userId, input.projectId);
    const settings = await this.projects.getSettings(input.userId, input.projectId);

    // 加载 + 过滤 golden 集
    const all = loadGoldenSet();
    const golden = filterGolden(all, input.filter);
    if (golden.length === 0) {
      throw new NotFoundException("无可跑的 golden item（检查 filter / 目录是否为空）");
    }

    // 创建 eval_run + 找 baseline（同事务内拿 baselineRunId 写入）
    const baseline = await this.db.withClient((client) =>
      this.repo.findLatestSucceededBaseline(client, input.projectId),
    );
    const evalRunId = await this.db.withClient((client) =>
      this.repo.createRun(client, {
        projectId: input.projectId,
        triggeredBy: input.triggeredBy ?? "manual",
        gitCommit: input.gitCommit,
        gitBranch: input.gitBranch,
        baselineRunId: baseline?.id ?? null,
        thresholdDrop: input.thresholdDrop ?? 0.5,
      }),
    );

    const judgeModel = this.llm.create({
      provider: settings.provider,
      apiKey: settings.encryptedApiKey,
      model: settings.model,
    });

    const itemResults: EvalItemResult[] = [];
    let fatal: Error | null = null;

    try {
      for (const item of golden) {
        const result = await this.runOne(input, item, judgeModel);
        itemResults.push(result);
        // 每条独立 withClient 写一行：避免上一条占用连接太久
        await this.db.withClient((client) =>
          this.repo.appendItem(client, evalRunId, result),
        );
      }
    } catch (err) {
      // runOne 自己 catch 单 item 错误，能跑到这里说明是循环外（如 LLM 配置错）
      fatal = err as Error;
    }

    const summary = aggregate(evalRunId, input.projectId, itemResults, baseline?.avgOverall ?? null, input.thresholdDrop ?? 0.5);

    await this.db.withClient((client) =>
      this.repo.finalizeRun(
        client,
        evalRunId,
        {
          totalItems: summary.totalItems,
          passedItems: summary.passedItems,
          avgFaithfulness: summary.avgFaithfulness,
          avgCompleteness: summary.avgCompleteness,
          avgStyle: summary.avgStyle,
          avgOverall: summary.avgOverall,
        },
        fatal ? "failed" : "succeeded",
        fatal?.message,
      ),
    );

    if (fatal) throw fatal;
    return summary;
  }

  private async runOne(
    input: RunEvalInput,
    item: GoldenItem,
    judgeModel: ReturnType<LlmService["create"]>,
  ): Promise<EvalItemResult> {
    const t0 = Date.now();
    try {
      // 1) 跑 agent
      const agentRes = await this.db.withClient((pgClient) =>
        this.agentRunner.run(pgClient, {
          projectId: input.projectId,
          userId: input.userId,
          messages: [{ role: "user", content: item.query }],
        }),
      );

      // 2) trajectory：从 agent_steps 抽 tool_call
      const steps = await this.db.withClient((c) =>
        this.agentRunsRepo.getSteps(c, agentRes.runId),
      );
      const actualTools = steps
        .filter((s) => s.stepType === "tool_call" && s.toolName)
        .map((s) => s.toolName as string);
      const traj = trajectoryMatch(item.expectedTools, actualTools);

      // 3) judge
      let scores: JudgeScores | null = null;
      let judgeRationale = "";
      try {
        const { text } = await generateText({
          model: judgeModel,
          prompt: judgePrompt.render({
            query: item.query,
            reference: item.referenceAnswer,
            candidate: agentRes.text,
          }),
          temperature: 0.2,
          maxTokens: 600,
        });
        const parsed = parseJudge(text);
        scores = parsed;
        judgeRationale = parsed?.rationale ?? "";
      } catch (err) {
        this.logger.warn(`[eval] judge LLM 调用失败 golden=${item.id}: ${(err as Error).message}`);
      }

      const passed = scoreItemPassed(item, scores, traj.jaccard);

      return {
        goldenId: item.id,
        query: item.query,
        agentRunId: agentRes.runId,
        candidateText: agentRes.text,
        scores,
        trajectory: traj,
        passed,
        judgeRationale,
        error: null,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`[eval] golden=${item.id} 跑失败: ${msg}`);
      return {
        goldenId: item.id,
        query: item.query,
        agentRunId: null,
        candidateText: "",
        scores: null,
        trajectory: trajectoryMatch(item.expectedTools, []),
        passed: false,
        judgeRationale: "",
        error: msg,
        durationMs: Date.now() - t0,
      };
    }
  }
}

function filterGolden(all: GoldenItem[], filter?: RunEvalInput["filter"]): GoldenItem[] {
  if (!filter) return all;
  return all.filter((g) => {
    if (filter.ids && filter.ids.length > 0 && !filter.ids.includes(g.id)) return false;
    if (filter.tags && filter.tags.length > 0) {
      const tags = g.meta?.tags ?? [];
      if (!filter.tags.some((t) => tags.includes(t))) return false;
    }
    return true;
  });
}

/** 与 distill 一样的围栏兜底解析 */
function parseJudge(text: string): JudgeScores | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(stripped) as JudgeScores;
    if (
      typeof parsed.faithfulness === "number" &&
      typeof parsed.completeness === "number" &&
      typeof parsed.style === "number"
    ) {
      // 校验 1-5 范围 + clamp
      return {
        faithfulness: clamp(parsed.faithfulness),
        completeness: clamp(parsed.completeness),
        style: clamp(parsed.style),
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clamp(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

/**
 * 判 item 通过：三维都过阈值 + jaccard >= 0.5。
 * jaccard < 0.5 视为路径偏差大，即使输出文本好也判 fail（防止 agent 投机取巧）。
 */
function scoreItemPassed(
  item: GoldenItem,
  scores: JudgeScores | null,
  jaccard: number,
): boolean {
  if (!scores) return false;
  if (scores.faithfulness < item.thresholds.faithfulness) return false;
  if (scores.completeness < item.thresholds.completeness) return false;
  if (scores.style < item.thresholds.style) return false;
  if (jaccard < 0.5) return false;
  return true;
}

function aggregate(
  evalRunId: string,
  projectId: string,
  items: EvalItemResult[],
  baselineAvgOverall: number | null,
  thresholdDrop: number,
): EvalRunSummary {
  const scoredItems = items.filter((i) => i.scores !== null);
  const n = scoredItems.length;
  const avg = (sel: (s: JudgeScores) => number) =>
    n === 0 ? 0 : round3(scoredItems.reduce((acc, i) => acc + sel(i.scores!), 0) / n);

  const avgFaithfulness = avg((s) => s.faithfulness);
  const avgCompleteness = avg((s) => s.completeness);
  const avgStyle = avg((s) => s.style);
  const avgOverall = round3((avgFaithfulness + avgCompleteness + avgStyle) / 3);

  const delta = baselineAvgOverall === null ? null : round3(avgOverall - baselineAvgOverall);
  const shouldFailCI = delta !== null && -delta > thresholdDrop;

  return {
    evalRunId,
    projectId,
    totalItems: items.length,
    passedItems: items.filter((i) => i.passed).length,
    avgFaithfulness,
    avgCompleteness,
    avgStyle,
    avgOverall,
    deltaVsBaseline: delta,
    shouldFailCI,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
