/**
 * Ingestion 模块类型 — feat-200.2 Week 2
 */

export type IngestionStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * 5 个 stage 名称固定，与 rag-core 的 ingestion 链对齐。
 * 未来加 transform 等需要同步前端 SSE 解析。
 */
/**
 * Ingestion 6 阶段。
 *   idempotency  去重校验
 *   preprocess   文档解析
 *   chunk        文本分块
 *   transform    chunk 增强（summary-keywords 注入 TF 关键词+摘要 提升召回，实验 5/6 验证最优）
 *   embedding    向量化
 *   storage      写入 pgvector
 *
 * transform 位置：chunk 之后、embedding 之前——embedding 用 enhancedText
 * （chunk.text + 注入的关键词/摘要），retrieval 时语义信号更强。
 */
export const INGESTION_STAGES = [
  "idempotency",
  "preprocess",
  "chunk",
  "transform",
  "embedding",
  "storage",
] as const;
export type IngestionStage = (typeof INGESTION_STAGES)[number];

/**
 * 单个 stage 的输出摘要（不是完整 trace；是供前端展示"做了什么"的精炼版）。
 * 每个 stage 自己决定填哪些字段，前端按存在性渲染。
 *
 * - method：rag-core 选用的 methodId（如 "markdown-structure" / "openai-3-small"）
 * - durationMs：本 stage 在 runner 内的真实耗时
 * - metrics：扁平的 key→value，供前端 chip 展示（如 chunkSize=600, dimension=1024）
 * - note：可选一行人类可读补充（如 "mock embedding（无 API key）"）
 */
export interface IngestionStageOutput {
  method: string;
  durationMs: number;
  metrics?: Record<string, string | number | boolean>;
  note?: string;
}

export type IngestionStageOutputs = Partial<Record<IngestionStage, IngestionStageOutput>>;

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
  /** 5 个 stage 各自的输出摘要（completed 后填齐；失败时只有已跑完的 stage） */
  stageOutputs: IngestionStageOutputs;
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
