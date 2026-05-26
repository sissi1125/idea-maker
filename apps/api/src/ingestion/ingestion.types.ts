/**
 * Ingestion 模块类型 — feat-200.2 Week 2
 */

export type IngestionStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * 5 个 stage 名称固定，与 rag-core 的 ingestion 链对齐。
 * 未来加 transform 等需要同步前端 SSE 解析。
 */
export const INGESTION_STAGES = [
  "idempotency",
  "preprocess",
  "chunk",
  "embedding",
  "storage",
] as const;
export type IngestionStage = (typeof INGESTION_STAGES)[number];

export interface IngestionJobRow {
  id: string;
  projectId: string;
  documentId: string;
  status: IngestionStatus;
  progress: number; // 0-100
  currentStage: IngestionStage | null;
  chunksDone: number;
  chunksTotal: number;
  costUsd: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 事件名称（@nestjs/event-emitter 用 wildcard 监听）。
 * SSE 流监听 `ingestion.${jobId}.*`，无关 job 不打扰。
 */
export const INGESTION_EVENT = {
  progress: "ingestion.progress",
  completed: "ingestion.completed",
  failed: "ingestion.failed",
} as const;

export interface IngestionProgressEvent {
  jobId: string;
  projectId: string;
  documentId: string;
  status: IngestionStatus;
  progress: number;
  currentStage: IngestionStage | null;
  chunksDone: number;
  chunksTotal: number;
}

export interface IngestionCompletedEvent {
  jobId: string;
  projectId: string;
  documentId: string;
  chunksTotal: number;
  costUsd: number;
}

export interface IngestionFailedEvent {
  jobId: string;
  projectId: string;
  documentId: string;
  stage: IngestionStage | null;
  error: string;
}
