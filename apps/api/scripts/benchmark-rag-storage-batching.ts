/**
 * 通用 RAG Storage 批处理基准：在同一真实 PostgreSQL 连接和临时 pgvector 表中，
 * 比较旧版逐行 INSERT 与新版 50 行多值 INSERT，仅衡量 SQL 往返差异。
 * 执行：pnpm --filter @harness/api bench:rag-storage
 */
import "dotenv/config";
import { Client } from "pg";

const ROW_COUNT = 200;
const BATCH_SIZE = 50;
const ROUNDS = 7;

/** 取中位数，降低本机调度和偶发磁盘抖动对微基准的影响。 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 生成与生产 rag_chunks 相同的 13 列参数，正文包含中文以覆盖真实主要输入。 */
function appendRowParams(params: unknown[], prefix: string, index: number): string {
  const first = params.length + 1;
  params.push(
    `${prefix}-${index}`,
    `${prefix}-document`,
    "benchmark-project",
    1,
    index,
    `中文产品资料分片 ${index}`,
    `标题上下文\n中文产品资料分片 ${index}`,
    `章节 ${index}`,
    12,
    6,
    ["产品", "资料"],
    4,
    "[0.1,0.2,0.3,0.4]",
  );
  return `(${Array.from({ length: 13 }, (_, offset) =>
    `$${first + offset}${offset === 12 ? "::vector" : ""}`).join(",")})`;
}

/** 按给定批大小写入，batchSize=1 等价于优化前逐行写库。 */
async function insertRows(client: Client, prefix: string, batchSize: number): Promise<number> {
  const started = performance.now();
  await client.query("BEGIN");
  try {
    for (let offset = 0; offset < ROW_COUNT; offset += batchSize) {
      const count = Math.min(batchSize, ROW_COUNT - offset);
      const params: unknown[] = [];
      const values = Array.from({ length: count }, (_, localIndex) =>
        appendRowParams(params, prefix, offset + localIndex));
      await client.query(
        `INSERT INTO rag_storage_batch_bench
           (id, document_id, project_id, version, chunk_index, text, enhanced_text,
            source_ref, char_count, token_estimate, keywords, embedding_dimension, embedding)
         VALUES ${values.join(",")}`,
        params,
      );
    }
    await client.query("COMMIT");
    return performance.now() - started;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** 建立临时表并交替执行两种模式，避免固定先后顺序偏向某一组。 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少 DATABASE_URL，无法运行真实 PostgreSQL 基准");
  const client = new Client({ connectionString, application_name: "rag-storage-batch-benchmark" });
  await client.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(`CREATE TEMP TABLE rag_storage_batch_bench (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, project_id TEXT NOT NULL,
      version INTEGER NOT NULL, chunk_index INTEGER NOT NULL, text TEXT NOT NULL,
      enhanced_text TEXT NOT NULL, source_ref TEXT, char_count INTEGER,
      token_estimate INTEGER, keywords TEXT[], embedding_dimension INTEGER,
      embedding vector(4)
    )`);

    const sequential: number[] = [];
    const batched: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const modes = round % 2 === 0
        ? ([{ size: 1, results: sequential }, { size: BATCH_SIZE, results: batched }] as const)
        : ([{ size: BATCH_SIZE, results: batched }, { size: 1, results: sequential }] as const);
      for (const mode of modes) {
        await client.query("TRUNCATE rag_storage_batch_bench");
        mode.results.push(await insertRows(client, `round-${round}-batch-${mode.size}`, mode.size));
      }
    }

    const beforeMs = median(sequential);
    const afterMs = median(batched);
    console.log(JSON.stringify({
      rows: ROW_COUNT,
      batchSize: BATCH_SIZE,
      rounds: ROUNDS,
      beforeStatements: ROW_COUNT,
      afterStatements: Math.ceil(ROW_COUNT / BATCH_SIZE),
      beforeMedianMs: Number(beforeMs.toFixed(2)),
      afterMedianMs: Number(afterMs.toFixed(2)),
      speedup: Number((beforeMs / afterMs).toFixed(2)),
    }, null, 2));
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
