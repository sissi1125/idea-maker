/**
 * Product Brief API client — feat-400.1 slice 3
 *
 * 对接后端 ProductBriefController（注意后端返回的是原始 SQL 行，字段是 snake_case）：
 *   POST   /projects/:pid/product-brief/extract               从文档 LLM 提取候选
 *   GET    /projects/:pid/product-brief                        全景（brief + fields + issues）
 *   POST   /projects/:pid/product-brief/fields                 新增/更新候选字段
 *   POST   /projects/:pid/product-brief/fields/:fid/confirm    确认字段
 *   PATCH  /projects/:pid/product-brief/fields/:fid            编辑字段（事实型需 reason）
 *   POST   /projects/:pid/product-brief/fields/:fid/reject     拒绝字段
 *   POST   /projects/:pid/product-brief/confirm                确认整份 Brief
 */

import { apiFetch } from "./client";
import { startAndWait } from "./jobs";

export const BRIEF_FIELD_GROUPS = [
  "identity",
  "fact",
  "audience",
  "positioning",
  "style",
  "visual",
  "constraint",
] as const;
export type BriefFieldGroup = (typeof BRIEF_FIELD_GROUPS)[number];

/** 事实型分组：编辑时必须填修改原因 */
export const FACTUAL_GROUPS: readonly BriefFieldGroup[] = [
  "identity",
  "fact",
  "audience",
  "positioning",
];

export type BriefFieldSource =
  | "document"
  | "website"
  | "user"
  | "historical_content"
  | "inferred";
export type BriefFieldStatus = "candidate" | "confirmed" | "rejected" | "stale";

export interface BriefField {
  id: string;
  brief_id: string;
  field_group: BriefFieldGroup;
  field_key: string;
  value: unknown;
  source: BriefFieldSource;
  evidence_chunk_ids: string[];
  confidence: number;
  status: BriefFieldStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BriefContainer {
  id: string;
  project_id: string;
  version: number;
  status: "draft" | "confirmed";
  created_at: string;
  updated_at: string;
}

export interface BriefIssues {
  missingRequired: Array<{ group: BriefFieldGroup; key: string }>;
  unverifiedFacts: Array<{ id: string; group: BriefFieldGroup; key: string; source: BriefFieldSource }>;
}

export interface BriefSnapshot {
  brief: BriefContainer;
  fields: BriefField[];
  issues: BriefIssues;
}

export interface ExtractResult {
  extracted: number;
  chunkCount: number;
  truncated: boolean;
  fields: Array<{ group: BriefFieldGroup; key: string; source: string; evidenceCount: number }>;
}

export interface UpsertFieldInput {
  group: BriefFieldGroup;
  key: string;
  value: unknown;
  source?: BriefFieldSource;
  evidenceChunkIds?: string[];
  confidence?: number;
}

export async function getBrief(projectId: string): Promise<BriefSnapshot> {
  return apiFetch<BriefSnapshot>(`/projects/${projectId}/product-brief`);
}

/**
 * 从文档/官网 LLM 提取候选字段。异步：POST 建 job → 轮询直到完成（避免同步长请求被网关掐断）。
 */
export async function extractBrief(projectId: string): Promise<ExtractResult> {
  return startAndWait<ExtractResult>(
    `/projects/${projectId}/product-brief/extract`,
    (jobId) => `/projects/${projectId}/product-brief/extract/jobs/${jobId}`,
  );
}

export async function upsertField(projectId: string, body: UpsertFieldInput): Promise<BriefField> {
  const res = await apiFetch<{ field: BriefField }>(
    `/projects/${projectId}/product-brief/fields`,
    { method: "POST", body },
  );
  return res.field;
}

export async function confirmField(projectId: string, fieldId: string): Promise<BriefField> {
  const res = await apiFetch<{ field: BriefField }>(
    `/projects/${projectId}/product-brief/fields/${fieldId}/confirm`,
    { method: "POST" },
  );
  return res.field;
}

export async function editField(
  projectId: string,
  fieldId: string,
  body: { value: unknown; reason?: string },
): Promise<BriefField> {
  const res = await apiFetch<{ field: BriefField }>(
    `/projects/${projectId}/product-brief/fields/${fieldId}`,
    { method: "PATCH", body },
  );
  return res.field;
}

export async function rejectField(
  projectId: string,
  fieldId: string,
  reason?: string,
): Promise<BriefField> {
  const res = await apiFetch<{ field: BriefField }>(
    `/projects/${projectId}/product-brief/fields/${fieldId}/reject`,
    { method: "POST", body: { reason } },
  );
  return res.field;
}

export async function confirmBrief(projectId: string): Promise<BriefContainer> {
  const res = await apiFetch<{ brief: BriefContainer }>(
    `/projects/${projectId}/product-brief/confirm`,
    { method: "POST" },
  );
  return res.brief;
}
