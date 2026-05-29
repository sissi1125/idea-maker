/**
 * IngestionJobRunner — feat-200.2 Week 2
 *
 * 把 5 个 ingestion stage 串成一条 pipeline，按固定权重映射到 0-100 progress：
 *
 *   阶段             权重    完成时 progress
 *   ---------------  ------  ---------------
 *   idempotency       10%     0  → 10
 *   preprocess        25%    10  → 35
 *   chunk             10%    35  → 45
 *   embedding         40%    45  → 85
 *   storage           15%    85  → 100
 *
 * 设计原则：
 *   - 每 stage 入口先写 currentStage + 起始 progress（让 SSE 第一时间能推"开始 embedding"）
 *   - stage 内部不细分进度（保持简单；Week 8 优化时可在 embedding/storage 分批写）
 *   - 任意 stage throw → markFailed(stage, err.message) + 中断 pipeline
 *   - 5 stage 全成功 → markSucceeded（progress=100, finished_at）
 *
 * I/O 注入（与 controller 复刻一致）：
 *   - PreprocessInput.pymupdfServiceUrl：用 PYMUPDF_SERVICE_URL env（Week 2 跑文本走 fallback）
 *   - EmbeddingInput.openaiClient / hfTeiEndpoint：Week 2 走 debug-deterministic（免 API key）
 *   - StorageInput.pgClient：每次新 client（共用 DATABASE_URL）
 *
 * 复用资产：rag-core 5 个纯函数，与 Playground 路由一致。
 */

import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { Client as PgClient } from "pg";
import {
  checkIdempotency,
  runPreprocess,
  runChunk,
  runTransform,
  runEmbedding,
  runStorage,
} from "@harness/rag-core";
import { DbService } from "../db/db.service";
import { MvpDocumentsService } from "../mvp-documents/mvp-documents.service";
import { FileStorageService } from "../mvp-documents/file-storage.service";
import { ProvidersService } from "../pipeline/providers.service";
import { IngestionService } from "./ingestion.service";
import type { IngestionStage } from "./ingestion.types";

interface StageMilestone {
  stage: IngestionStage;
  progressBefore: number;
  progressAfter: number;
}

// feat-experiment-6 起 ingestion 是 6 阶段（加 transform）。
// 权重重新分配：transform 走纯 JS 不调 API，比较快，占 5%。
const MILESTONES: StageMilestone[] = [
  { stage: "idempotency", progressBefore: 0,  progressAfter: 10 },
  { stage: "preprocess",  progressBefore: 10, progressAfter: 35 },
  { stage: "chunk",       progressBefore: 35, progressAfter: 45 },
  { stage: "transform",   progressBefore: 45, progressAfter: 50 },
  { stage: "embedding",   progressBefore: 50, progressAfter: 85 },
  { stage: "storage",     progressBefore: 85, progressAfter: 100 },
];

@Injectable()
export class IngestionJobRunner {
  constructor(
    private readonly db: DbService,
    private readonly storage: FileStorageService,
    private readonly mvpDocs: MvpDocumentsService,
    private readonly providers: ProvidersService,
    @Inject(forwardRef(() => IngestionService))
    private readonly jobs: IngestionService,
  ) {}

  /**
   * 跑一个 job。入口：IngestionService.enqueue() 通过 setImmediate 触发。
   * 不抛错——所有异常翻译成 markFailed。
   */
  async run(jobId: string): Promise<void> {
    let currentStage: IngestionStage | null = null;
    try {
      await this.jobs.markStarted(jobId);
      const job = await this.jobs.getJobInternal(jobId);
      const doc = await this.fetchDocument(job.documentId);
      await this.mvpDocs.updateStatus(doc.id, "processing");

      // ── Stage 1: idempotency ─────────────────────────────────────────────
      currentStage = "idempotency";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[0].progressBefore,
      });
      const idempStart = Date.now();
      const buffer = this.storage.read(doc.storageRef);
      const rawContent = doc.isBinary
        ? buffer.toString("base64")
        : buffer.toString("utf-8");
      const idempResult = checkIdempotency({
        methodId: "sha256-content",
        params: {
          normalizeWhitespace: false,
          includeFileName: false,
          versionPolicy: "new-version",
        },
        targetDoc: {
          id: doc.id,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          rawContent,
          version: doc.version,
        },
        otherDocs: [], // MVP Week 2 不做跨 document 判重（PG 已按 hash 索引，未来从 PG 拉）
      });
      await this.jobs.setStageOutput(jobId, "idempotency", {
        method: "sha256-content",
        durationMs: Date.now() - idempStart,
        metrics: {
          // 走判重结论：是否已存在（同一文件再传） / 推荐动作 / 内容 hash 前 8 位
          exists: idempResult.output.exists,
          recommendedAction: idempResult.output.recommendedAction,
          hashPrefix: idempResult.output.hash.slice(0, 8),
          fileBytes: doc.fileSize,
        },
      });
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[0].progressAfter,
      });

      // ── Stage 2: preprocess ──────────────────────────────────────────────
      currentStage = "preprocess";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[1].progressBefore,
      });
      const preprocessStart = Date.now();
      const preprocessMethod = this.pickPreprocessMethod(doc.mimeType, doc.isBinary);
      const preprocessed = await runPreprocess({
        // 文本 → markdown-structure；PDF → pdf-pages；DOCX → markitdown（含 mammoth）
        methodId: preprocessMethod,
        params: {
          preserveHeadings: true,
          preserveTables: true,
          removeBoilerplate: true,
          maxChars: 200000,
          pdfPageRange: "",
          preserveLayout: true,
          extractImages: false,
          // feat-experiment-4.1：0 = 保留完整 heading 层级，与历史 ingestion 行为一致
          sourceRefDepth: 0,
        },
        doc: {
          rawContent,
          buffer,
          mimeType: doc.mimeType,
          isBinary: doc.isBinary,
          fileName: doc.fileName,
        },
        pymupdfServiceUrl: process.env.PYMUPDF_SERVICE_URL,
      });
      await this.jobs.setStageOutput(jobId, "preprocess", {
        method: preprocessMethod,
        durationMs: Date.now() - preprocessStart,
        metrics: {
          charsExtracted: preprocessed.output.charCount,
          sourceRefs: preprocessed.output.sourceRefs.length,
          pageCount: preprocessed.output.metadata.pageCount ?? 0,
          warnings: preprocessed.output.warnings.length,
        },
        note: preprocessed.output.warnings[0],
      });
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[1].progressAfter,
      });

      // ── Stage 3: chunk ───────────────────────────────────────────────────
      currentStage = "chunk";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[2].progressBefore,
      });
      const chunkStart = Date.now();
      // feat-experiment-4.1 / 实验 6 最优：chunkSize=512, overlap=64
      // 256 太小语义不全；1024 太大稀释；512 在中文产品文档（段落 200-400 字）
      // 对应一个完整语义单元，citation=1.00。
      const chunkSize = 512;
      const overlap = 64;
      const chunked = runChunk({
        methodId: "recursive",
        params: {
          chunkSize,
          overlap,
          headingDepth: 3,
          minChunkSize: 50,
        },
        upstream: {
          cleanText: preprocessed.output.cleanText,
          sourceRefs: preprocessed.output.sourceRefs,
          fileName: doc.fileName,
        },
      });
      const chunksTotal = chunked.output.chunks.length;
      await this.jobs.setStageOutput(jobId, "chunk", {
        method: "recursive",
        durationMs: Date.now() - chunkStart,
        metrics: {
          chunkSize,
          overlap,
          chunksTotal,
          avgChunkSize: Math.round(chunked.output.avgChunkSize),
          maxChunkSize: chunked.output.maxChunkSize,
        },
      });
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[2].progressAfter,
        chunksTotal,
      });

      // ── Stage 4: transform（feat-experiment-6 最优配置） ──────────────────
      // summary-keywords：用 jieba TF 提取 5 个关键词 + 100 token 摘要，
      // 注入到 chunk.enhancedText（不替换原 text）。
      // 实验 6 T02 验证 citationCoverage 1.00（vs 基线 0.89）。
      currentStage = "transform";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[3].progressBefore,
      });
      const transformStart = Date.now();
      const transformed = runTransform({
        methodId: "summary-keywords",
        params: {
          // 共享 schema 默认值——显式列出便于实验回溯
          includeTitle: true,
          includeHeadingPath: true,
          documentTitle: doc.fileName,
          keywordCount: 5,
          summaryMaxTokens: 100,
          appendToChunk: true,
        },
        upstreamChunks: chunked.output.chunks,
      });
      await this.jobs.setStageOutput(jobId, "transform", {
        method: "summary-keywords",
        durationMs: Date.now() - transformStart,
        metrics: {
          chunksTransformed: transformed.output.chunks.length,
          keywordCount: 5,
          summaryMaxTokens: 100,
          // 抽样查 1 个 chunk 的关键词数量，让用户看到 transform 真的注入了内容
          sampleKeywords: transformed.output.chunks[0]?.keywords?.length ?? 0,
        },
      });
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[3].progressAfter,
      });

      // ── Stage 5: embedding ───────────────────────────────────────────────
      currentStage = "embedding";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[4].progressBefore,
      });
      const embedStart = Date.now();
      // embedding 方法选择：
      //   - 有 OPENAI_API_KEY → openai-3-small（真实语义向量，与 retrieval 对齐）
      //   - 无 API key → debug-deterministic（FNV-1a hash，仅流程验证）
      // dimension=1024：与 Playground 既有 chunks 表对齐，避免 Dimension Guard 冲突
      let embeddingClient;
      let embeddingModel = "debug";
      let useRealEmbedding = false;
      try {
        // 从 ProvidersService 拿 client + 默认 model（读 EMBEDDING_MODEL env，
        // 兼容 Ollama bge-m3 / Qwen text-embedding-v4 / OpenAI text-embedding-3-small 等）
        const cfg = this.providers.createEmbeddingClient();
        embeddingClient = cfg.client;
        embeddingModel = cfg.defaultModel;
        useRealEmbedding = true;
      } catch {
        // 无 API key，降级到 debug-deterministic
      }

      const embedded = await runEmbedding({
        methodId: useRealEmbedding ? "openai-3-small" : "debug-deterministic",
        params: {
          // model 必须用 env 配置的真实模型名，不能写死 "text-embedding-3-small"——
          // 否则 Ollama / 智谱 / 阿里云 等兼容端点会因模型名不存在而 404。
          model: embeddingModel,
          dimension: 1024,
          batchSize: 16,
        },
        // feat-experiment-6：用 transform 后的 chunks（含 enhancedText：原文 +
        // 注入的关键词/摘要）做 embedding，召回信号更强
        upstreamChunks: transformed.output.chunks,
        openaiClient: embeddingClient,
      });
      await this.jobs.setStageOutput(jobId, "embedding", {
        method: useRealEmbedding ? "openai-3-small" : "debug-deterministic",
        durationMs: Date.now() - embedStart,
        metrics: {
          model: embedded.output.model,
          dimension: embedded.output.dimension,
          batchCount: embedded.output.batchCount,
          tokensEstimated: embedded.output.totalTokensEstimated,
          mock: !useRealEmbedding,
        },
        note: useRealEmbedding
          ? undefined
          : "无 LLM API key，降级到 debug-deterministic（FNV-1a hash 伪向量，仅供流程验证）",
      });
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[4].progressAfter,
        chunksDone: chunksTotal,
      });

      // ── Stage 6: storage ─────────────────────────────────────────────────
      currentStage = "storage";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[5].progressBefore,
      });
      const storageStart = Date.now();
      const cs = this.db.resolveConnectionString();
      if (!cs) throw new Error("DATABASE_URL 未配置，无法写 pgvector");
      const pgClient = new PgClient({ connectionString: cs });
      await pgClient.connect();
      try {
        const stored = await runStorage({
          // replace-version：只删本 document 的旧 chunks（按 doc_id 范围）后插入新数据，
          // 与同表里其他 document（含 Playground 写入）共存
          methodId: "pgvector-replace-version",
          params: {
            indexMode: "hnsw",
            conflictPolicy: "upsert",
            truncateTable: false,
          },
          upstreamChunks: embedded.output.chunks,
          dimension: embedded.output.dimension,
          documentId: doc.id,
          // feat-200.8.x P0：MVP 路径传真实 project UUID，让 retrieval 按 project 隔离
          projectId: job.projectId,
          pgClient,
        });
        await this.jobs.setStageOutput(jobId, "storage", {
          method: "pgvector-replace-version",
          durationMs: Date.now() - storageStart,
          metrics: {
            indexMode: stored.output.indexMode,
            rowsInserted: stored.output.storedChunks,
            dimension: stored.output.dimension,
            indexCreated: stored.output.indexCreated,
          },
        });
      } finally {
        await pgClient.end().catch(() => undefined);
      }

      // ── 完成 ─────────────────────────────────────────────────────────────
      await this.mvpDocs.updateStatus(doc.id, "ready");
      await this.jobs.markSucceeded(jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        const job = await this.jobs.getJobInternal(jobId);
        await this.mvpDocs.updateStatus(job.documentId, "error");
      } catch {
        /* 状态回填失败不阻塞 */
      }
      await this.jobs.markFailed(jobId, currentStage, msg);
    }
  }

  /**
   * 取 document（含 storageRef / mimeType / 推 isBinary）。
   * MVP 不走 owner 校验，runner 内部信任。
   */
  private async fetchDocument(documentId: string): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    version: number;
    storageRef: string;
    isBinary: boolean;
  }> {
    return this.db.withClient(async (client) => {
      const res = await client.query<{
        id: string;
        file_name: string;
        mime_type: string;
        file_size: number;
        version: number;
        storage_ref: string;
      }>(
        `SELECT id, file_name, mime_type, file_size, version, storage_ref
         FROM documents WHERE id = $1 LIMIT 1`,
        [documentId],
      );
      if (res.rows.length === 0) throw new Error(`document ${documentId} 不存在`);
      const r = res.rows[0];
      return {
        id: r.id,
        fileName: r.file_name,
        mimeType: r.mime_type,
        fileSize: r.file_size,
        version: r.version,
        storageRef: r.storage_ref,
        isBinary: isBinaryMime(r.mime_type),
      };
    });
  }

  /**
   * 按 mimeType 选 preprocess 方法。
   * - PDF：pymupdf 服务可用就走 pymupdf，否则 pdf-pages；都失败再回 plain-text
   *   Week 2 简化：跑 pdf-pages，pymupdf 留给 Week 8 集成
   * - DOCX：docx-html-markdown
   * - 纯文本 / markdown：markdown-structure
   * - 其他：plain-text
   */
  private pickPreprocessMethod(
    mimeType: string,
    isBinary: boolean,
  ): "markdown-structure" | "plain-text" | "pdf-pages" | "markitdown" {
    if (!isBinary) {
      // 文本类：markdown / txt 都走 markdown-structure（含 fallback）
      return "markdown-structure";
    }
    if (mimeType === "application/pdf" || mimeType === "application/x-pdf") {
      return "pdf-pages";
    }
    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      // markitdown 内部按 mimeType 路由到 mammoth（DOCX）/ turndown / pdf-parse
      return "markitdown";
    }
    return "plain-text";
  }
}

function isBinaryMime(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    mimeType === "application/x-pdf" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  );
}
