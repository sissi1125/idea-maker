/**
 * 官网 RAG 批处理基准：只衡量本次优化消除的网络/SQL 往返，不调用真实收费 provider。
 * 执行：pnpm --filter @harness/api bench:sources
 */
import "dotenv/config";
import { Client } from "pg";

const EMBEDDING_CHUNKS = 64;
const EMBEDDING_BATCH_SIZE = 16;
const PROVIDER_LATENCY_MS = 15;
const INSERT_ROWS = 200;
const INSERT_BATCH_SIZE = 50;
const DB_ROUNDS = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 模拟旧实现：每个 chunk 串行发一次 Embedding HTTP 请求。 */
async function benchmarkSequentialEmbedding(): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < EMBEDDING_CHUNKS; i++) await sleep(PROVIDER_LATENCY_MS);
  return performance.now() - started;
}

/** 模拟新实现：每批只承担一次相同的 provider 往返延迟。 */
async function benchmarkBatchedEmbedding(): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < EMBEDDING_CHUNKS; i += EMBEDDING_BATCH_SIZE) {
    await sleep(PROVIDER_LATENCY_MS);
  }
  return performance.now() - started;
}

/** 使用真实 PostgreSQL 临时 pgvector 表，测逐行和多值 INSERT 的往返差异。 */
async function benchmarkDatabase(): Promise<{ sequentialMs: number; batchedMs: number }> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少 DATABASE_URL，无法运行真实 PostgreSQL 基准");
  const client = new Client({ connectionString, application_name: "sources-batch-benchmark" });
  await client.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(`CREATE TEMP TABLE source_batch_bench (
      id TEXT PRIMARY KEY,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding vector(3)
    )`);

    const sequential: number[] = [];
    const batched: number[] = [];
    for (let round = 0; round < DB_ROUNDS; round++) {
      await client.query("TRUNCATE source_batch_bench");
      let started = performance.now();
      for (let i = 0; i < INSERT_ROWS; i++) {
        await client.query(
          "INSERT INTO source_batch_bench (id, chunk_index, text, embedding) VALUES ($1,$2,$3,$4::vector)",
          [`seq-${round}-${i}`, i, `中文官网正文 ${i}`, "[0.1,0.2,0.3]"],
        );
      }
      sequential.push(performance.now() - started);

      await client.query("TRUNCATE source_batch_bench");
      started = performance.now();
      for (let offset = 0; offset < INSERT_ROWS; offset += INSERT_BATCH_SIZE) {
        const count = Math.min(INSERT_BATCH_SIZE, INSERT_ROWS - offset);
        const params: unknown[] = [];
        const values = Array.from({ length: count }, (_, index) => {
          const base = params.length + 1;
          const row = offset + index;
          params.push(`batch-${round}-${row}`, row, `中文官网正文 ${row}`, "[0.1,0.2,0.3]");
          return `($${base},$${base + 1},$${base + 2},$${base + 3}::vector)`;
        });
        await client.query(
          `INSERT INTO source_batch_bench (id, chunk_index, text, embedding) VALUES ${values.join(",")}`,
          params,
        );
      }
      batched.push(performance.now() - started);
    }
    return { sequentialMs: median(sequential), batchedMs: median(batched) };
  } finally {
    await client.end();
  }
}

/** 中位数能降低本机调度和偶发磁盘抖动对微基准的影响。 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main(): Promise<void> {
  const sequentialEmbeddingMs = await benchmarkSequentialEmbedding();
  const batchedEmbeddingMs = await benchmarkBatchedEmbedding();
  const database = await benchmarkDatabase();
  console.log(JSON.stringify({
    embedding: {
      chunks: EMBEDDING_CHUNKS,
      beforeCalls: EMBEDDING_CHUNKS,
      afterCalls: Math.ceil(EMBEDDING_CHUNKS / EMBEDDING_BATCH_SIZE),
      beforeMs: Math.round(sequentialEmbeddingMs),
      afterMs: Math.round(batchedEmbeddingMs),
      speedup: Number((sequentialEmbeddingMs / batchedEmbeddingMs).toFixed(2)),
    },
    database: {
      rows: INSERT_ROWS,
      beforeStatements: INSERT_ROWS,
      afterStatements: Math.ceil(INSERT_ROWS / INSERT_BATCH_SIZE),
      beforeMedianMs: Number(database.sequentialMs.toFixed(2)),
      afterMedianMs: Number(database.batchedMs.toFixed(2)),
      speedup: Number((database.sequentialMs / database.batchedMs).toFixed(2)),
    },
  }, null, 2));
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
