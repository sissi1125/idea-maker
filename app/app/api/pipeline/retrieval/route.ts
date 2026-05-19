/**
 * RAG Pipeline Stage — Retrieval（检索）
 *
 * 作用：将 query-rewrite 产出的查询向量化，在 pgvector 中执行近似最近邻搜索，
 *       返回语义相关的 chunk 集合供后续过滤和重排。
 *
 * Pipeline 位置：
 *   Query Rewrite → [Retrieval] → Filter → Rerank → Citation
 *
 * 三种方法：
 *
 *   dense-vector          查询 embedding → pgvector 余弦相似度 top-K
 *                         依赖：pgvector DB + embedding provider（与 ingestion 相同）
 *
 *   postgres-fulltext     pg tsvector 全文索引倒排检索
 *                         不需要 embedding provider，速度快，适合关键词精确匹配
 *                         缺点：无法处理同义词和语义相似，只能精确词匹配
 *
 *   hybrid-rrf            dense + fulltext 结果通过 RRF（Reciprocal Rank Fusion）合并
 *                         RRF score = 1/(k+rank_dense) + 1/(k+rank_fulltext)，k=60 为经验值
 *                         兼顾语义相似和关键词精确，通常效果最佳
 *
 * 多路查询处理：
 *   query-rewrite 可能返回多个 query 变体。本 stage 对每个 query 执行检索，
 *   然后按分数去重合并，同一 chunk 取最高分，最终按分数降序返回。
 *
 * 前置条件：
 *   - DATABASE_URL 或表单填写连接串
 *   - dense-vector/hybrid-rrf 需要 embedding provider 与 ingestion 阶段一致
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import type { QueryRewriteOutput } from "../query-rewrite/route";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface MatchedChunk {
  chunkId: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  text: string;
  sourceRef: string;
  keywords: string[];
  /** 余弦相似度（dense）或 ts_rank（fulltext）或 RRF score */
  score: number;
  /** 来源方法（区分 dense/fulltext/hybrid） */
  retrievalMethod: string;
}

export interface RetrievalOutput {
  /** query-rewrite 传入的第一个查询，用于下游 filter/rerank/citation 的相关性计算 */
  originalQuery: string;
  queries: string[];
  matches: MatchedChunk[];
  totalMatches: number;
  method: string;
  dimension?: number;
  warnings: string[];
}

// ─── 查询 Embedding（复用 embedding stage 的 provider 逻辑）──────────────────

/**
 * 将单个文本转为向量，用于 dense 检索时的 query 向量化。
 * 与 ingestion 阶段使用相同 provider + model，确保向量空间一致。
 */
async function embedQuery(
  text: string,
  provider: string,
  model: string,
  dimension: number,
  apiKey?: string,
  teiEndpoint?: string
): Promise<number[]> {
  if (provider === "debug-deterministic") {
    // FNV-1a 哈希确定性向量（与 embedding route 一致）
    const raw: number[] = [];
    for (let i = 0; i < dimension; i++) {
      let h = 2166136261 ^ (i * 16777619);
      for (let j = 0; j < text.length; j++) {
        h ^= text.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      raw.push(((h >>> 0) / 0xffffffff) * 2 - 1);
    }
    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1;
    return raw.map((v) => parseFloat((v / norm).toFixed(6)));
  }

  if (provider === "hf-tei") {
    const endpoint = (teiEndpoint?.trim() || process.env.HF_TEI_ENDPOINT)?.replace(/\/$/, "");
    if (!endpoint) throw new Error("缺少 HF_TEI_ENDPOINT，请在表单中填写或设置环境变量");
    const resp = await fetch(`${endpoint}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: [text] }),
    });
    if (!resp.ok) throw new Error(`TEI 服务错误 ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as number[][];
    return data[0];
  }

  // OpenAI（默认）
  const key = apiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("缺少 OpenAI API Key：请在表单中填写或设置 OPENAI_API_KEY 环境变量");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });
  const resp = await client.embeddings.create({
    model,
    input: text,
    ...(model.startsWith("text-embedding-3") ? { dimensions: dimension } : {}),
  });
  return resp.data[0].embedding;
}

// ─── dense-vector ─────────────────────────────────────────────────────────────

async function retrieveDense(
  db: Client,
  queries: string[],
  params: Record<string, unknown>
): Promise<{ matches: MatchedChunk[]; dimension: number }> {
  const topK = Number(params.topK ?? 10);
  const threshold = Number(params.threshold ?? 0.5);
  const provider = String(params.embeddingProvider ?? "openai");
  const model = String(params.embeddingModel ?? "text-embedding-3-small");
  const dimension = Number(params.embeddingDimension ?? 1536);
  const apiKey = typeof params.apiKey === "string" ? params.apiKey : undefined;
  const teiEndpoint = typeof params.teiEndpoint === "string" ? params.teiEndpoint : undefined;

  const allMatches = new Map<string, MatchedChunk>();

  for (const query of queries) {
    const vec = await embedQuery(query, provider, model, dimension, apiKey, teiEndpoint);
    const vecStr = `[${vec.join(",")}]`;

    const result = await db.query<{
      id: string; document_id: string; version: number; chunk_index: number;
      text: string; source_ref: string; keywords: string[]; score: number;
    }>(
      `SELECT id, document_id, version, chunk_index, text, source_ref, keywords,
              1 - (embedding <=> $1::vector) AS score
       FROM rag_chunks
       WHERE 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecStr, threshold, topK]
    );

    for (const row of result.rows) {
      const existing = allMatches.get(row.id);
      // 多 query 检索时，同一 chunk 取最高分
      if (!existing || row.score > existing.score) {
        allMatches.set(row.id, {
          chunkId: row.id,
          documentId: row.document_id,
          version: row.version,
          chunkIndex: row.chunk_index,
          text: row.text,
          sourceRef: row.source_ref,
          keywords: row.keywords ?? [],
          score: parseFloat(row.score.toFixed(4)),
          retrievalMethod: "dense",
        });
      }
    }
  }

  const matches = [...allMatches.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  return { matches, dimension };
}

// ─── postgres-fulltext ────────────────────────────────────────────────────────

/**
 * PostgreSQL tsvector 全文检索。
 * 使用 plainto_tsquery 将 query 转换为 AND 连接的词素查询。
 * 对中文效果有限（pg 默认 simple 字典按 ASCII 切词），适合英文文档。
 * 中文文档建议改用 pg_jieba 或 zhparser 扩展（此处使用 simple，保持零依赖）。
 */
async function retrieveFulltext(
  db: Client,
  queries: string[],
  params: Record<string, unknown>
): Promise<MatchedChunk[]> {
  const topK = Number(params.topK ?? 10);
  const allMatches = new Map<string, MatchedChunk>();

  for (const query of queries) {
    const result = await db.query<{
      id: string; document_id: string; version: number; chunk_index: number;
      text: string; source_ref: string; keywords: string[]; score: number;
    }>(
      `SELECT id, document_id, version, chunk_index, text, source_ref, keywords,
              ts_rank(to_tsvector('simple', COALESCE(text, '')),
                      plainto_tsquery('simple', $1)) AS score
       FROM rag_chunks
       WHERE to_tsvector('simple', COALESCE(text, '')) @@ plainto_tsquery('simple', $1)
       ORDER BY score DESC
       LIMIT $2`,
      [query, topK]
    );

    for (const row of result.rows) {
      const existing = allMatches.get(row.id);
      if (!existing || row.score > existing.score) {
        allMatches.set(row.id, {
          chunkId: row.id, documentId: row.document_id, version: row.version,
          chunkIndex: row.chunk_index, text: row.text, sourceRef: row.source_ref,
          keywords: row.keywords ?? [],
          score: parseFloat(row.score.toFixed(4)),
          retrievalMethod: "fulltext",
        });
      }
    }
  }

  return [...allMatches.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── hybrid-rrf ───────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion（RRF）混合检索。
 *
 * 流程：
 * 1. 分别跑 dense-vector 和 fulltext，各取 topK 结果（带排名）
 * 2. RRF score = Σ 1/(k + rank_i)，k=60 是防止排名靠前结果权重过高的平滑常数
 * 3. 按 RRF score 降序合并，取 topK
 *
 * 优点：两路结果的分数不需要归一化，直接用排名融合，鲁棒性强。
 * 缺点：融合后的 score 不再是余弦相似度，无法用 threshold 过滤（建议在 filter stage 做）。
 */
async function retrieveHybridRRF(
  db: Client,
  queries: string[],
  params: Record<string, unknown>
): Promise<{ matches: MatchedChunk[]; dimension: number }> {
  const topK = Number(params.topK ?? 10);
  const k = 60; // RRF 平滑常数

  const { matches: denseMatches, dimension } = await retrieveDense(db, queries, {
    ...params,
    topK: topK * 2, // 各取更多，融合后再裁剪
    threshold: 0,   // dense 这里不过滤，让 filter stage 做
  });
  const fulltextMatches = await retrieveFulltext(db, queries, { ...params, topK: topK * 2 });

  // 构建 chunkId → RRF score 映射
  const rrfScores = new Map<string, number>();
  const chunkMap = new Map<string, MatchedChunk>();

  denseMatches.forEach((m, idx) => {
    rrfScores.set(m.chunkId, (rrfScores.get(m.chunkId) ?? 0) + 1 / (k + idx + 1));
    chunkMap.set(m.chunkId, { ...m, retrievalMethod: "hybrid" });
  });
  fulltextMatches.forEach((m, idx) => {
    rrfScores.set(m.chunkId, (rrfScores.get(m.chunkId) ?? 0) + 1 / (k + idx + 1));
    if (!chunkMap.has(m.chunkId)) chunkMap.set(m.chunkId, { ...m, retrievalMethod: "hybrid" });
  });

  const matches = [...rrfScores.entries()]
    .map(([id, rrf]) => ({ ...chunkMap.get(id)!, score: parseFloat(rrf.toFixed(6)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return { matches, dimension };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: QueryRewriteOutput | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Query Rewrite 产物，请先运行 Query Rewrite Stage" } },
      { status: 400 }
    );
  }

  const queries = upstreamOutput.rewrittenQueries;
  if (!queries || queries.length === 0) {
    return NextResponse.json(
      { error: { code: "empty_queries", message: "上游未产出任何查询" } },
      { status: 400 }
    );
  }

  const connectionString =
    (typeof params.connectionString === "string" && params.connectionString.trim())
      ? params.connectionString.trim()
      : process.env.DATABASE_URL;

  if (!connectionString) {
    return NextResponse.json(
      { error: { code: "missing_connection", message: "缺少数据库连接串：请在表单中填写或设置 DATABASE_URL 环境变量" } },
      { status: 400 }
    );
  }

  const db = new Client({ connectionString });
  try {
    await db.connect();

    let matches: MatchedChunk[];
    let dimension: number | undefined;
    const warnings: string[] = [];

    switch (methodId) {
      case "dense-vector": {
        const r = await retrieveDense(db, queries, params);
        matches = r.matches; dimension = r.dimension;
        if (matches.length === 0) warnings.push("未检索到结果，尝试降低相似度阈值或换用 fulltext 方法");
        break;
      }
      case "postgres-fulltext": {
        matches = await retrieveFulltext(db, queries, params);
        warnings.push("PostgreSQL 全文检索使用 simple 字典，对中文效果有限；中文文档建议使用 dense-vector 方法");
        break;
      }
      case "hybrid-rrf": {
        const r = await retrieveHybridRRF(db, queries, params);
        matches = r.matches; dimension = r.dimension;
        warnings.push("hybrid-rrf 的 score 为 RRF 值（非余弦相似度），建议在 filter stage 用 score-threshold 过滤时适当调低 minScore");
        break;
      }
      default:
        await db.end();
        return NextResponse.json(
          { error: { code: "unknown_method", message: `未知方法: ${methodId}` } },
          { status: 400 }
        );
    }

    await db.end();

    const output: RetrievalOutput = {
      originalQuery: queries[0] ?? "",
      queries, matches, totalMatches: matches.length,
      method: methodId, dimension, warnings,
    };

    return NextResponse.json({
      output,
      trace: { methodId, queryCount: queries.length, matchCount: matches.length, dimension, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings,
    });
  } catch (err) {
    await db.end().catch(() => {});
    const unwrapped = err instanceof AggregateError ? (err.errors?.[0] ?? err) : err;
    const msg = unwrapped instanceof Error ? unwrapped.message : String(unwrapped);
    const code = msg.includes("ECONNREFUSED") ? "db_connection_refused"
      : msg.includes("does not exist") ? "db_not_found"
      : "retrieval_failed";
    return NextResponse.json({ error: { code, message: msg } }, { status: 500 });
  }
}
