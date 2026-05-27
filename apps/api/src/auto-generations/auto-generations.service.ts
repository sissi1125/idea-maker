/**
 * AutoGenerationsService — feat-200.4 Week 4
 *
 * 监听 ingestion.completed，对 product / compete 类文档触发自动 generate：
 *   product → 产品介绍卡片（card_type=intro）
 *   compete → 竞品对比卡片（card_type=compete）
 *
 * 设计选择 / 已知陷阱：
 *   1. 事件回调里 ALS 上下文不会自动继承（EventEmitter2 跨 microtask），所以这里
 *      显式调 tracer.run(traceId, ...) 包一层，确保 generate 内的 addCost 能落到
 *      独立 trace（与触发 ingestion 的 HTTP 请求隔离）
 *   2. setImmediate 让事件 emit 不被阻塞——markSucceeded 调用方不应等 auto-gen 跑完
 *   3. ownerId 在事件中没有，所以走 generate({ skipOwnerCheck: true })；
 *      安全性由 ingestion 事件源头可信保证（仅自家 IngestionService emit）
 *   4. 失败不抛出：auto-gen 不应让用户感知到额外错误；只落 auto_generations.error
 *
 * 不在范围内：
 *   - history 类不触发：那是知识沉淀型，没有"对应卡片"语义
 *   - 同文档多次完成（重传新版本）会再次触发：靠 auto_generations 历史区分版本
 */

import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import { GenerationsService } from "../generations/generations.service";
import { TraceContextService } from "../common/trace-context.service";
import { INGESTION_EVENT, type IngestionCompletedEvent } from "../ingestion/ingestion.types";
import {
  CARD_QUERY_TEMPLATES,
  CATEGORY_AUTO_CARDS,
  type AutoGenCardType,
  type AutoGenerationRow,
  type AutoGenStatus,
} from "./auto-generations.types";

interface DbAutoGenRow {
  id: string;
  project_id: string;
  document_id: string;
  card_type: string;
  generation_id: string | null;
  status: string;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class AutoGenerationsService {
  private readonly logger = new Logger(AutoGenerationsService.name);

  constructor(
    private readonly db: DbService,
    private readonly generations: GenerationsService,
    private readonly tracer: TraceContextService,
  ) {}

  /** 入口：监听 ingestion.completed */
  @OnEvent(INGESTION_EVENT.completed, { async: true })
  async handleIngestionCompleted(event: IngestionCompletedEvent): Promise<void> {
    try {
      const category = await this.lookupCategory(event.documentId);
      if (!category) {
        this.logger.warn(`auto-gen 跳过：文档不存在 docId=${event.documentId}`);
        return;
      }
      const cards = CATEGORY_AUTO_CARDS[category];
      if (!cards || cards.length === 0) {
        // history 等不触发的 category：静默跳过
        return;
      }
      for (const cardType of cards) {
        // setImmediate 让多个卡片串行但不阻塞事件循环；同时给每张卡独立 trace
        setImmediate(() => {
          void this.runOne(event.projectId, event.documentId, cardType);
        });
      }
    } catch (err) {
      this.logger.error(
        `auto-gen 事件处理失败 docId=${event.documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 列出某文档的自动生成历史（按需供前端展示） */
  async listByDocument(documentId: string): Promise<AutoGenerationRow[]> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbAutoGenRow>(
        `SELECT id, project_id, document_id, card_type, generation_id, status, error,
                created_at, updated_at
         FROM auto_generations
         WHERE document_id = $1
         ORDER BY created_at DESC`,
        [documentId],
      );
      return rows.map(mapRow);
    });
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private async lookupCategory(documentId: string): Promise<string | null> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<{ category: string }>(
        `SELECT category FROM documents WHERE id = $1`,
        [documentId],
      );
      return rows.length > 0 ? rows[0].category : null;
    });
  }

  private async runOne(
    projectId: string,
    documentId: string,
    cardType: AutoGenCardType,
  ): Promise<void> {
    const autoGenId = randomUUID();
    await this.insertAutoGen(autoGenId, projectId, documentId, cardType, "running");

    const query = CARD_QUERY_TEMPLATES[cardType];
    const traceId = `auto-gen:${autoGenId}`;

    try {
      const result = await this.tracer.run(traceId, () =>
        this.generations.generate(null, projectId, query, {
          source: "auto",
          skipOwnerCheck: true,
        }),
      );

      if (result.status === "succeeded") {
        await this.updateAutoGen(autoGenId, "succeeded", result.generationId, null);
      } else {
        await this.updateAutoGen(autoGenId, "failed", result.generationId, result.error ?? "generate 失败");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`auto-gen 失败 autoGenId=${autoGenId} cardType=${cardType}: ${msg}`);
      await this.updateAutoGen(autoGenId, "failed", null, msg);
    }
  }

  private async insertAutoGen(
    id: string,
    projectId: string,
    documentId: string,
    cardType: AutoGenCardType,
    status: AutoGenStatus,
  ): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query(
        `INSERT INTO auto_generations (id, project_id, document_id, card_type, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, projectId, documentId, cardType, status],
      );
    });
  }

  private async updateAutoGen(
    id: string,
    status: AutoGenStatus,
    generationId: string | null,
    error: string | null,
  ): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query(
        `UPDATE auto_generations
         SET status = $1, generation_id = $2, error = $3, updated_at = NOW()
         WHERE id = $4`,
        [status, generationId, error, id],
      );
    });
  }
}

function mapRow(row: DbAutoGenRow): AutoGenerationRow {
  return {
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    cardType: row.card_type as AutoGenCardType,
    generationId: row.generation_id,
    status: row.status as AutoGenStatus,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
