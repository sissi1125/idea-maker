import { z } from "zod";
import type { EmbeddedChunk } from "./embedding";

/**
 * Storage - 共享类型定义
 *
 * 3 种冲突策略：
 *   pgvector-upsert-version    INSERT ... ON CONFLICT (document_id, version, chunk_index) DO UPDATE
 *                              （conflictPolicy=error 时改用裸 INSERT，让 UNIQUE 自然报错）
 *   pgvector-new-version       查询 max(version) → +1 全量插入新版本（保留历史）
 *   pgvector-replace-version   先 DELETE 该 documentId 所有版本 → INSERT 新版本（省空间）
 *
 * I/O 注入：
 *   PgClient 通过 Input.pgClient 注入。路由层创建 new Client({ connectionString })、
 *   await client.connect()，把已连接的实例传给 rag-core；rag-core 用完，路由层 finally end()。
 */

export const StorageMethodId = z.enum([
  "pgvector-upsert-version",
  "pgvector-new-version",
  "pgvector-replace-version",
]);
export type StorageMethodId = z.infer<typeof StorageMethodId>;

export const StorageConflictPolicy = z.enum(["upsert", "error"]);
export type StorageConflictPolicy = z.infer<typeof StorageConflictPolicy>;

export const StorageIndexMode = z.enum(["hnsw", "ivfflat", "none"]);
export type StorageIndexMode = z.infer<typeof StorageIndexMode>;

export const StorageParamsSchema = z.object({
  indexMode: StorageIndexMode.optional().default("hnsw"),
  conflictPolicy: StorageConflictPolicy.optional().default("upsert"),
  /** true 时清空 rag_chunks 表并重置维度列（仅 dev 调试用） */
  truncateTable: z.boolean().optional().default(false),
  /** 用户表单可填，覆盖 env DATABASE_URL；路由层负责解析 */
  connectionString: z.string().optional(),
});
export type StorageParams = z.infer<typeof StorageParamsSchema>;

/**
 * pg.Client / pg.Pool 的最小结构契约。
 * rag-core 只用 query 方法；connect / end 由路由层管理。
 *
 * 用泛型保留行类型推断；mock 时 vi.fn() 即可满足。
 */
export interface PgClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface StorageOutput {
  storedChunks: number;
  documentId: string;
  version: number;
  dimension: number;
  indexMode: StorageIndexMode;
  indexCreated: boolean;
  /** true 表示首次写入或刚 truncate 过 */
  freshTable: boolean;
  warnings: string[];
}

export interface StorageTrace {
  methodId: StorageMethodId;
  documentId: string;
  version: number;
  storedChunks: number;
  dimension: number;
  indexMode: StorageIndexMode;
  indexCreated: boolean;
  freshTable: boolean;
}

export interface StorageInput {
  methodId: StorageMethodId;
  params: StorageParams;
  upstreamChunks: EmbeddedChunk[];
  /** chunk 用的 dimension（取自上游 EmbeddingOutput） */
  dimension: number;
  /** documentId 来自 pipelineRun.selectedDocumentId */
  documentId: string;
  /**
   * feat-200.8.x P0：chunk 归属的 projectId。
   * - MVP: project 真实 UUID
   * - Legacy/eval-matrix: 字符串如 'eval-matrix' / 'legacy-playground'
   * 必填——retrieval 按 project_id 严格过滤，传错会导致检索不到自己的数据。
   */
  projectId: string;
  /** 已连接的 pg.Client / pg.Pool 实例；路由层创建并负责 lifecycle */
  pgClient: PgClient;
}

export interface StorageResult {
  output: StorageOutput;
  trace: StorageTrace;
  warnings: string[];
}
