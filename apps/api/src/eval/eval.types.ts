/**
 * Eval 共享类型 — feat-300.5
 *
 * golden 文件 / EvalRunner / EvalController / pnpm eval CLI 共用。
 *
 * 与 schema.ts 的对应：
 *   - GoldenItem 是「测试输入」（不入库，存 golden/*.json 由 git 跟踪）
 *   - EvalItemRow 是「测试结果」（入库 eval_items 表）
 *   - EvalRunRow 是「一次跑的总账」（入库 eval_runs 表）
 *
 * 为什么 golden 不入库：
 *   测试集需要 git 跟踪、人工 review 改动、跨环境共享。DB 里散落几十条 JSON
 *   无法走 PR 审查。文件 + commit hash 入 eval_runs.git_commit 是更纯净的设计。
 */

import type { AgentToolName } from "../agent/tools/types";

/**
 * golden 测试集条目（写在 apps/api/src/eval/golden/*.json）。
 *
 * thresholds：每个维度 1-5 整数；item 通过的最低分。
 * expectedTools：期望 agent 走的路径（顺序无关，集合相似度 ≥ 0.5 视为达标）。
 *   填 [] 表示「不关心调了哪些工具，只看最终输出」。
 */
export interface GoldenItem {
  /** 稳定 id，写进 eval_items.golden_id；命名约定 'gold-{topic}-{idx}'，永远不变 */
  id: string;
  /** 用户 query */
  query: string;
  /** 期望走过的 tool（无序集合） */
  expectedTools: AgentToolName[];
  /** 参考答案（LLM-as-judge 对比基准） */
  referenceAnswer: string;
  /** 每个维度的合格线（1-5 整数），低于则该条 item.passed = false */
  thresholds: {
    faithfulness: number;
    completeness: number;
    style: number;
  };
  /** 可选元数据 */
  meta?: {
    /** 出处：'manual' 或 promoted from feedback id */
    source?: "manual" | "from-feedback";
    sourceFeedbackId?: string;
    /** 标签，便于按场景过滤跑（如 'rag' / 'safety' / 'long-form'） */
    tags?: string[];
  };
}

/** judge prompt 返回的 JSON 形状 */
export interface JudgeScores {
  /** 1-5：候选答案在事实层面忠实参考的程度（避免幻觉） */
  faithfulness: number;
  /** 1-5：候选答案是否完整回应 query 的关键点 */
  completeness: number;
  /** 1-5：风格是否得当（长度 / 语气 / 受众适配） */
  style: number;
  /** judge 简短理由（< 200 字），方便人工 review */
  rationale: string;
}

/** trajectory 对比结果 */
export interface TrajectoryMatch {
  expected: string[];
  actual: string[];
  /** actual ∩ expected / |actual| */
  precision: number;
  /** actual ∩ expected / |expected| */
  recall: number;
  /** |A ∩ B| / |A ∪ B| */
  jaccard: number;
  /** expected 集合是否完全被 actual 覆盖 */
  fullCover: boolean;
}

/** 一次 eval_runs 入库前的聚合结果 */
export interface EvalRunSummary {
  evalRunId: string;
  projectId: string;
  totalItems: number;
  passedItems: number;
  avgFaithfulness: number;
  avgCompleteness: number;
  avgStyle: number;
  avgOverall: number;
  /** 与上次 baseline 的 avgOverall 差值（负数表示退步） */
  deltaVsBaseline: number | null;
  /** 是否触发 CI 阈值（用于 process.exit(1)） */
  shouldFailCI: boolean;
}

/** 单条 item 跑完的结果（入库 eval_items 一行） */
export interface EvalItemResult {
  goldenId: string;
  query: string;
  agentRunId: string | null;
  candidateText: string;
  scores: JudgeScores | null;
  trajectory: TrajectoryMatch;
  passed: boolean;
  judgeRationale: string;
  error: string | null;
  durationMs: number;
}
