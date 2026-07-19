/**
 * Campaign 内容包 API client — feat-400.4 前端
 *
 * 一次传播任务（Campaign Brief）→ 3 个可比较角度，每个带硬规则检查结果与去向。
 */

import { apiFetch } from "./client";
import { startAndWait } from "./jobs";
import type { Decision, GateFailure } from "./content-evaluation";

export const CAMPAIGN_GOALS = ["launch", "feature_update", "acquisition", "messaging"] as const;
export type CampaignGoal = (typeof CAMPAIGN_GOALS)[number];

export interface CampaignListItem {
  id: string;
  goal: CampaignGoal;
  platform: string | null;
  cta: string | null;
  status: string;
  allowedClaimIds: string[];
  created_at: string;
}

/** 删除内容任务及其候选内容。 */
export async function deleteCampaign(projectId: string, id: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/campaigns/${id}`, { method: "DELETE" });
}

export interface CampaignVariant {
  id: string;
  source: "generated" | "manual";
  angle: string;
  hook: string;
  body: string;
  cta: string;
  claimIds: string[];
  adopted: boolean;
  gatePassed: boolean;
  gateFailures: GateFailure[];
  decision: Decision;
  createdAt: string;
}

export interface CampaignDetail {
  campaign: {
    id: string; goal: CampaignGoal; platform: string | null; cta: string | null;
    target_audience: string | null; allowed_claim_ids: string[]; max_length: number | null;
  };
  variants: CampaignVariant[];
}

export interface CreateCampaignInput {
  goal: CampaignGoal;
  targetAudience?: string;
  scenario?: string;
  platform?: string;
  maxLength?: number;
  cta?: string;
  allowedClaimIds?: string[];
  avoidNotes?: string;
}

export async function listCampaigns(projectId: string): Promise<CampaignListItem[]> {
  const res = await apiFetch<{ campaigns: CampaignListItem[] }>(`/projects/${projectId}/campaigns`);
  return res.campaigns;
}

export async function createCampaign(projectId: string, body: CreateCampaignInput): Promise<{ id: string }> {
  return apiFetch(`/projects/${projectId}/campaigns`, { method: "POST", body });
}

export async function getCampaign(projectId: string, id: string): Promise<CampaignDetail> {
  return apiFetch(`/projects/${projectId}/campaigns/${id}`);
}

/** 生成 3 个角度。异步：POST 建 job → 轮询直到完成（防生产网关超时）。 */
export async function generateVariants(projectId: string, id: string): Promise<{ generated: number; droppedRefs: number }> {
  return startAndWait<{ generated: number; droppedRefs: number }>(
    `/projects/${projectId}/campaigns/${id}/generate`,
    (jobId) => `/projects/${projectId}/campaigns/${id}/generate/jobs/${jobId}`,
  );
}

export async function regenerateVariant(projectId: string, id: string, vid: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/campaigns/${id}/variants/${vid}/regenerate`, { method: "POST" });
}

/** 采纳一个角度（3.6 消费出口） */
export async function adoptVariant(projectId: string, id: string, vid: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/campaigns/${id}/variants/${vid}/adopt`, { method: "POST" });
}

export async function addManualVariant(
  projectId: string, id: string,
  body: { angle?: string; hook?: string; body: string; cta?: string; claimIds?: string[] },
): Promise<{ id: string }> {
  return apiFetch(`/projects/${projectId}/campaigns/${id}/variants`, { method: "POST", body });
}
