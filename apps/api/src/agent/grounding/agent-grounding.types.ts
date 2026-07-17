/**
 * Agent Grounding Context —— 一次 run 的事实裁决上下文。
 *
 * Product Brief 决定“哪些事实可用”，RAG chunk 只负责提供证据与细节；
 * candidate/stale/rejected 字段不会出现在这里，避免下游 tool 绕过人工确认。
 */
import type { ClaimType } from "../../claims/claims.types";
import type { BriefFieldGroup, BriefFieldSource } from "../../product-brief/product-brief.types";
import type { PlatformRuleRow } from "../../platform-rules/platform-rules.types";

export interface GroundedBriefField {
  id: string;
  group: BriefFieldGroup;
  key: string;
  value: unknown;
  source: BriefFieldSource;
  evidenceChunkIds: string[];
}

export interface GroundedClaim {
  id: string;
  text: string;
  claimType: ClaimType;
  sourceFieldId: string | null;
  evidenceChunkIds: string[];
}

export interface GroundingEvidenceChunk {
  id: string;
  text: string;
}

export interface AgentGroundingContext {
  briefId: string | null;
  briefVersion: number | null;
  confirmedFields: GroundedBriefField[];
  approvedClaims: GroundedClaim[];
  evidenceChunks: GroundingEvidenceChunk[];
  platformRules: PlatformRuleRow[];
}

/** 没有整体 confirmed Brief 或没有 confirmed 字段时，营销生成必须 fail closed。 */
export function hasConfirmedProductFacts(ctx: AgentGroundingContext): boolean {
  return ctx.briefId !== null && ctx.confirmedFields.length > 0;
}

/** 测试与无 Brief 项目的统一空值，避免各 tool 自己发明 fallback。 */
export function emptyAgentGroundingContext(
  platformRules: PlatformRuleRow[] = [],
): AgentGroundingContext {
  return {
    briefId: null,
    briefVersion: null,
    confirmedFields: [],
    approvedClaims: [],
    evidenceChunks: [],
    platformRules,
  };
}
