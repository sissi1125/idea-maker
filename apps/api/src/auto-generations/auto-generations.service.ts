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
  type ProjectAutoGenLatest,
  type ProjectAutoGenInFlight,
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

  /**
   * 项目级"最新成功"自动卡片：每种 card_type 取最近一次 succeeded 的 auto-gen，
   * JOIN generations 拿到真实的 result_notes / cost / 完成时间。
   *
   * 用途：Chat 页 ProjectInfoCards——产品介绍 / 竞品对比卡需要展示真实摘要内容。
   *
   * 实现：用 DISTINCT ON (card_type) 在单条 SQL 里按 card_type 分组取最新一行，
   * 比"先 list 再前端过滤"更省往返；ORDER BY card_type ASC, created_at DESC
   * 让 DISTINCT 命中正确的最新行。
   *
   * 只返回 status='succeeded' 且 generations.status='succeeded' 的；其他状态前端
   * 视为"未生成"，渲染占位引导。
   */
  async getLatestByProject(projectId: string): Promise<ProjectAutoGenLatest[]> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<{
        card_type: string;
        auto_gen_id: string;
        document_id: string;
        generation_id: string;
        result_notes: string | null;
        duration_ms: number | null;
        cost_breakdown: unknown;
        gen_created_at: Date;
        auto_created_at: Date;
      }>(
        `SELECT DISTINCT ON (a.card_type)
                a.card_type,
                a.id            AS auto_gen_id,
                a.document_id,
                a.generation_id,
                g.result_notes,
                g.duration_ms,
                g.cost_breakdown,
                g.created_at    AS gen_created_at,
                a.created_at    AS auto_created_at
         FROM auto_generations a
         JOIN generations g ON g.id = a.generation_id
         WHERE a.project_id = $1
           AND a.status = 'succeeded'
           AND g.status = 'succeeded'
         ORDER BY a.card_type ASC, a.created_at DESC`,
        [projectId],
      );
      return rows.map((r) => ({
        cardType: r.card_type as AutoGenCardType,
        autoGenId: r.auto_gen_id,
        documentId: r.document_id,
        generationId: r.generation_id,
        resultNotes: r.result_notes,
        durationMs: r.duration_ms,
        costBreakdown: r.cost_breakdown,
        generatedAt: r.gen_created_at.toISOString(),
        triggeredAt: r.auto_created_at.toISOString(),
      }));
    });
  }

  /**
   * 项目级"进行中或最近失败"的自动卡片——给 ProjectInfoCards 显示状态横幅用。
   *
   * 语义：
   *   - 优先返回 queued / running 行（每种 card_type 最新一条）；
   *   - 若该 card_type 没有 in-flight，但**最新**一条是 failed（晚于任何 succeeded），
   *     也算 in-flight 让前端能告诉用户"上次失败"——而不是误以为没生成过。
   *   - 如果该 card_type 最新一条已 succeeded，则不返回（被 getLatestByProject 覆盖）。
   *
   * 这里不再走 DISTINCT ON——逻辑上需要按 card_type 找"最新非 succeeded"的行
   * 而忽略它之后的 succeeded。用相关子查询取每种 card_type 最新一行，再过滤。
   */
  async getInFlightByProject(projectId: string): Promise<ProjectAutoGenInFlight[]> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<{
        card_type: string;
        id: string;
        document_id: string;
        status: string;
        created_at: Date;
        error: string | null;
      }>(
        // 用 DISTINCT ON 取每种 card_type 最新一行（无论状态），再在外层只保留非 succeeded
        `SELECT card_type, id, document_id, status, created_at, error
         FROM (
           SELECT DISTINCT ON (card_type)
                  card_type, id, document_id, status, created_at, error
           FROM auto_generations
           WHERE project_id = $1
           ORDER BY card_type ASC, created_at DESC
         ) latest
         WHERE status IN ('queued', 'running', 'failed')`,
        [projectId],
      );
      return rows.map((r) => ({
        cardType: r.card_type as AutoGenCardType,
        autoGenId: r.id,
        documentId: r.document_id,
        status: r.status as "queued" | "running" | "failed",
        triggeredAt: r.created_at.toISOString(),
        error: r.error,
      }));
    });
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
