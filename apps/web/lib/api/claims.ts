/**
 * Claim（卖点）API client — feat-400.2 前端
 *
 * 卖点 = 准备写进文案、但要先审过的传播单元。事实型卖点没证据不给批。
 * 后端返回原始 SQL 行（snake_case）。
 */

import { apiFetch } from "./client";

export const CLAIM_TYPES = ["functional", "outcome", "differentiation", "emotional"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
/** 事实型卖点：批准必须有证据 */
export const EVIDENCE_REQUIRED_CLAIM_TYPES: readonly ClaimType[] = ["functional", "outcome"];

export type ClaimStatus = "candidate" | "approved" | "blocked";

export interface Claim {
  id: string;
  project_id: string;
  brief_id: string;
  text: string;
  claim_type: ClaimType;
  evidence_chunk_ids: string[];
  origin: "platform" | "user";
  risk_level: "low" | "medium" | "high";
  status: ClaimStatus;
  created_at: string;
  updated_at: string;
}

export async function listClaims(projectId: string): Promise<Claim[]> {
  const res = await apiFetch<{ claims: Claim[] }>(`/projects/${projectId}/claims`);
  return res.claims;
}

export async function deriveClaims(projectId: string): Promise<{ derived: number }> {
  const res = await apiFetch<{ result: { derived: number } }>(
    `/projects/${projectId}/claims/derive`,
    { method: "POST" },
  );
  return res.result;
}

export async function createClaim(
  projectId: string,
  body: { text: string; claimType: ClaimType; evidenceChunkIds?: string[] },
): Promise<Claim> {
  const res = await apiFetch<{ claim: Claim }>(`/projects/${projectId}/claims`, { method: "POST", body });
  return res.claim;
}

export async function approveClaim(projectId: string, claimId: string): Promise<Claim> {
  const res = await apiFetch<{ claim: Claim }>(
    `/projects/${projectId}/claims/${claimId}/approve`,
    { method: "POST" },
  );
  return res.claim;
}

export async function blockClaim(projectId: string, claimId: string): Promise<Claim> {
  const res = await apiFetch<{ claim: Claim }>(
    `/projects/${projectId}/claims/${claimId}/block`,
    { method: "POST" },
  );
  return res.claim;
}

/** 用户维护平台建议卖点时只修改表达文本和类型，不改已有 evidence。 */
export async function updateClaim(
  projectId: string,
  claimId: string,
  body: { text: string; claimType: ClaimType },
): Promise<Claim> {
  const res = await apiFetch<{ claim: Claim }>(`/projects/${projectId}/claims/${claimId}`, { method: "PATCH", body });
  return res.claim;
}

/** 删除不再需要的卖点；视觉资产关联由数据库外键自动置空。 */
export async function deleteClaim(projectId: string, claimId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/claims/${claimId}`, { method: "DELETE" });
}
