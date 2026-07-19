/**
 * 视觉资产 API client — feat-400.5 前端
 * 上传走 multipart（apiFetch 只处理 JSON，这里用原生 fetch）。
 */

import { apiFetch, apiBaseUrl, authToken, ApiError } from "./client";

export const ASSET_KINDS = ["logo", "hero_image", "atmosphere", "feature_screenshot", "product_screenshot", "reference_poster", "font"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface VisualAsset {
  id: string;
  project_id: string;
  kind: AssetKind;
  hash: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  label: string | null;
  claim_id: string | null;
  origin: "website" | "document" | "user" | "platform";
  status: "uploaded" | "approved" | "archived";
  created_at: string;
}

export async function listAssets(projectId: string): Promise<VisualAsset[]> {
  const res = await apiFetch<{ assets: VisualAsset[] }>(`/projects/${projectId}/assets`);
  return res.assets;
}

export async function uploadAsset(
  projectId: string,
  file: File,
  kind: AssetKind,
  label?: string,
): Promise<VisualAsset> {
  const fd = new FormData();
  fd.set("file", file);
  fd.set("kind", kind);
  if (label) fd.set("label", label);
  const token = authToken();
  const res = await fetch(`${apiBaseUrl()}/projects/${projectId}/assets`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd, // 不设 Content-Type，浏览器自动带 boundary
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "upload_failed", json?.error?.message ?? "上传失败");
  return json.asset;
}

export async function approveAsset(projectId: string, assetId: string): Promise<VisualAsset> {
  const res = await apiFetch<{ asset: VisualAsset }>(
    `/projects/${projectId}/assets/${assetId}/approve`,
    { method: "POST" },
  );
  return res.asset;
}

/** 保存图片类型与对应卖点标签，后续海报和素材筛选复用同一份资产元数据。 */
export async function updateAssetTags(
  projectId: string,
  assetId: string,
  input: { kind: AssetKind; claimId: string | null },
): Promise<VisualAsset> {
  const res = await apiFetch<{ asset: VisualAsset }>(`/projects/${projectId}/assets/${assetId}/tags`, {
    method: "PATCH",
    body: input,
  });
  return res.asset;
}

/** 删除视觉资产及其文件，画廊删除后不会留下不可见的存储对象。 */
export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/assets/${assetId}`, { method: "DELETE" });
}

/** 拉资产图片 blob → object URL（缩略图，用完 revoke） */
export async function assetFileUrl(projectId: string, assetId: string): Promise<string> {
  const token = authToken();
  const res = await fetch(`${apiBaseUrl()}/projects/${projectId}/assets/${assetId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("图片加载失败");
  return URL.createObjectURL(await res.blob());
}
