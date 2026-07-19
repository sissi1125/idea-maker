/**
 * Claim Map 类型 — feat-400.2
 *
 * Claim = 可审核的传播单元（不是修辞句）。事实型主张必须有 evidence 才能批准；
 * 表达型主张（角度）不强制 evidence，但只能作为"角度"不能当客观承诺。
 */

export const CLAIM_TYPES = ["functional", "outcome", "differentiation", "emotional"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/**
 * 需要 evidence 才能批准的事实型主张：
 *   - functional（功能）/ outcome（效果）—— 客观事实，无出处不得批准
 *   - differentiation / emotional 是表达型"角度"，可无 evidence 但标示为角度
 */
export const EVIDENCE_REQUIRED_CLAIM_TYPES: readonly ClaimType[] = ["functional", "outcome"];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CLAIM_STATUSES = ["candidate", "approved", "blocked"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type ClaimOrigin = "platform" | "user";

export interface ClaimRow {
  id: string;
  project_id: string;
  brief_id: string;
  text: string;
  claim_type: ClaimType;
  target_audience_ids: string[];
  scenario_ids: string[];
  evidence_chunk_ids: string[];
  source_field_id: string | null;
  origin: ClaimOrigin;
  risk_level: RiskLevel;
  status: ClaimStatus;
  created_at: string;
  updated_at: string;
}

/** Brief 字段分组 → 派生 Claim 的类型映射 */
export const GROUP_TO_CLAIM_TYPE: Record<string, ClaimType> = {
  fact: "functional",
  positioning: "differentiation",
  audience: "outcome",
  identity: "functional",
};
