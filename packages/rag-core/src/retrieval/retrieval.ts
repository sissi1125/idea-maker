/**
 * RAG Pipeline Stage - Retrieval - 纯算法 + 三重 client 注入
 *
 * 5 method 全保留，含 query embedding 内联（区别于 ingestion/embedding 的 batch）：
 *
 *   dense-vector       pgvector 余弦：先 embed query → 1 - (embedding <=> query_vec)
 *   postgres-fulltext  ts_rank(to_tsvector('simple'), plainto_tsquery)
 *   hybrid-rrf         dense + fulltext 并行 → RRF 融合
 *   bm25-chinese       jieba 分词 + JS BM25（候选 ILIKE ANY → JS 计算）
 *   hybrid-bm25-rrf    dense + bm25 并行 → RRF 融合
 *
 * I/O 注入：
 *   pgClient        必传，路由层 new Client + connect 后传入；rag-core 不管 lifecycle
 *   openaiClient    embeddingProvider=openai 时必传，否则抛 missing_client
 *   hfTeiEndpoint   embeddingProvider=hf-tei 时必传，否则抛 missing_endpoint
 *   debug-deterministic 全部 mock，不需要任何 client
 */

import type {
  MatchedChunk,
  OpenAICompatibleClient,
  PgClient,
  RetrievalEmbeddingProvider,
  RetrievalInput,
  RetrievalParams,
  RetrievalResult,
} from "@harness/shared-types";
import { PipelineError } from "../errors";
import { tokenizeForBM25 } from "../util/nlp";
import { embedSingleText } from "../util/openai-embed";

// ─── Query Embedding ──────────────────────────────────────────────────────────

/**
 * 单 query 向量化。
 * 与 ingestion 阶段必须用相同 provider + model，否则向量空间不一致，相似度无意义。
 */
async function embedQuery(
  text: string,
  provider: RetrievalEmbeddingProvider,
  model: string,
  dimension: number,
  openaiClient: OpenAICompatibleClient | undefined,
  hfTeiEndpoint: string | undefined,
): Promise<number[]> {
  if (provider === "debug-deterministic") {
    // FNV-1a 哈希（与 ingestion/embedding 一致）
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
    if (!hfTeiEndpoint) {
      throw new PipelineError(
        "missing_endpoint",
        "embeddingProvider=hf-tei 需要 hfTeiEndpoint；请设置 HF_TEI_ENDPOINT 或在表单中填写",
      );
    }
    const endpoint = hfTeiEndpoint.replace(/\/$/, "");
    const resp = await fetch(`${endpoint}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: [text] }),
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new PipelineError("provider_error", `TEI 服务错误 ${resp.status}: ${msg}`);
    }
    const data = (await resp.json()) as number[][];
    return data[0];
  }

  // openai（含 Qwen / DeepSeek 等兼容服务）
  if (!openaiClient) {
    throw new PipelineError(
      "missing_client",
      "embeddingProvider=openai 需要注入 openaiClient；路由层 createEmbeddingClient 后传入",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return embedSingleText(text, model, dimension, openaiClient as any);
}

// ─── dense-vector ─────────────────────────────────────────────────────────────

async function retrieveDense(
  db: PgClient,
  queries: string[],
  params: RetrievalParams,
  openaiClient: OpenAICompatibleClient | undefined,
  hfTeiEndpoint: string | undefined,
): Promise<{ matches: MatchedChunk[]; dimension: number }> {
  const { topK, threshold, embeddingProvider, embeddingModel, embeddingDimension } = params;
  const allMatches = new Map<string, MatchedChunk>();

  for (const query of queries) {
    const vec = await embedQuery(
      query,
      embeddingProvider,
      embeddingModel,
      embeddingDimension,
      openaiClient,
      hfTeiEndpoint,
    );
    const vecStr = `[${vec.join(",")}]`;

    const result = await db.query<{
      id: string;
      document_id: string;
      version: number;
      chunk_index: number;
      text: string;
      source_ref: string;
      keywords: string[];
      score: number;
    }>(
      `SELECT id, document_id, version, chunk_index, text, source_ref, keywords,
              1 - (embedding <=> $1::vector) AS score
       FROM rag_chunks
       WHERE 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecStr, threshold, topK],
    );

    for (const row of result.rows) {
      const existing = allMatches.get(row.id);
      // 多 query：同 chunk 取最高分
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
  return { matches, dimension: embeddingDimension };
}

// ─── postgres-fulltext ────────────────────────────────────────────────────────

async function retrieveFulltext(
  db: PgClient,
  queries: string[],
  params: RetrievalParams,
): Promise<MatchedChunk[]> {
  const { topK } = params;
  const allMatches = new Map<string, MatchedChunk>();

  for (const query of queries) {
    const result = await db.query<{
      id: string;
      document_id: string;
      version: number;
      chunk_index: number;
      text: string;
      source_ref: string;
      keywords: string[];
      score: number;
    }>(
      `SELECT id, document_id, version, chunk_index, text, source_ref, keywords,
              ts_rank(to_tsvector('simple', COALESCE(text, '')),
                      plainto_tsquery('simple', $1)) AS score
       FROM rag_chunks
       WHERE to_tsvector('simple', COALESCE(text, '')) @@ plainto_tsquery('simple', $1)
       ORDER BY score DESC
       LIMIT $2`,
      [query, topK],
    );

    for (const row of result.rows) {
      const existing = allMatches.get(row.id);
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
          retrievalMethod: "fulltext",
        });
      }
    }
  }

  return [...allMatches.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── hybrid-rrf ───────────────────────────────────────────────────────────────

async function retrieveHybridRRF(
  db: PgClient,
  queries: string[],
  params: RetrievalParams,
  openaiClient: OpenAICompatibleClient | undefined,
  hfTeiEndpoint: string | undefined,
): Promise<{ matches: MatchedChunk[]; dimension: number }> {
  const { topK } = params;
  const k = 60;

  const { matches: denseMatches, dimension } = await retrieveDense(
    db,
    queries,
    { ...params, topK: topK * 2, threshold: 0 }, // 不在 dense 过滤，让 filter stage 做
    openaiClient,
    hfTeiEndpoint,
  );
  const fulltextMatches = await retrieveFulltext(db, queries, { ...params, topK: topK * 2 });

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

// ─── BM25 计算（纯 JS）────────────────────────────────────────────────────────

/**
 * Okapi BM25：
 *   idf(t) = log((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
 *   tf_norm = tf * (k1+1) / (tf + k1 * (1 - b + b * len/avgdl))
 *   score = Σ idf(t) * tf_norm
 *
 * DF 近似为候选集 DF（playground 规模可接受；生产场景需用 DB 预算的全局 DF）
 */
function computeBM25(
  chunks: Array<{ id: string; text: string }>,
  queryTerms: string[],
  N: number,
  avgdl: number,
  k1: number,
  b: number,
): Map<string, number> {
  const tokenized = chunks.map((c) => ({
    id: c.id,
    terms: tokenizeForBM25(c.text),
    len: c.text.length,
  }));

  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const t of tokenized) {
      if (t.terms.includes(term)) count++;
    }
    df.set(term, count);
  }

  const scores = new Map<string, number>();
  for (const doc of tokenized) {
    let score = 0;
    const termFreq = new Map<string, number>();
    for (const t of doc.terms) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

    for (const term of queryTerms) {
      const tf = termFreq.get(term) ?? 0;
      if (tf === 0) continue;
      const dfVal = df.get(term) ?? 0;
      const idf = Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.len / avgdl)));
      score += idf * tfNorm;
    }
    if (score > 0) scores.set(doc.id, score);
  }
  return scores;
}

// ─── bm25-chinese ─────────────────────────────────────────────────────────────

async function retrieveBM25Chinese(
  db: PgClient,
  queries: string[],
  params: RetrievalParams,
): Promise<MatchedChunk[]> {
  const { topK, k1, b } = params;

  // 多 query 分词合并去重，最多 30 term 控制 SQL 长度
  const allTerms = new Set<string>();
  for (const q of queries) {
    for (const t of tokenizeForBM25(q)) allTerms.add(t);
  }
  const terms = [...allTerms].slice(0, 30);
  if (terms.length === 0) return [];

  // 语料统计
  const statsRes = await db.query<{ n: string; avgdl: string }>(
    "SELECT COUNT(*) AS n, AVG(length(text)) AS avgdl FROM rag_chunks",
  );
  const N = parseInt(statsRes.rows[0].n, 10) || 1;
  const avgdl = parseFloat(statsRes.rows[0].avgdl) || 1;

  // ILIKE ANY 取候选
  const likePatterns = terms.map((t) => `%${t}%`);
  const candidateRes = await db.query<{
    id: string;
    document_id: string;
    version: number;
    chunk_index: number;
    text: string;
    source_ref: string;
    keywords: string[];
  }>(
    `SELECT id, document_id, version, chunk_index, text, source_ref, keywords
     FROM rag_chunks
     WHERE text ILIKE ANY($1::text[])
     LIMIT 200`,
    [likePatterns],
  );

  const candidates = candidateRes.rows;
  if (candidates.length === 0) return [];

  // 多 query 各自打分，取最高分
  const bestScores = new Map<string, number>();
  for (const q of queries) {
    const qTerms = tokenizeForBM25(q);
    const scores = computeBM25(candidates, qTerms, N, avgdl, k1, b);
    for (const [id, score] of scores) {
      if ((bestScores.get(id) ?? 0) < score) bestScores.set(id, score);
    }
  }

  const chunkById = new Map(candidates.map((c) => [c.id, c]));
  return [...bestScores.entries()]
    .map(([id, score]) => {
      const c = chunkById.get(id)!;
      return {
        chunkId: c.id,
        documentId: c.document_id,
        version: c.version,
        chunkIndex: c.chunk_index,
        text: c.text,
        sourceRef: c.source_ref,
        keywords: c.keywords ?? [],
        score: parseFloat(score.toFixed(4)),
        retrievalMethod: "bm25",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── hybrid-bm25-rrf ──────────────────────────────────────────────────────────

async function retrieveHybridBM25RRF(
  db: PgClient,
  queries: string[],
  params: RetrievalParams,
  openaiClient: OpenAICompatibleClient | undefined,
  hfTeiEndpoint: string | undefined,
): Promise<{ matches: MatchedChunk[]; dimension: number }> {
  const { topK } = params;
  const k = 60;

  const [{ matches: denseMatches, dimension }, bm25Matches] = await Promise.all([
    retrieveDense(db, queries, { ...params, topK: topK * 2, threshold: 0 }, openaiClient, hfTeiEndpoint),
    retrieveBM25Chinese(db, queries, { ...params, topK: topK * 2 }),
  ]);

  const rrfScores = new Map<string, number>();
  const chunkMap = new Map<string, MatchedChunk>();

  denseMatches.forEach((m, idx) => {
    rrfScores.set(m.chunkId, (rrfScores.get(m.chunkId) ?? 0) + 1 / (k + idx + 1));
    chunkMap.set(m.chunkId, { ...m, retrievalMethod: "hybrid-bm25" });
  });
  bm25Matches.forEach((m, idx) => {
    rrfScores.set(m.chunkId, (rrfScores.get(m.chunkId) ?? 0) + 1 / (k + idx + 1));
    if (!chunkMap.has(m.chunkId)) chunkMap.set(m.chunkId, { ...m, retrievalMethod: "hybrid-bm25" });
  });

  const matches = [...rrfScores.entries()]
    .map(([id, rrf]) => ({ ...chunkMap.get(id)!, score: parseFloat(rrf.toFixed(6)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return { matches, dimension };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runRetrieval(input: RetrievalInput): Promise<RetrievalResult> {
  const { methodId, params, queries, pgClient, openaiClient, hfTeiEndpoint } = input;

  if (!pgClient) {
    throw new PipelineError(
      "missing_client",
      "retrieval 需要注入 pg.Client / pg.Pool；路由层应创建并 connect 后传入 Input.pgClient",
    );
  }
  if (!queries || queries.length === 0) {
    throw new PipelineError("empty_queries", "上游 query-rewrite 未产出任何查询");
  }

  let matches: MatchedChunk[];
  let dimension: number | undefined;
  const warnings: string[] = [];

  switch (methodId) {
    case "postgres-fulltext":
      matches = await retrieveFulltext(pgClient, queries, params);
      warnings.push(
        "PostgreSQL 全文检索使用 simple 字典，对中文效果有限；中文文档建议使用 dense-vector / bm25-chinese / hybrid-bm25-rrf",
      );
      break;

    case "hybrid-rrf": {
      const r = await retrieveHybridRRF(pgClient, queries, params, openaiClient, hfTeiEndpoint);
      matches = r.matches;
      dimension = r.dimension;
      warnings.push(
        "hybrid-rrf 的 score 为 RRF 值（非余弦相似度），在 filter stage 用 score-threshold 时适当调低 minScore",
      );
      break;
    }

    case "bm25-chinese":
      matches = await retrieveBM25Chinese(pgClient, queries, params);
      if (matches.length === 0) {
        warnings.push("未检索到结果，请确认文档已存入数据库，或调整查询关键词");
      }
      break;

    case "hybrid-bm25-rrf": {
      const r = await retrieveHybridBM25RRF(pgClient, queries, params, openaiClient, hfTeiEndpoint);
      matches = r.matches;
      dimension = r.dimension;
      warnings.push(
        "hybrid-bm25-rrf 的 score 为 RRF 值（非余弦相似度），在 filter stage 用 score-threshold 时适当调低 minScore",
      );
      break;
    }

    case "dense-vector":
    default: {
      const r = await retrieveDense(pgClient, queries, params, openaiClient, hfTeiEndpoint);
      matches = r.matches;
      dimension = r.dimension;
      if (matches.length === 0) {
        warnings.push("未检索到结果，尝试降低相似度阈值或换用 fulltext / bm25 方法");
      }
      break;
    }
  }

  return {
    output: {
      originalQuery: queries[0] ?? "",
      queries,
      matches,
      totalMatches: matches.length,
      method: methodId,
      dimension,
      warnings,
    },
    trace: {
      methodId,
      queryCount: queries.length,
      matchCount: matches.length,
      dimension,
    },
    warnings,
  };
}
