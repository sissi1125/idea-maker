/**
 * 决策器 —— feat-400.2（纯函数）
 *
 * 组合【确定性门禁结果】+【评测 Agent 评分】→ 四态决策。规则（plan §5.4）：
 *   事实门禁失败                          → blocked（模型高分救不回来）
 *   评测发现 blocker                      → revise
 *   关键维度低分 / 没有评测（拿不准）      → human_review
 *   全部关键维度达标且无高风险            → publish_candidate
 *
 * 关键设计：没有评测结果时**默认 human_review 而非 publish_candidate** —— 缺评测时
 * 宁可转人工，不放行。这体现"系统放行的假阳性最贵"的取舍。
 */

import type { GateResult } from "./deterministic-gate";

export type EvalIssueSeverity = "blocker" | "warning" | "suggestion";

export interface ContentScores {
  factualFaithfulness: number;
  audienceFit: number;
  platformFit: number;
  clarity: number;
  differentiation: number;
  styleFit: number;
  issues: Array<{
    severity: EvalIssueSeverity;
    category: string;
    evidence?: string;
    recommendation: string;
  }>;
}

export type Decision = "publish_candidate" | "human_review" | "revise" | "blocked";

/** 关键维度阈值：达标才可能 publish_candidate */
const THRESHOLDS = {
  factualFaithfulness: 4,
  audienceFit: 3,
  platformFit: 3,
  clarity: 3,
} as const;

export function decide(gate: GateResult, scores: ContentScores | null): Decision {
  if (!gate.passed) return "blocked";
  if (!scores) return "human_review"; // 没有评测 → 不自动放行
  if (scores.issues.some((i) => i.severity === "blocker")) return "revise";

  const keyOk =
    scores.factualFaithfulness >= THRESHOLDS.factualFaithfulness &&
    scores.audienceFit >= THRESHOLDS.audienceFit &&
    scores.platformFit >= THRESHOLDS.platformFit &&
    scores.clarity >= THRESHOLDS.clarity;

  return keyOk ? "publish_candidate" : "human_review";
}
