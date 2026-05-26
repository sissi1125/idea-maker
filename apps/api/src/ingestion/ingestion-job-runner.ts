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
  runEmbedding,
  runStorage,
} from "@harness/rag-core";
import { DbService } from "../db/db.service";
import { MvpDocumentsService } from "../mvp-documents/mvp-documents.service";
import { FileStorageService } from "../mvp-documents/file-storage.service";
import { IngestionService } from "./ingestion.service";
import type { IngestionStage } from "./ingestion.types";

interface StageMilestone {
  stage: IngestionStage;
  progressBefore: number;
  progressAfter: number;
}

const MILESTONES: StageMilestone[] = [
  { stage: "idempotency", progressBefore: 0, progressAfter: 10 },
  { stage: "preprocess", progressBefore: 10, progressAfter: 35 },
  { stage: "chunk", progressBefore: 35, progressAfter: 45 },
  { stage: "embedding", progressBefore: 45, progressAfter: 85 },
  { stage: "storage", progressBefore: 85, progressAfter: 100 },
];

@Injectable()
export class IngestionJobRunner {
  constructor(
    private readonly db: DbService,
    private readonly storage: FileStorageService,
    private readonly mvpDocs: MvpDocumentsService,
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
      const buffer = this.storage.read(doc.storageRef);
      const rawContent = doc.isBinary
        ? buffer.toString("base64")
        : buffer.toString("utf-8");
      checkIdempotency({
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
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[0].progressAfter,
      });

      // ── Stage 2: preprocess ──────────────────────────────────────────────
      currentStage = "preprocess";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[1].progressBefore,
      });
      const preprocessed = await runPreprocess({
        // 文本 → markdown-structure；PDF → pdf-pages；DOCX → markitdown（含 mammoth）
        methodId: this.pickPreprocessMethod(doc.mimeType, doc.isBinary),
        params: {
          preserveHeadings: true,
          preserveTables: true,
          removeBoilerplate: true,
          maxChars: 200000,
          pdfPageRange: "",
          preserveLayout: true,
          extractImages: false,
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
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[1].progressAfter,
      });

      // ── Stage 3: chunk ───────────────────────────────────────────────────
      currentStage = "chunk";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[2].progressBefore,
      });
      const chunked = runChunk({
        methodId: "recursive",
        params: {
          chunkSize: 600,
          overlap: 80,
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
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[2].progressAfter,
        chunksTotal,
      });

      // ── Stage 4: embedding ───────────────────────────────────────────────
      currentStage = "embedding";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[3].progressBefore,
      });
      const embedded = await runEmbedding({
        // Week 2 MVP 用 debug-deterministic：免 API key、可重复、向量为 FNV-1a hash
        // Week 5 接入 BYOK 后改 'openai-3-small' / 'hf-tei-embedding' 等
        // dimension=1024：与 Playground 既有 chunks 表对齐，避免 Dimension Guard 冲突
        methodId: "debug-deterministic",
        params: {
          model: "debug",
          dimension: 1024,
          batchSize: 16,
        },
        upstreamChunks: chunked.output.chunks,
      });
      await this.jobs.updateProgress(jobId, {
        progress: MILESTONES[3].progressAfter,
        chunksDone: chunksTotal,
      });

      // ── Stage 5: storage ─────────────────────────────────────────────────
      currentStage = "storage";
      await this.jobs.updateProgress(jobId, {
        currentStage,
        progress: MILESTONES[4].progressBefore,
      });
      const cs = this.db.resolveConnectionString();
      if (!cs) throw new Error("DATABASE_URL 未配置，无法写 pgvector");
      const pgClient = new PgClient({ connectionString: cs });
      await pgClient.connect();
      try {
        await runStorage({
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
          pgClient,
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
