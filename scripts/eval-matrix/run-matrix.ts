#!/usr/bin/env node
/**
 * Eval Matrix Runner
 *
 * 用法：
 *   npx tsx scripts/eval-matrix/run-matrix.ts
 *
 * 前提条件：
 *   - NestJS API 已启动（pnpm --filter @harness/api start:dev，默认 3001 端口）
 *   - PostgreSQL 可访问（docker compose up postgres）
 *   - DATABASE_URL / EMBEDDING_API_KEY / LLM_API_KEY 已设置
 *   - HF_TEI_ENDPOINT 已设置（pipeline-rerank 需要 TEI 服务）
 *
 * 可选环境变量：
 *   BASE_URL=http://localhost:3001              （默认，对接 apps/api NestJS）
 *   START_FROM=T04                              （跳过前面的 test case，用于断点续跑）
 *   RUN_ID=run-002-20260521                     （指定结果目录名，默认按日期自动生成）
 *   EXPERIMENT=experiment-4-citation            （实验系列名，决定结果落到 current/<EXPERIMENT>/）
 *                                               不设则落到 results/ 根（兼容旧行为）
 *
 * 结果目录结构（按实验系列组织）：
 *   results/legacy/             — 历史 run-001~016 等
 *   results/current/<EXPERIMENT>/run-NNN/ — 当前进行中的实验系列
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractQueryMetrics, averageQueryMetrics } from "./collect-metrics.js";
import { generateReport } from "./report.js";
import { preprocessDoc } from "./preprocess-doc.js";
import type { TestCase, TestCaseResult, QueryResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 默认指向 apps/api NestJS（3001）。Session 39 重构后 pipeline endpoints 迁移到独立 API
// 服务，apps/web (3000) 不再有 /api/pipeline/* 路由。
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
const START_FROM = process.env.START_FROM ?? null;

// 结果目录解析：
//   优先级 1：RUN_ID 显式指定（绝对覆盖，相对 results/ 根）
//   优先级 2：EXPERIMENT 指定实验系列 → results/current/<EXPERIMENT>/run-NNN/
//   优先级 3：兼容旧行为，落到 results/ 根 → results/run-NNN-YYYYMMDD/
// run 编号在所属目录内自动递增（不受其他系列影响）
function resolveResultsDir(): string {
  const resultsBase = path.join(__dirname, "results");
  if (process.env.RUN_ID) return path.join(resultsBase, process.env.RUN_ID);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const experiment = process.env.EXPERIMENT?.trim();
  const seriesDir = experiment
    ? path.join(resultsBase, "current", experiment)
    : resultsBase;

  if (!fs.existsSync(seriesDir)) fs.mkdirSync(seriesDir, { recursive: true });
  // 在所属系列目录里自增 run 编号
  const existing = fs.readdirSync(seriesDir).filter((d) => /^run-\d{3}/.test(d)).sort();
  const lastNum = existing.length > 0 ? parseInt(existing[existing.length - 1].slice(4, 7)) : 0;
  const nextNum = String(lastNum + 1).padStart(3, "0");
  // 带 EXPERIMENT 时目录名更短（run-NNN），无 EXPERIMENT 时保留旧格式（run-NNN-YYYYMMDD）
  const runDirName = experiment ? `run-${nextNum}` : `run-${nextNum}-${today}`;
  return path.join(seriesDir, runDirName);
}

const RESULTS_DIR = resolveResultsDir();

// queries 从独立文件读取，方便每次 run 单独配置
// QUERIES_FILE 可指定相对 eval-matrix 目录的文件名，默认 queries.json
// 示例：QUERIES_FILE=queries-step1.json npx tsx run-matrix.ts
const queriesFile = process.env.QUERIES_FILE ?? "queries.json";
const queriesPath = path.join(__dirname, queriesFile);
const QUERIES: Array<{ id: string; text: string; type?: string; difficulty?: string }> =
  JSON.parse(fs.readFileSync(queriesPath, "utf-8"));

// 固定参数
const FIXED = {
  preprocess: { methodId: "markdown-structure", params: { preserveHeadings: true, removeBoilerplate: false, maxChars: 0 } },
  // embedding 走本地 Ollama bge-m3（完全离线，无网络/代理/付费问题）
  // 中文优化模型，1024 维。Ollama 暴露 OpenAI 兼容端点 localhost:11434/v1
  // .env.local 的 EMBEDDING_BASE_URL / EMBEDDING_MODEL 需同步更新
  embedding:  { methodId: "openai-3-small",     params: { model: "bge-m3", dimension: 1024, batchSize: 4 } },
  // ⚠️ truncateTable: false——以前默认 true 会 TRUNCATE 整张 rag_chunks 表，
  // 清掉所有项目（包括用户真实项目）的 chunks。每次跑 eval-matrix 实验都用唯一
  // documentId（uploadDocument 返回的 hash），ON CONFLICT upsert 自然隔离自己数据，
  // 不需要清表。
  storage:    { methodId: "pgvector-upsert-version", params: { truncateTable: false, conflictPolicy: "upsert", indexMode: "hnsw" } },
  intentRecognition: { methodId: "rule-based",   params: {} },
  rerank:     { methodId: "score-only",           params: {} },
  citation:   { methodId: "chunk-citation",      params: { maxEvidencePerClaim: 3 } },
  promptBuild:{ methodId: "marketing-template",  params: { targetAudience: "产品运营和独立开发者", tone: "professional", maxContextTokens: 2000 } },
  generation: { methodId: "marketing-ideas",     params: { ideaCount: 5, includeEvidence: true } },
  evaluation: { methodId: "rag-metrics-only",    params: { scoreThreshold: 0.2 } },
};

// connection error 时自动重试，最多 3 次，间隔 3s
async function post(route: string, body: unknown, retries = 3): Promise<unknown> {
  const url = `${BASE_URL}/pipeline/${route}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
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
    } catch (err) {
      const isConnectionError = err instanceof Error && err.message.includes("Connection error");
      if (isConnectionError && attempt < retries) {
        console.log(`    ⚠ ${route} 连接失败，${3}s 后重试 (${attempt}/${retries})...`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${route} 重试 ${retries} 次后仍然失败`);
}

async function uploadDocument(text: string): Promise<string> {
  console.log("  📄 上传测试文档...");
  const res = await fetch(`${BASE_URL}/documents`, {
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

  // preprocess：优先用 testCase.preprocess，否则用 FIXED.preprocess
  const preprocessConfig = testCase.preprocess ?? FIXED.preprocess;
  const preprocess = await post("preprocess", {
    methodId: preprocessConfig.methodId,
    params: preprocessConfig.params,
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
    // feat-200.8.x P0：eval-matrix 的 chunks 归属 'eval-matrix' 虚拟项目，
    // 与 MVP / Playground 数据严格隔离
    projectId: "eval-matrix",
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
    // feat-200.8.x P0：必传，与上面 storage 的 projectId 配对
    projectId: "eval-matrix",
    upstreamOutput: outputs.queryRewrite.output,
  }) as { output: unknown };

  outputs.filter = await post("filter", {
    methodId: testCase.filter.methodId,
    params: testCase.filter.params,
    upstreamOutput: outputs.retrieval.output,
  }) as { output: unknown };

  // rerank：优先用 testCase.rerank，否则用 FIXED.rerank
  const rerankConfig = testCase.rerank ?? FIXED.rerank;
  outputs.rerank = await post("rerank", {
    methodId: rerankConfig.methodId,
    params: rerankConfig.params,
    upstreamOutput: outputs.filter.output,
  }) as { output: unknown };

  // citation：优先用 testCase.citation，否则用 FIXED.citation
  // section-citation 的 connectionString 留空，由 server 端从 DATABASE_URL 环境变量 fallback
  const citationConfig = testCase.citation ?? FIXED.citation;
  outputs.citation = await post("citation", {
    methodId: citationConfig.methodId,
    params: citationConfig.params,
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

  // scoreThreshold：优先用 testCase.scoreThreshold，否则用 FIXED 默认值
  const scoreThreshold = testCase.scoreThreshold ?? FIXED.evaluation.params.scoreThreshold;
  outputs.evaluation = await post("evaluation", {
    methodId: FIXED.evaluation.methodId,
    params: { ...FIXED.evaluation.params, scoreThreshold },
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

      console.log(`    hitRate=${fmt(metrics.hitRate)} citationCoverage=${fmt(metrics.citationCoverage)} retrieved=${metrics.retrievedCount} ctxLen=${metrics.contextLength ?? "n/a"} evidence=${metrics.evidenceCount ?? "n/a"} (${durationMs}ms)`);
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
  // 1. NestJS API 可达：调 /health 是最轻量、最稳定的探活端点
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`✗ NestJS API 不可达 (${BASE_URL})。请先运行: pnpm --filter @harness/api start:dev`);
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

  // 读取文档配置
  const docConfigPath = path.join(__dirname, "doc-config.json");
  const docConfig = JSON.parse(fs.readFileSync(docConfigPath, "utf-8")) as {
    sourcePath: string;
    preprocessing: Parameters<typeof preprocessDoc>[1];
    description?: string;
  };

  // 读取并预处理测试文档
  const docSourcePath = docConfig.sourcePath.startsWith("/")
    ? docConfig.sourcePath
    : path.resolve(__dirname, docConfig.sourcePath);
  if (!fs.existsSync(docSourcePath)) throw new Error(`测试文档不存在: ${docSourcePath}`);
  const rawText = fs.readFileSync(docSourcePath, "utf-8");
  const { text: docText, log: preprocLog } = preprocessDoc(rawText, docConfig.preprocessing ?? {});

  console.log(`测试文档: ${docConfig.description ?? docSourcePath}`);
  console.log(`  原始长度: ${rawText.length} 字符`);
  preprocLog.forEach((l) => console.log(`  ${l}`));

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
