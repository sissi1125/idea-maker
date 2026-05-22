#!/usr/bin/env node
/**
 * Eval Matrix Runner
 *
 * 用法：
 *   npx tsx scripts/eval-matrix/run-matrix.ts
 *
 * 前提条件：
 *   - Next.js dev server 已启动（cd app && npm run dev）
 *   - PostgreSQL 可访问（docker compose up postgres）
 *   - DATABASE_URL / EMBEDDING_API_KEY / LLM_API_KEY 已设置
 *   - HF_TEI_ENDPOINT 已设置（pipeline-rerank 需要 TEI 服务）
 *
 * 可选环境变量：
 *   BASE_URL=http://localhost:3000   （默认）
 *   START_FROM=T04                   （跳过前面的 test case，用于断点续跑）
 *   RUN_ID=run-002-20260521          （指定结果目录名，默认按日期自动生成）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractQueryMetrics, averageQueryMetrics } from "./collect-metrics.js";
import { generateReport } from "./report.js";
import type { TestCase, TestCaseResult, QueryResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const START_FROM = process.env.START_FROM ?? null;

// 结果目录：每次运行独立文件夹，格式 run-XXX-YYYYMMDD
function resolveResultsDir(): string {
  if (process.env.RUN_ID) return path.join(__dirname, "results", process.env.RUN_ID);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // 自动递增 run 编号
  const base = path.join(__dirname, "results");
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  const existing = fs.readdirSync(base).filter((d) => /^run-\d{3}-/.test(d)).sort();
  const lastNum = existing.length > 0 ? parseInt(existing[existing.length - 1].slice(4, 7)) : 0;
  const nextNum = String(lastNum + 1).padStart(3, "0");
  return path.join(base, `run-${nextNum}-${today}`);
}

const RESULTS_DIR = resolveResultsDir();

// queries 从独立文件读取，方便每次 run 单独配置
const queriesPath = path.join(__dirname, "queries.json");
const QUERIES: Array<{ id: string; text: string; type?: string; difficulty?: string }> =
  JSON.parse(fs.readFileSync(queriesPath, "utf-8"));

// 固定参数
const FIXED = {
  preprocess: { methodId: "markdown-structure", params: { preserveHeadings: true, removeBoilerplate: false, maxChars: 0 } },
  // baseUrl 和 apiKey 不传，由 dev server 的 EMBEDDING_API_KEY / LLM_API_KEY / EMBEDDING_BASE_URL 统一决定
  embedding:  { methodId: "openai-3-small",     params: { model: "text-embedding-v4", dimension: 1024, batchSize: 10 } },
  storage:    { methodId: "pgvector-upsert-version", params: { truncateTable: true, conflictPolicy: "upsert", indexMode: "hnsw" } },
  intentRecognition: { methodId: "rule-based",   params: {} },
  rerank:     { methodId: "pipeline-rerank",     params: { boostPassN: 20, rerankTopN: 5 } },
  citation:   { methodId: "chunk-citation",      params: { maxEvidencePerClaim: 3 } },
  promptBuild:{ methodId: "marketing-template",  params: { targetAudience: "产品运营和独立开发者", tone: "professional", maxContextTokens: 2000 } },
  generation: { methodId: "marketing-ideas",     params: { ideaCount: 5, includeEvidence: true } },
  evaluation: { methodId: "rag-metrics-only",    params: { scoreThreshold: 0.2 } },
};

async function post(route: string, body: unknown): Promise<unknown> {
  const url = `${BASE_URL}/api/pipeline/${route}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { error?: { code: string; message: string }; output?: unknown; trace?: unknown };
  if (!res.ok || (json as { error?: unknown }).error) {
    const err = (json as { error?: { code?: string; message?: string } }).error;
    throw new Error(`${route} 失败 [${res.status}]: ${err?.code ?? "unknown"} — ${err?.message ?? JSON.stringify(json)}`);
  }
  return json;
}

async function uploadDocument(text: string): Promise<string> {
  console.log("  📄 上传测试文档...");
  const res = await fetch(`${BASE_URL}/api/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, fileName: "PRODUCT.md", mimeType: "text/markdown" }),
  });
  const json = await res.json() as { document?: { id?: string }; id?: string; error?: unknown };
  const id = json.document?.id ?? json.id;
  if (!res.ok || !id) throw new Error(`文档上传失败: ${JSON.stringify(json)}`);
  return id;
}

async function runIngestion(
  documentId: string,
  testCase: TestCase
): Promise<{ output: unknown; durationMs: number }> {
  const t0 = Date.now();

  const preprocess = await post("preprocess", {
    methodId: FIXED.preprocess.methodId,
    params: FIXED.preprocess.params,
    pipelineRun: { selectedDocumentId: documentId },
  }) as { output: unknown };

  const chunk = await post("chunk", {
    methodId: testCase.chunk.methodId,
    params: testCase.chunk.params,
    upstreamOutput: (preprocess as { output: unknown }).output,
  }) as { output: unknown };

  const transform = await post("transform", {
    methodId: testCase.transform.methodId,
    params: testCase.transform.params,
    upstreamOutput: (chunk as { output: unknown }).output,
  }) as { output: unknown };

  const embedding = await post("embedding", {
    methodId: FIXED.embedding.methodId,
    params: FIXED.embedding.params,
    upstreamOutput: (transform as { output: unknown }).output,
  }) as { output: unknown };

  const storage = await post("storage", {
    methodId: FIXED.storage.methodId,
    params: FIXED.storage.params,
    pipelineRun: { selectedDocumentId: documentId },
    upstreamOutput: (embedding as { output: unknown }).output,
  }) as { output: { storedCount?: number; chunkCount?: number } };

  const storedCount = storage.output?.storedCount ?? storage.output?.chunkCount ?? "?";
  console.log(`    stored ${storedCount} chunks`);

  return { output: (embedding as { output: unknown }).output, durationMs: Date.now() - t0 };
}

async function runRetrieval(
  query: string,
  testCase: TestCase
): Promise<{ outputs: Record<string, { output: unknown }>; durationMs: number }> {
  const t0 = Date.now();
  const outputs: Record<string, { output: unknown }> = {};

  // 意图识别（固定：rule-based）
  outputs.intentRecognition = await post("intent-recognition", {
    methodId: FIXED.intentRecognition.methodId,
    params: { ...FIXED.intentRecognition.params, query },
    upstreamOutput: null,
  }) as { output: unknown };

  outputs.queryRewrite = await post("query-rewrite", {
    methodId: testCase.queryRewrite.methodId,
    params: { ...testCase.queryRewrite.params, query },
    upstreamOutput: outputs.intentRecognition.output,
  }) as { output: unknown };

  outputs.retrieval = await post("retrieval", {
    methodId: testCase.retrieval.methodId,
    params: testCase.retrieval.params,
    upstreamOutput: outputs.queryRewrite.output,
  }) as { output: unknown };

  outputs.filter = await post("filter", {
    methodId: testCase.filter.methodId,
    params: testCase.filter.params,
    upstreamOutput: outputs.retrieval.output,
  }) as { output: unknown };

  outputs.rerank = await post("rerank", {
    methodId: FIXED.rerank.methodId,
    params: FIXED.rerank.params,
    upstreamOutput: outputs.filter.output,
  }) as { output: unknown };

  outputs.citation = await post("citation", {
    methodId: FIXED.citation.methodId,
    params: FIXED.citation.params,
    upstreamOutput: outputs.rerank.output,
  }) as { output: unknown };

  outputs.promptBuild = await post("prompt-build", {
    methodId: FIXED.promptBuild.methodId,
    params: FIXED.promptBuild.params,
    upstreamOutput: outputs.citation.output,
  }) as { output: unknown };

  outputs.generation = await post("generation", {
    methodId: FIXED.generation.methodId,
    params: FIXED.generation.params,
    upstreamOutput: outputs.promptBuild.output,
  }) as { output: unknown };

  outputs.evaluation = await post("evaluation", {
    methodId: FIXED.evaluation.methodId,
    params: FIXED.evaluation.params,
    upstreamOutput: outputs.generation.output,
  }) as { output: unknown };

  return { outputs, durationMs: Date.now() - t0 };
}

async function runTestCase(documentId: string, testCase: TestCase): Promise<TestCaseResult> {
  console.log(`\n▶ ${testCase.id}: ${testCase.label}`);

  // Ingestion
  let ingestionDurationMs = 0;
  try {
    console.log(`  ⚙ Ingestion (${testCase.chunk.methodId}/${testCase.transform.methodId})...`);
    const result = await runIngestion(documentId, testCase);
    ingestionDurationMs = result.durationMs;
    console.log(`  ✓ Ingestion 完成 (${ingestionDurationMs}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Ingestion 失败: ${message}`);
    return { testId: testCase.id, label: testCase.label, status: "failed", error: message, queryResults: [], metrics: null };
  }

  // Retrieval × 3 queries
  const queryResults: QueryResult[] = [];
  const allQueryMetrics = [];

  for (const { id: queryId, text: queryText } of QUERIES) {
    console.log(`  🔍 ${queryId}: "${queryText.slice(0, 30)}..."`);
    try {
      const { outputs, durationMs } = await runRetrieval(queryText, testCase);
      const outputMap: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(outputs)) outputMap[k] = (v as { output: unknown }).output;
      const metrics = extractQueryMetrics(outputMap as Record<string, { output: unknown }>, durationMs + ingestionDurationMs / QUERIES.length);

      console.log(`    hitRate=${fmt(metrics.hitRate)} citationCoverage=${fmt(metrics.citationCoverage)} retrieved=${metrics.retrievedCount} (${durationMs}ms)`);
      queryResults.push({ queryId, query: queryText, status: "success", metrics });
      allQueryMetrics.push(metrics);

      // 保存单次结果
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${testCase.id}_${queryId}.json`),
        JSON.stringify({ testId: testCase.id, queryId, query: queryText, config: testCase, outputs, metrics }, null, 2)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`    ✗ 失败: ${message}`);
      queryResults.push({ queryId, query: queryText, status: "failed", error: message });
    }
  }

  const successfulMetrics = allQueryMetrics;
  if (successfulMetrics.length === 0) {
    return { testId: testCase.id, label: testCase.label, status: "failed", error: "所有 query 均失败", queryResults, metrics: null };
  }

  const metrics = averageQueryMetrics(successfulMetrics);
  const status = successfulMetrics.length === QUERIES.length ? "success" : "partial";
  console.log(`  ✓ ${testCase.id} 完成 (${status}) — avg hitRate=${fmt(metrics.hitRate)} citationCoverage=${fmt(metrics.citationCoverage)}`);
  return { testId: testCase.id, label: testCase.label, status, queryResults, metrics };
}

function fmt(v: number | null): string {
  return v === null ? "n/a" : v.toFixed(2);
}

async function preflight(): Promise<void> {
  // 1. dev server 可达
  try {
    const res = await fetch(`${BASE_URL}/api/documents`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`✗ dev server 不可达 (${BASE_URL})。请先运行: cd app && npm run dev`);
    console.error("  详情:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 2. 必要 env 检查（DATABASE_URL 由 dev server 读取，这里只提示）
  const missing = ["DATABASE_URL", "EMBEDDING_API_KEY", "LLM_API_KEY"]
    .filter((k) => !process.env[k])
    // 如果至少有一个 key 存在就不报错（EMBEDDING_API_KEY 和 LLM_API_KEY 任一即可）
    .filter((k) => {
      if (k === "EMBEDDING_API_KEY") return !process.env.EMBEDDING_API_KEY && !process.env.LLM_API_KEY && !process.env.OPENAI_API_KEY;
      if (k === "LLM_API_KEY") return false; // 已在上一行合并检查
      return !process.env[k];
    });
  if (missing.length > 0) {
    console.warn(`⚠ 以下环境变量未设置，API 调用可能失败: ${missing.join(", ")}`);
    console.warn("  dev server 的 .env.local 中需要配置这些变量");
  }

  console.log("✓ 前置检查通过\n");
}

async function main() {
  console.log("=== Eval Matrix Runner ===");
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`结果目录: ${path.relative(process.cwd(), RESULTS_DIR)}`);
  await preflight();

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // 读取测试文档
  const docPath = path.join(__dirname, "../../docs/PRODUCT.md");
  if (!fs.existsSync(docPath)) throw new Error(`测试文档不存在: ${docPath}`);
  const docText = fs.readFileSync(docPath, "utf-8");
  console.log(`测试文档: docs/PRODUCT.md (${docText.length} 字符)`);

  // 读取测试矩阵
  const matrixPath = path.join(__dirname, "test-matrix.json");
  const testCases: TestCase[] = JSON.parse(fs.readFileSync(matrixPath, "utf-8"));
  console.log(`测试矩阵: ${testCases.length} 个 test case × ${QUERIES.length} 个 query`);
  QUERIES.forEach((q) => console.log(`  ${q.id} [${q.difficulty ?? "-"}] ${q.text}`));
  console.log();

  // 上传测试文档（每次运行上传一次，各 test case 共用）
  let documentId: string;
  try {
    documentId = await uploadDocument(docText);
    console.log(`文档 ID: ${documentId}\n`);
  } catch (err) {
    console.error("文档上传失败，请确认 dev server 已启动:", err);
    process.exit(1);
  }

  // 执行测试矩阵
  const allResults: TestCaseResult[] = [];
  let skip = Boolean(START_FROM);

  for (const testCase of testCases) {
    if (skip && testCase.id === START_FROM) skip = false;
    if (skip) {
      console.log(`⏭ 跳过 ${testCase.id} (START_FROM=${START_FROM})`);
      continue;
    }

    const result = await runTestCase(documentId, testCase);
    allResults.push(result);

    // 保存中间结果，支持断点续看
    fs.writeFileSync(
      path.join(RESULTS_DIR, `${testCase.id}_summary.json`),
      JSON.stringify(result, null, 2)
    );
  }

  // 生成汇总报告
  const summaryPath = path.join(RESULTS_DIR, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(allResults, null, 2));
  console.log(`\n结果已保存: ${summaryPath}`);

  generateReport(allResults);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
