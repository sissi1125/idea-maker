/**
 * 内容评测离线回归 · 用例类型 — feat-400.2
 *
 * 每条用例是一组"输入 → 期望"，跑过硬规则检查 + 决策器后比对。因为这两步是纯函数，
 * 整套回归不连库、不调 LLM，秒级跑完，适合进 CI 防退化。
 *
 * 开发集：日常调规则时看的；保留集：冻结不动，只做回归 —— 防止"改规则把开发集刷过、
 * 但真实分布崩了"。
 */

import type { GateClaim, GateVariant, GatePlatform, GateFailure } from "../deterministic-gate";
import type { ContentScores, Decision } from "../decision";

export interface GoldenCase {
  id: string;
  description: string;
  claims: GateClaim[];
  variant: GateVariant;
  platform?: GatePlatform;
  /** 模拟的评测评分；缺省/undefined 视为"没有评测"（无 LLM） */
  scores?: ContentScores | null;
  expect: {
    gatePassed: boolean;
    decision: Decision;
    /** 期望命中的硬规则失败原因（子集校验） */
    failureRules?: GateFailure["rule"][];
  };
}
