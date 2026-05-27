/**
 * Documents API — feat-200.6 Week 6
 *
 * 端点（Week 2 后端）：
 *   GET    /documents                               列表
 *   POST   /documents                               上传（multipart/form-data 或 JSON text）
 *   DELETE /documents/:id                           删除
 *   GET    /projects/:pid/ingestion                 列出 ingestion jobs
 *   GET    /projects/:pid/ingestion/:jobId          轮询 job 状态
 *   GET    /projects/:pid/ingestion/:jobId/events   SSE 进度流
 *
 * 设计：
 *   - 上传用 FormData（支持真实文件 + multipart）
 *   - SSE 用原生 EventSource（浏览器内建，自动重连）
 *   - ingestion 进度轮询作为 SSE 的降级方案
 */

import { apiFetch } from "./client";

// ── 类型 ──────────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface IngestionJob {
  id: string;
  documentId: string;
  projectId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  stage: string | null;
  chunksCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── 文档 CRUD ─────────────────────────────────────────────────────────────

/** 获取文档列表 */
export async function listDocuments(): Promise<{ documents: Document[] }> {
  return apiFetch<{ documents: Document[] }>("/documents");
}

/**
 * 上传文件（multipart/form-data）。
 * 不走 apiFetch 的 JSON 封装，直接用 fetch + FormData。
 */
export async function uploadDocument(
  file: File,
  category?: string,
): Promise<{ document: Document }> {
  const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const formData = new FormData();
  formData.append("file", file);
  if (category) formData.append("category", category);

  // 手动构建 headers（不设 Content-Type，让浏览器自动加 boundary）
  const token =
    typeof window !== "undefined"
      ? JSON.parse(localStorage.getItem("harness-auth") ?? "{}")?.state?.token
      : null;

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/documents`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error?.message ?? `Upload failed: ${res.status}`);
  }

  return res.json();
}

/** 删除文档 */
export async function deleteDocument(id: string): Promise<void> {
  return apiFetch<void>(`/documents/${id}`, { method: "DELETE" });
}

// ── Ingestion ─────────────────────────────────────────────────────────────

/** 列出项目的 ingestion jobs */
export async function listIngestionJobs(
  projectId: string,
): Promise<{ jobs: IngestionJob[] }> {
  return apiFetch<{ jobs: IngestionJob[] }>(
    `/projects/${projectId}/ingestion`,
  );
}

/** 轮询单个 job 状态 */
export async function getIngestionJob(
  projectId: string,
  jobId: string,
): Promise<{ job: IngestionJob }> {
  return apiFetch<{ job: IngestionJob }>(
    `/projects/${projectId}/ingestion/${jobId}`,
  );
}

/**
 * 连接 ingestion SSE 流。
 * 返回 EventSource 实例，调用者可监听 message / error 事件。
 *
 * 注意：EventSource 不支持 Authorization header，
 * 后端 SSE 端点改用 query param ?token=xxx（Week 2 已支持）。
 */
export function connectIngestionSSE(
  projectId: string,
  jobId: string,
  token: string,
): EventSource {
  const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const url = `${BASE_URL}/projects/${projectId}/ingestion/${jobId}/events?token=${encodeURIComponent(token)}`;
  return new EventSource(url);
}
