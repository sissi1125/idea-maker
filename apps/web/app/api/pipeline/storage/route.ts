/**
 * RAG Pipeline Stage 6 - Storage（向量存储）
 *
 * 作用：将 Embedding 阶段产出的向量连同 chunk 元数据一起写入 PostgreSQL + pgvector，
 *       为后续向量检索提供持久化存储。
 *
 * Pipeline 位置：
 *   Embedding → [Storage] → （检索阶段）
 *
 * 表结构（自动初始化）：
 *
 *   rag_documents      文档级别的元数据，记录 documentId、版本、hash
 *   rag_chunks         Chunk 级别的向量和元数据，包含 embedding 列（pgvector）
 *
 * 三种冲突策略：
 *
 *   pgvector-upsert-version
 *     同一 (documentId, version, chunkIndex) 的 chunk 已存在时：
 *     - conflictPolicy=upsert：UPDATE 覆盖旧向量和元数据
 *     - conflictPolicy=error：抛出 UNIQUE VIOLATION，阻止重复入库
 *     适合多次调试同一文档时反复刷新向量
 *
 *   pgvector-new-version
 *     查询当前文档最大版本号，version+1 后全量插入新版本 chunk
 *     历史版本保留，可通过 metadata filter 指定版本检索
 *     适合文档更新后追踪历史版本
 *
 *   pgvector-replace-version
 *     先 DELETE 该 documentId 的所有旧版本 chunk，再 INSERT 新版本
 *     存储空间最省，适合只关心最新版本的场景
 *
 * 索引模式（indexMode）：
 *
 *   HNSW      近似最近邻，查询快（推荐生产）；建索引时需指定维度
 *   IVFFlat   倒排文件，建索引时需分桶数参数 lists = sqrt(rowCount)
 *   none      不建索引，小数据集（< 1000 chunks）可接受全量扫描
 *
 * Dimension Guard：
 *   写入前检查 rag_chunks 表已有向量的维度；若维度不匹配，返回错误并拒绝写入。
 *   防止不同 embedding provider 的向量混入同一表导致检索结果错乱。
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface EmbeddedChunk {
  index: number;
  text: string;
  /** Transform 禁用时为 undefined，storage 回退到 text */
  enhancedText?: string;
  sourceRef: string;
  charCount: number;
  tokenEstimate: number;
  enhancedTokenEstimate?: number;
  keywords?: string[];
  embedding: number[];
  embeddingDimension: number;
}

interface EmbeddingOutput {
  chunks: EmbeddedChunk[];
  chunkCount: number;
  dimension: number;
  provider: string;
  model: string;
  warnings: string[];
}

interface StorageOutput {
  storedChunks: number;
  documentId: string;
  version: number;
  dimension: number;
  indexMode: string;
  indexCreated: boolean;
  /** true 表示新表，false 表示已有数据的表 */
  freshTable: boolean;
  warnings: string[];
}

// ─── DDL：自动初始化表结构 ────────────────────────────────────────────────────

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
`;

// ─── Dimension Guard ──────────────────────────────────────────────────────────

/**
 * 检查表内现有向量维度是否与本次写入维度一致。
 * 若表为空或无向量行，则跳过检查（first-write）。
 */
async function checkDimension(
  client: Client,
  incomingDimension: number
): Promise<{ ok: boolean; existingDimension: number | null }> {
  const res = await client.query<{ embedding_dimension: number }>(
    "SELECT embedding_dimension FROM rag_chunks WHERE embedding_dimension IS NOT NULL LIMIT 1"
  );
  if (res.rows.length === 0) return { ok: true, existingDimension: null };
  const existing = res.rows[0].embedding_dimension;
  return { ok: existing === incomingDimension, existingDimension: existing };
}

// ─── 索引管理 ──────────────────────────────────────────────────────────────────

/**
 * 为 rag_chunks.embedding 创建向量索引。
 * HNSW / IVFFlat 都需要知道向量维度（通过 operator class 隐含）。
 * 小表（< 1000 行）时 IVFFlat 的 lists 参数用 1，避免 "too few rows" 错误。
 */
/**
 * 为 rag_chunks.embedding 创建向量索引。
 * HNSW / IVFFlat 都要求列有明确维度。DDL 里 embedding 定义为 `vector`（无维度）以保持灵活性，
 * 因此建索引前先 ALTER COLUMN embedding TYPE vector(N)。
 * Dimension Guard 已确保表内所有向量维度一致，ALTER 是安全操作。
 */
async function ensureVectorIndex(
  client: Client,
  indexMode: string,
  dimension: number
): Promise<{ created: boolean; skipped: boolean; reason?: string }> {
  if (indexMode === "none") return { created: false, skipped: true, reason: "indexMode=none" };

  // 检查索引是否已存在
  const existing = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'rag_chunks' AND indexname LIKE 'idx_rag_chunks_embedding_%'`
  );
  if (existing.rows.length > 0) {
    return { created: false, skipped: true, reason: "索引已存在，跳过重建" };
  }

  // HNSW / IVFFlat 要求 embedding 列类型为 vector(N)（有明确维度）。
  // DDL 建表时用无维度 `vector` 保持灵活；此处在已写入数据后补充维度。
  // Dimension Guard 确保表内维度一致，ALTER COLUMN 不会产生数据冲突。
  try {
    await client.query(
      `ALTER TABLE rag_chunks ALTER COLUMN embedding TYPE vector(${dimension})`
    );
  } catch {
    // 极端情况（列已是正确类型时 psql 可能报 "nothing to alter"），忽略即可
  }

  const rowCountRes = await client.query<{ cnt: string }>("SELECT COUNT(*) AS cnt FROM rag_chunks");
  const rowCount = parseInt(rowCountRes.rows[0].cnt, 10);

  if (indexMode === "hnsw") {
    // HNSW: m（连接数）和 ef_construction（构建质量）使用默认值即可
    await client.query(`
      CREATE INDEX idx_rag_chunks_embedding_hnsw
      ON rag_chunks USING hnsw (embedding vector_cosine_ops)
    `);
  } else {
    // IVFFlat: lists = max(1, sqrt(rowCount)) 经验值
    const lists = Math.max(1, Math.round(Math.sqrt(rowCount)));
    await client.query(`
      CREATE INDEX idx_rag_chunks_embedding_ivfflat
      ON rag_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = ${lists})
    `);
  }

  return { created: true, skipped: false };
}

// ─── 三种写入策略 ─────────────────────────────────────────────────────────────

async function upsertChunks(
  client: Client,
  chunks: EmbeddedChunk[],
  documentId: string,
  version: number,
  conflictPolicy: string
): Promise<void> {
  for (const chunk of chunks) {
    const id = `${documentId}_v${version}_c${chunk.index}`;
    const embeddingStr = `[${chunk.embedding.join(",")}]`;

    if (conflictPolicy === "error") {
      // 让数据库 UNIQUE 约束自然报错
      await client.query(
        `INSERT INTO rag_chunks
           (id, document_id, version, chunk_index, text, enhanced_text,
            source_ref, char_count, token_estimate, keywords, embedding_dimension, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)`,
        [
          id, documentId, version, chunk.index,
          chunk.text, chunk.enhancedText ?? chunk.text, chunk.sourceRef,
          chunk.charCount, chunk.tokenEstimate, chunk.keywords,
          chunk.embeddingDimension, embeddingStr,
        ]
      );
    } else {
      // upsert：冲突时更新向量和元数据
      await client.query(
        `INSERT INTO rag_chunks
           (id, document_id, version, chunk_index, text, enhanced_text,
            source_ref, char_count, token_estimate, keywords, embedding_dimension, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)
         ON CONFLICT (document_id, version, chunk_index) DO UPDATE SET
           text               = EXCLUDED.text,
           enhanced_text      = EXCLUDED.enhanced_text,
           source_ref         = EXCLUDED.source_ref,
           char_count         = EXCLUDED.char_count,
           token_estimate     = EXCLUDED.token_estimate,
           keywords           = EXCLUDED.keywords,
           embedding_dimension = EXCLUDED.embedding_dimension,
           embedding          = EXCLUDED.embedding`,
        [
          id, documentId, version, chunk.index,
          chunk.text, chunk.enhancedText ?? chunk.text, chunk.sourceRef,
          chunk.charCount, chunk.tokenEstimate, chunk.keywords,
          chunk.embeddingDimension, embeddingStr,
        ]
      );
    }
  }
}

async function getNextVersion(client: Client, documentId: string): Promise<number> {
  const res = await client.query<{ max_version: number | null }>(
    "SELECT MAX(version) AS max_version FROM rag_chunks WHERE document_id = $1",
    [documentId]
  );
  return (res.rows[0].max_version ?? 0) + 1;
}

async function deleteAllVersions(client: Client, documentId: string): Promise<void> {
  await client.query("DELETE FROM rag_chunks WHERE document_id = $1", [documentId]);
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    pipelineRun: { selectedDocumentId?: string };
    upstreamOutput: EmbeddingOutput | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  const { methodId, params, pipelineRun, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      {
        error: {
          code: "missing_upstream",
          message: "缺少上游 Embedding 产物，请先成功运行 Embedding Stage",
        },
      },
      { status: 400 }
    );
  }

  const { chunks, dimension } = upstreamOutput;
  if (!chunks || chunks.length === 0) {
    return NextResponse.json(
      { error: { code: "empty_chunks", message: "上游 Embedding 未产出任何 chunk" } },
      { status: 400 }
    );
  }

  const connectionString =
    (typeof params.connectionString === "string" && params.connectionString.trim())
      ? params.connectionString.trim()
      : process.env.DATABASE_URL;

  if (!connectionString) {
    return NextResponse.json(
      {
        error: {
          code: "missing_connection",
          message:
            "缺少数据库连接串：请在表单 \"数据库连接串\" 字段中填写，或设置 DATABASE_URL 环境变量",
        },
      },
      { status: 400 }
    );
  }

  const indexMode = String(params.indexMode ?? "hnsw");
  const conflictPolicy = String(params.conflictPolicy ?? "upsert");
  const documentId = pipelineRun?.selectedDocumentId ?? "unknown-doc";
  const warnings: string[] = [];

  const client = new Client({ connectionString });

  try {
    await client.connect();

    // 初始化表结构
    await client.query(DDL);

    // truncateTable：在 Dimension Guard 之前清空所有历史向量（开发调试用）
    const truncateTable = params.truncateTable === true || params.truncateTable === "true";
    if (truncateTable) {
      await client.query("TRUNCATE TABLE rag_chunks");
      // 删除旧向量索引（维度变化后必须重建）
      await client.query(
        "DROP INDEX IF EXISTS idx_rag_chunks_embedding_hnsw; DROP INDEX IF EXISTS idx_rag_chunks_embedding_ivfflat"
      );
      // TRUNCATE 只删行，ALTER COLUMN 的维度约束（vector(N)）会持久保留。
      // 切换 embedding 维度时必须先把列类型还原为无维度的 vector，
      // 否则 Dimension Guard 通过（查不到行）但 INSERT 仍会被 pg 拒绝。
      await client.query(
        "ALTER TABLE rag_chunks ALTER COLUMN embedding TYPE vector"
      );
      warnings.push("truncateTable=true：已清空 rag_chunks 表所有历史数据并重置列类型，可写入新维度向量");
    }

    // Dimension Guard：检查现有向量维度是否与本次写入一致
    const dimCheck = await checkDimension(client, dimension);
    if (!dimCheck.ok) {
      await client.end();
      return NextResponse.json(
        {
          error: {
            code: "dimension_mismatch",
            message: `Dimension Guard 失败：表内已有维度为 ${dimCheck.existingDimension} 的向量，本次写入维度为 ${dimension}。` +
              `可选方案：①开启 truncateTable=true 清空历史数据；②使用相同 embedding provider；③改用 pgvector-replace-version 方法（仅删除当前文档的旧向量）。`,
          },
        },
        { status: 409 }
      );
    }
    const freshTable = dimCheck.existingDimension === null || truncateTable;

    // 根据方法确定版本号并写入
    let version: number;

    if (methodId === "pgvector-new-version") {
      version = await getNextVersion(client, documentId);
    } else if (methodId === "pgvector-replace-version") {
      await deleteAllVersions(client, documentId);
      version = 1;
    } else {
      // pgvector-upsert-version：用当前最大版本（或 1）
      const maxRes = await client.query<{ max_version: number | null }>(
        "SELECT MAX(version) AS max_version FROM rag_chunks WHERE document_id = $1",
        [documentId]
      );
      version = maxRes.rows[0].max_version ?? 1;
    }

    await upsertChunks(client, chunks, documentId, version, conflictPolicy);

    // 建索引（需要传入维度，用于 ALTER COLUMN 补充维度后再建 HNSW/IVFFlat）
    const indexResult = await ensureVectorIndex(client, indexMode, dimension);
    if (indexResult.skipped && indexResult.reason) {
      warnings.push(`向量索引：${indexResult.reason}`);
    }

    await client.end();

    const output: StorageOutput = {
      storedChunks: chunks.length,
      documentId,
      version,
      dimension,
      indexMode,
      indexCreated: indexResult.created,
      freshTable,
      warnings,
    };

    return NextResponse.json({
      output,
      trace: {
        methodId,
        documentId,
        version,
        storedChunks: chunks.length,
        dimension,
        indexMode,
        indexCreated: indexResult.created,
        freshTable,
        durationMs: Date.now() - startMs,
      },
      durationMs: Date.now() - startMs,
      warnings,
    });
  } catch (err) {
    await client.end().catch(() => {});
    // Node 18+ 的 AggregateError 包含多个底层错误，取第一个有意义的 message
    const unwrapped =
      err instanceof AggregateError && err.errors?.length > 0 ? err.errors[0] : err;
    const pgErr = unwrapped as Record<string, unknown>;
    const message =
      (typeof pgErr?.message === "string" && pgErr.message)
        ? pgErr.message
        : (typeof pgErr?.toString === "function" ? pgErr.toString() : "未知错误");

    // pg 系统错误码（Node.js errno 字符串）
    const errno = typeof pgErr?.code === "string" ? pgErr.code : "";
    let code = "storage_failed";
    if (errno === "ECONNREFUSED" || message.includes("ECONNREFUSED")) code = "db_connection_refused";
    else if (errno === "23505" || message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate")) code = "unique_violation";
    else if (message.toLowerCase().includes("dimension")) code = "dimension_mismatch";
    else if (errno === "28P01" || message.includes("password authentication")) code = "db_auth_failed";
    else if (errno === "3D000" || message.includes("does not exist")) code = "db_not_found";

    return NextResponse.json(
      { error: { code, message } },
      { status: 500 }
    );
  }
}
