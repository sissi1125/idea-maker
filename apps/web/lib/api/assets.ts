/**
 * 视觉资产 API client — feat-400.5 前端
 * 上传走 multipart（apiFetch 只处理 JSON，这里用原生 fetch）。
 */

import { apiFetch, apiBaseUrl, authToken, ApiError } from "./client";

export const ASSET_KINDS = ["logo", "product_screenshot", "reference_poster", "font"] as const;
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
