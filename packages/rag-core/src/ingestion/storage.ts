/**
 * RAG Pipeline Stage 6 - Storage - 纯算法（依赖注入 pgClient）
 *
 * 3 种 method：
 *   pgvector-upsert-version    INSERT ... ON CONFLICT DO UPDATE（conflictPolicy=upsert/error）
 *   pgvector-new-version       max(version) + 1 全量插入（保留历史版本）
 *   pgvector-replace-version   DELETE 该 doc 全部版本 → INSERT 新（省空间）
 *
 * 表结构（自动 DDL 初始化）：
 *   rag_documents  文档级元数据（id/document_id/version/file_name/content_hash）
 *   rag_chunks     chunk + 向量，含 UNIQUE(document_id, version, chunk_index)
 *
 * Dimension Guard：
 *   写入前 SELECT 一行已有向量的维度，与本次写入对比；不一致返回 dimension_mismatch
 *   防止不同 embedding provider 混入同表导致检索错乱
 *
 * 索引模式：
 *   HNSW / IVFFlat 都需要 vector 列声明明确维度；本算法在写入后 ALTER COLUMN
 *   把列类型从 vector → vector(N) 再建索引；none 时跳过
 */

import type {
  StorageInput,
  StorageOutput,
  StorageResult,
  StorageIndexMode,
  PgClient,
  EmbeddedChunk,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const DDL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_documents (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  file_name    TEXT,
  content_hash TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rag_docs_document_id ON rag_documents (document_id);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id                  TEXT PRIMARY KEY,
  document_id         TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  chunk_index         INTEGER NOT NULL,
  text                TEXT NOT NULL,
  enhanced_text       TEXT NOT NULL,
  source_ref          TEXT DEFAULT '',
  char_count          INTEGER DEFAULT 0,
  token_estimate      INTEGER DEFAULT 0,
  keywords            TEXT[] DEFAULT '{}',
  embedding_dimension INTEGER,
  embedding           vector,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, version, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id ON rag_chunks (document_id, version);

-- feat-200.8.x P0：每个 chunk 归属一个 project_id，retrieval 严格按 project 隔离。
-- ALTER 让历史表升级；新表 CREATE 时已含。eval-matrix 写入用 'eval-matrix' 字符串。
ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_rag_chunks_project ON rag_chunks (project_id);
`;

// ─── Dimension Guard ──────────────────────────────────────────────────────────

async function checkDimension(
  client: PgClient,
  incomingDimension: number,
): Promise<{ ok: boolean; existingDimension: number | null }> {
  const res = await client.query<{ embedding_dimension: number }>(
    "SELECT embedding_dimension FROM rag_chunks WHERE embedding_dimension IS NOT NULL LIMIT 1",
  );
  if (res.rows.length === 0) return { ok: true, existingDimension: null };
  const existing = res.rows[0].embedding_dimension;
  return { ok: existing === incomingDimension, existingDimension: existing };
}

// ─── 索引管理 ─────────────────────────────────────────────────────────────────

async function ensureVectorIndex(
  client: PgClient,
  indexMode: StorageIndexMode,
  dimension: number,
): Promise<{ created: boolean; skipped: boolean; reason?: string }> {
  if (indexMode === "none") return { created: false, skipped: true, reason: "indexMode=none" };

  const existing = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'rag_chunks' AND indexname LIKE 'idx_rag_chunks_embedding_%'`,
  );
  if (existing.rows.length > 0) {
    return { created: false, skipped: true, reason: "索引已存在，跳过重建" };
  }

  // HNSW/IVFFlat 要求 vector 列声明明确维度；DDL 用无维度 vector 保灵活，
  // 此处补充。Dimension Guard 已确保表内维度一致。
  try {
    await client.query(
      `ALTER TABLE rag_chunks ALTER COLUMN embedding TYPE vector(${dimension})`,
    );
  } catch {
    // 列已是正确类型时 psql 可能报 "nothing to alter"，忽略
  }

  const rowCountRes = await client.query<{ cnt: string }>("SELECT COUNT(*) AS cnt FROM rag_chunks");
  const rowCount = parseInt(rowCountRes.rows[0].cnt, 10);

  if (indexMode === "hnsw") {
    await client.query(
      `CREATE INDEX idx_rag_chunks_embedding_hnsw
       ON rag_chunks USING hnsw (embedding vector_cosine_ops)`,
    );
  } else {
    // IVFFlat: lists = max(1, sqrt(rowCount)) 经验值
    const lists = Math.max(1, Math.round(Math.sqrt(rowCount)));
    await client.query(
      `CREATE INDEX idx_rag_chunks_embedding_ivfflat
       ON rag_chunks USING ivfflat (embedding vector_cosine_ops)
       WITH (lists = ${lists})`,
    );
  }

  return { created: true, skipped: false };
}

// ─── 写入 chunks ──────────────────────────────────────────────────────────────

async function upsertChunks(
  client: PgClient,
  chunks: EmbeddedChunk[],
  documentId: string,
  version: number,
  conflictPolicy: "upsert" | "error",
  projectId: string,
): Promise<void> {
  for (const chunk of chunks) {
    const id = `${documentId}_v${version}_c${chunk.index}`;
    const embeddingStr = `[${chunk.embedding.join(",")}]`;

    if (conflictPolicy === "error") {
      // 让数据库 UNIQUE 自然报错
      await client.query(
        `INSERT INTO rag_chunks
           (id, document_id, project_id, version, chunk_index, text, enhanced_text,
            source_ref, char_count, token_estimate, keywords, embedding_dimension, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector)`,
        [
          id, documentId, projectId, version, chunk.index,
          chunk.text, chunk.enhancedText ?? chunk.text, chunk.sourceRef,
          chunk.charCount, chunk.tokenEstimate, chunk.keywords ?? [],
          chunk.embeddingDimension, embeddingStr,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO rag_chunks
           (id, document_id, project_id, version, chunk_index, text, enhanced_text,
            source_ref, char_count, token_estimate, keywords, embedding_dimension, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector)
         ON CONFLICT (document_id, version, chunk_index) DO UPDATE SET
           project_id          = EXCLUDED.project_id,
           text                = EXCLUDED.text,
           enhanced_text       = EXCLUDED.enhanced_text,
           source_ref          = EXCLUDED.source_ref,
           char_count          = EXCLUDED.char_count,
           token_estimate      = EXCLUDED.token_estimate,
           keywords            = EXCLUDED.keywords,
           embedding_dimension = EXCLUDED.embedding_dimension,
           embedding           = EXCLUDED.embedding`,
        [
          id, documentId, projectId, version, chunk.index,
          chunk.text, chunk.enhancedText ?? chunk.text, chunk.sourceRef,
          chunk.charCount, chunk.tokenEstimate, chunk.keywords ?? [],
          chunk.embeddingDimension, embeddingStr,
        ],
      );
    }
  }
}

async function getNextVersion(client: PgClient, documentId: string): Promise<number> {
  const res = await client.query<{ max_version: number | null }>(
    "SELECT MAX(version) AS max_version FROM rag_chunks WHERE document_id = $1",
    [documentId],
  );
  return (res.rows[0].max_version ?? 0) + 1;
}

async function deleteAllVersions(client: PgClient, documentId: string): Promise<void> {
  await client.query("DELETE FROM rag_chunks WHERE document_id = $1", [documentId]);
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runStorage(input: StorageInput): Promise<StorageResult> {
  const { methodId, params, upstreamChunks, dimension, documentId, projectId, pgClient } = input;

  if (!pgClient) {
    throw new PipelineError(
      "missing_client",
      "storage 需要注入 pg.Client / pg.Pool；路由层应创建并 connect 后传入 Input.pgClient",
    );
  }
  if (!projectId || !projectId.trim()) {
    throw new PipelineError(
      "missing_project_id",
      "storage 需要 projectId（feat-200.8.x P0 强制隔离）：MVP 传 project UUID，" +
        "Legacy/Playground 传 'legacy-playground'，eval-matrix 传 'eval-matrix'",
    );
  }

  if (!upstreamChunks || upstreamChunks.length === 0) {
    throw new PipelineError("empty_chunks", "上游 Embedding 未产出任何 chunk");
  }

  const { indexMode, conflictPolicy, truncateTable } = params;
  const warnings: string[] = [];

  // 初始化表结构
  await pgClient.query(DDL);

  // truncate（仅 dev 调试）：清空 + 重置维度列
  if (truncateTable) {
    await pgClient.query("TRUNCATE TABLE rag_chunks");
    await pgClient.query(
      "DROP INDEX IF EXISTS idx_rag_chunks_embedding_hnsw; DROP INDEX IF EXISTS idx_rag_chunks_embedding_ivfflat",
    );
    // TRUNCATE 只删行，维度列约束 vector(N) 持久保留——切换维度时必须还原
    await pgClient.query("ALTER TABLE rag_chunks ALTER COLUMN embedding TYPE vector");
    warnings.push("truncateTable=true：已清空 rag_chunks 表所有历史数据并重置列类型，可写入新维度向量");
  }

  // Dimension Guard
  const dimCheck = await checkDimension(pgClient, dimension);
  if (!dimCheck.ok) {
    throw new PipelineError(
      "dimension_mismatch",
      `Dimension Guard 失败：表内已有维度为 ${dimCheck.existingDimension} 的向量，本次写入维度为 ${dimension}。` +
        "可选方案：①开启 truncateTable=true 清空历史数据；②使用相同 embedding provider；③改用 pgvector-replace-version 方法（仅删除当前文档的旧向量）。",
      { existingDimension: dimCheck.existingDimension, incomingDimension: dimension },
    );
  }
  const freshTable = dimCheck.existingDimension === null || truncateTable;

  // 根据 method 确定版本
  let version: number;
  switch (methodId) {
    case "pgvector-new-version":
      version = await getNextVersion(pgClient, documentId);
      break;
    case "pgvector-replace-version":
      await deleteAllVersions(pgClient, documentId);
      version = 1;
      break;
    case "pgvector-upsert-version":
    default: {
      // 用当前 max(version)，无则 1
      const maxRes = await pgClient.query<{ max_version: number | null }>(
        "SELECT MAX(version) AS max_version FROM rag_chunks WHERE document_id = $1",
        [documentId],
      );
      version = maxRes.rows[0].max_version ?? 1;
      break;
    }
  }

  await upsertChunks(pgClient, upstreamChunks, documentId, version, conflictPolicy, projectId);

  // 建索引
  const indexResult = await ensureVectorIndex(pgClient, indexMode, dimension);
  if (indexResult.skipped && indexResult.reason) {
    warnings.push(`向量索引：${indexResult.reason}`);
  }

  const output: StorageOutput = {
    storedChunks: upstreamChunks.length,
    documentId,
    version,
    dimension,
    indexMode,
    indexCreated: indexResult.created,
    freshTable,
    warnings,
  };

  return {
    output,
    trace: {
      methodId,
      documentId,
      version,
      storedChunks: upstreamChunks.length,
      dimension,
      indexMode,
      indexCreated: indexResult.created,
      freshTable,
    },
    warnings,
  };
}
