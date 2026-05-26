/**
 * MVP Documents 模块类型 — feat-200.2 Week 2
 *
 * 与原 DocumentsModule（apps/web/data/documents.json 走文件 store）刻意分离：
 *   - 旧模块：Playground 调试用，无 project / category 概念
 *   - 本模块：MVP 业务，文档属于项目，有 category，元数据入 PG，文件入磁盘
 */

export type DocumentCategory = "product" | "compete" | "history";

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "product",
  "compete",
  "history",
];

export type DocumentProcessingStatus =
  | "queued" // 已上传，等待 ingestion job 分派
  | "processing" // ingestion 进行中
  | "ready" // ingestion 完成，chunks/embeddings 已落库
  | "error"; // ingestion 失败，error 字段写到 ingestion_jobs

export interface DocumentRow {
  id: string;
  projectId: string;
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  fileSize: number;
  hash: string;
  version: number;
  processingStatus: DocumentProcessingStatus;
  /** 文件实际存储相对路径（相对于上传根目录），不直接暴露给前端 */
  storageRef: string;
  createdAt: string;
  updatedAt: string;
}
