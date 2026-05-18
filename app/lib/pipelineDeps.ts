/**
 * Pipeline Stage 依赖关系图
 *
 * 定义每个 stage 的上游依赖，用于：
 * 1. 在 UI 中展示"需要先运行 X 才能运行 Y"的阻塞原因
 * 2. 检测上游结果是否已过期（上游重跑后下游未跟进）
 *
 * 依赖关系遵循 RAG pipeline 的自然顺序：
 *   document-upload（文档入口）
 *     → idempotency（判断是否已入库）
 *       → preprocess（提取 cleanText）
 *         → chunk（切分为检索单元）
 *           → transform（增强 chunk）
 *             → embedding（向量化）
 *               → storage（写入向量库）
 *
 * 检索链独立于 ingestion 链，依赖 storage 完成后才有意义：
 *   query-rewrite → retrieval → filter → rerank → citation → generation
 */

/** stage 依赖配置：key 是当前 stage ID，value 是它必须等待的上游 stage ID */
export const STAGE_DEPS: Record<string, string> = {
  // ingestion 链：每个 stage 依赖上一步的输出
  idempotency: "document-upload",
  preprocess:  "idempotency",
  chunk:       "preprocess",
  transform:   "chunk",
  embedding:   "transform",
  storage:     "embedding",

  // retrieval 链：query-rewrite 是入口，后续各 stage 依次传递
  retrieval:   "query-rewrite",
  filter:      "retrieval",
  rerank:      "filter",
  citation:    "rerank",
  generation:  "citation",
};

/** 没有上游依赖的入口 stage（document-upload 和 query-rewrite） */
export const ENTRY_STAGES = new Set(["document-upload", "query-rewrite"]);

/** 根据 stageId 获取其上游 stage ID，入口 stage 返回 null */
export function getUpstream(stageId: string): string | null {
  return STAGE_DEPS[stageId] ?? null;
}
