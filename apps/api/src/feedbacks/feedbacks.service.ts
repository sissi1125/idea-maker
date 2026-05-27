/**
 * FeedbacksService — feat-200.4 Week 4
 *
 * 业务规则：
 *   - 一条 generation 只允许一份 feedback；再次提交走 ON CONFLICT UPDATE（覆盖式）
 *     ↳ 用户改主意/补评分时直接重提；前端通过 GET 拿最新一份显示
 *   - 评分维度必须在 [1, 5] 整数区间，DB 层 CHECK 已挡住；service 提前做参数校验
 *     给出更友好的 400（避免直接吐 SQL 错给前端）
 *   - 权限：通过 GenerationsService.assertOwnedByUser 复用 owner 链
 *     ↳ 跨用户提交别人 generation 的反馈直接 404，与 generation 详情同语义
 */

import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import { GenerationsService } from "../generations/generations.service";
import { FEEDBACK_DIMENSIONS, type FeedbackInput, type FeedbackRow } from "./feedbacks.types";

@Injectable()
export class FeedbacksService {
  constructor(
    private readonly db: DbService,
    private readonly generations: GenerationsService,
  ) {}

  /** 提交或覆盖反馈，返回最新行。 */
  async upsert(userId: string, generationId: string, input: FeedbackInput): Promise<FeedbackRow> {
    validateRatings(input);
    if (!hasAnyRating(input) && !input.editDiff && !input.comment) {
      throw new BadRequestException("评分 / 编辑 / 评论至少需提供一项");
    }
    await this.generations.assertOwnedByUser(userId, generationId);

    return this.db.withClient(async (client) => {
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO feedbacks
           (id, generation_id, user_id, relevance, accuracy, creativity, overall, edit_diff, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (generation_id) DO UPDATE SET
           relevance  = EXCLUDED.relevance,
           accuracy   = EXCLUDED.accuracy,
           creativity = EXCLUDED.creativity,
           overall    = EXCLUDED.overall,
           edit_diff  = EXCLUDED.edit_diff,
           comment    = EXCLUDED.comment,
           user_id    = EXCLUDED.user_id,
           updated_at = NOW()
         RETURNING id, generation_id, user_id, relevance, accuracy, creativity, overall,
                   edit_diff, comment, created_at, updated_at`,
        [
          id,
          generationId,
          userId,
          input.relevance ?? null,
          input.accuracy ?? null,
          input.creativity ?? null,
          input.overall ?? null,
          input.editDiff ?? null,
          input.comment ?? null,
        ],
      );
      return mapRow(rows[0] as DbFeedbackRow);
    });
  }

  /** 查询指定 generation 的反馈；不存在返回 null（而非 404）。 */
  async getByGeneration(userId: string, generationId: string): Promise<FeedbackRow | null> {
    await this.generations.assertOwnedByUser(userId, generationId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, generation_id, user_id, relevance, accuracy, creativity, overall,
                edit_diff, comment, created_at, updated_at
         FROM feedbacks WHERE generation_id = $1`,
        [generationId],
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0] as DbFeedbackRow);
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function validateRatings(input: FeedbackInput): void {
  for (const dim of FEEDBACK_DIMENSIONS) {
    const v = input[dim];
    if (v === undefined || v === null) continue;
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new BadRequestException(`${dim} 必须是 1-5 之间的整数`);
    }
  }
}

function hasAnyRating(input: FeedbackInput): boolean {
  return FEEDBACK_DIMENSIONS.some((dim) => {
    const v = input[dim];
    return v !== undefined && v !== null;
  });
}

interface DbFeedbackRow {
  id: string;
  generation_id: string;
  user_id: string;
  relevance: number | null;
  accuracy: number | null;
  creativity: number | null;
  overall: number | null;
  edit_diff: string | null;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: DbFeedbackRow): FeedbackRow {
  return {
    id: row.id,
    generationId: row.generation_id,
    userId: row.user_id,
    relevance: row.relevance,
    accuracy: row.accuracy,
    creativity: row.creativity,
    overall: row.overall,
    editDiff: row.edit_diff,
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
