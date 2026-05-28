/**
 * Documents API — feat-200.6 Week 6
 *
 * 对接 MvpDocumentsController（/projects/:pid/documents）
 * 注意：不是旧的 /documents（Playground 遗留）
 *
 * 端点（Week 2 后端）：
 *   POST   /projects/:pid/documents          上传（multipart + category）→ 自动触发 ingestion
 *   GET    /projects/:pid/documents?category= 列表
 *   GET    /projects/:pid/documents/:docId    单条
 *   DELETE /projects/:pid/documents/:docId    删除
 *   GET    /projects/:pid/ingestion           列出 ingestion jobs
 *   GET    /projects/:pid/ingestion/:jobId    轮询 job 状态
 *   GET    /projects/:pid/ingestion/:jobId/events  SSE 进度流
 *
 * 设计：
 *   - 上传走 FormData（multipart），返回 {document, ingestionJobId}
 *   - 前端拿 ingestionJobId 轮询或 SSE 订阅进度
 *   - category 必填（product / compete / history）
 */

import { apiFetch } from "./client";

// ── 类型（镜像后端 mvp-documents.types.ts） ────────────────────────────────

export type DocumentCategory = "product" | "compete" | "history";

export interface MvpDocument {
  id: string;
  projectId: string;
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  fileSize: number;
  hash: string;
  version: number;
  processingStatus: "queued" | "processing" | "ready" | "error";
  createdAt: string;
  updatedAt: string;
}

/** 5 个 ingestion stage 名称（与后端 IngestionStage 对齐） */
export type IngestionStage =
  | "idempotency"
  | "preprocess"
  | "chunk"
  | "embedding"
  | "storage";

/**
 * 单 stage 的输出摘要——feat-200.6 patch 新增。
 * - method：rag-core methodId
 * - durationMs：本 stage 在 runner 内的真实耗时
 * - metrics：扁平 key→value，前端按 chip 渲染
 * - note：一行可选补充说明（如 mock embedding 警告）
 */
export interface IngestionStageOutput {
  method: string;
  durationMs: number;
  metrics?: Record<string, string | number | boolean>;
  note?: string;
}

export type IngestionStageOutputs = Partial<Record<IngestionStage, IngestionStageOutput>>;

export interface IngestionJob {
  id: string;
  projectId: string;
  documentId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  currentStage: string | null;
  chunksDone: number;
  chunksTotal: number;
  costUsd: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 每个 stage 完成后写入；processing 中只有已完成的 stage 出现 */
  stageOutputs: IngestionStageOutputs;
}

// ── 文档 CRUD ─────────────────────────────────────────────────────────────

/** 获取项目文档列表（可按 category 过滤） */
export async function listDocuments(
  projectId: string,
  category?: DocumentCategory,
): Promise<{ documents: MvpDocument[] }> {
  const qs = category ? `?category=${category}` : "";
  return apiFetch<{ documents: MvpDocument[] }>(
    `/projects/${projectId}/documents${qs}`,
  );
}

/**
 * 上传文件到项目（multipart/form-data）。
 * 后端自动触发 ingestion job，返回 {document, ingestionJobId}。
 *
 * 不走 apiFetch 的 JSON 封装——FormData 需要浏览器自动设 boundary。
 */
export async function uploadDocument(
  projectId: string,
  file: File,
  category: DocumentCategory,
): Promise<{ document: MvpDocument; ingestionJobId: string }> {
  const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);

  // 手动构建 headers（不设 Content-Type，让浏览器自动加 boundary）
  const token =
    typeof window !== "undefined"
      ? JSON.parse(localStorage.getItem("harness-auth") ?? "{}")?.state?.token
      : null;

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/projects/${projectId}/documents`, {
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

/** 删除项目文档 */
export async function deleteDocument(
  projectId: string,
  docId: string,
): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/documents/${docId}`, {
    method: "DELETE",
  });
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
 * 注意：EventSource 不支持 Authorization header，
 * 后端 SSE 端点用 query param ?token=xxx。
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
