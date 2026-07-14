/**
 * 海报 API client — feat-400.5 前端
 * PNG 预览需带鉴权，用原生 fetch 拿 blob 再 createObjectURL。
 */

import { apiFetch, apiBaseUrl, authToken } from "./client";

export interface PosterTemplate {
  id: string;
  width: number;
  height: number;
  limits: { title: number; subtitle: number; claim: number };
}
export interface PosterFailure { rule: string; detail: string; }
export interface RenderResult {
  posterId: string;
  passed: boolean;
  failures: PosterFailure[];
  ref?: string;
  width?: number;
  height?: number;
  bytes?: number;
}
export interface RenderInput {
  templateId: string;
  title: string;
  subtitle?: string;
  claimId?: string;
  logoAssetId?: string;
  bgColor?: string;
  fgColor?: string;
}

export async function getTemplates(projectId: string): Promise<PosterTemplate[]> {
  const res = await apiFetch<{ templates: PosterTemplate[] }>(`/projects/${projectId}/posters/templates`);
  return res.templates;
}

export async function renderPoster(projectId: string, input: RenderInput): Promise<RenderResult> {
  const res = await apiFetch<{ result: RenderResult }>(
    `/projects/${projectId}/posters/render`,
    { method: "POST", body: input },
  );
  return res.result;
}

/** 拉 PNG blob → object URL（用完记得 revokeObjectURL） */
export async function posterPngUrl(projectId: string, posterId: string): Promise<string> {
  const token = authToken();
  const res = await fetch(`${apiBaseUrl()}/projects/${projectId}/posters/${posterId}/png`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("海报加载失败");
  return URL.createObjectURL(await res.blob());
}
