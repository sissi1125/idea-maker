/**
 * FeedbackLearningService — feat-400.3
 *
 * 记录内容反馈（采纳/编辑/拒绝 + 编辑差异）→ 归类 → 聚合出偏好更新建议 →
 * 用户接受后写入 Product Brief 的表达约束。
 *
 * 红线（面试考点）：接受建议只会写 group=style/constraint 的表达字段，
 * 代码层面无法写 fact/identity 等事实分组 —— "反馈不得自动改写产品事实"从设计上保证。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import { ProductBriefService } from "../product-brief/product-brief.service";
import {
  classifyEditDiff,
  aggregateSuggestions,
  EDIT_CATEGORIES,
  type EditCategory,
} from "./edit-diff-classifier";

export interface RecordFeedbackInput {
  evaluationId?: string;
  action: "adopted" | "edited" | "rejected";
  originalText?: string;
  editedText?: string;
  category?: EditCategory;
  note?: string;
}

@Injectable()
export class FeedbackLearningService {
  private readonly logger = new Logger(FeedbackLearningService.name);

  constructor(
    private readonly db: DbService,
    private readonly briefs: ProductBriefService,
  ) {}

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  /**
   * 记录一条内容反馈。若用户没显式给 category，用编辑前后文本自动归类（best-effort）。
   */
  async recordFeedback(userId: string, projectId: string, input: RecordFeedbackInput) {
    await this.assertOwner(userId, projectId);
    let category = input.category ?? null;
    if (!category && input.action === "edited") {
      category = classifyEditDiff(input.originalText ?? "", input.editedText ?? "");
    }
    const id = randomUUID();
    await this.db.withClient(async (client) => {
      await client.query(
        `INSERT INTO content_feedback
           (id, project_id, evaluation_id, action, original_text, edited_text, category, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, projectId, input.evaluationId ?? null, input.action,
         input.originalText ?? null, input.editedText ?? null, category, input.note ?? null],
      );
    });
    return { id, category };
  }

  /**
   * 扫描近期已归类的编辑反馈 → 聚合出建议 → 写入 update_suggestions（去重：同 category 已有
   * pending 建议则跳过）。返回本次新增的建议。
   */
  async generateSuggestions(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      // 只取 edited 且已归类（非 other）的反馈
      const { rows } = await client.query<{ id: string; category: string }>(
        `SELECT id, category FROM content_feedback
          WHERE project_id = $1 AND action = 'edited' AND category IS NOT NULL AND category <> 'other'
          ORDER BY created_at DESC LIMIT 50`,
        [projectId],
      );
      // 已被任何既有建议"消费"过的反馈 id —— 不再重复触发。
      // 这样只有"真正新增"的同类反馈才会再出建议，避免同一批反馈反复刷建议。
      const { rows: existing } = await client.query<{ source_feedback_ids: unknown }>(
        `SELECT source_feedback_ids FROM update_suggestions WHERE project_id = $1`,
        [projectId],
      );
      const consumed = new Set<string>();
      for (const e of existing) {
        const ids = Array.isArray(e.source_feedback_ids) ? (e.source_feedback_ids as string[]) : [];
        ids.forEach((id) => consumed.add(id));
      }

      const feedbacks = rows
        .filter((r): r is { id: string; category: EditCategory } =>
          (EDIT_CATEGORIES as readonly string[]).includes(r.category))
        .map((r) => ({ id: r.id, category: r.category }))
        .filter((f) => !consumed.has(f.id));

      const suggestions = aggregateSuggestions(feedbacks);

      const created: Array<{ id: string; category: string; text: string }> = [];
      for (const s of suggestions) {
        const id = randomUUID();
        await client.query(
          `INSERT INTO update_suggestions
             (id, project_id, category, suggestion_text, target_group, target_key, target_value, source_feedback_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [id, projectId, s.category, s.text, s.template.targetGroup,
           s.template.targetKey, s.template.targetValue, JSON.stringify(s.sourceFeedbackIds)],
        );
        created.push({ id, category: s.category, text: s.text });
      }
      return { created };
    });
  }

  /** 列出建议（默认 pending 在前） */
  async listSuggestions(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, category, suggestion_text, target_group, target_key, target_value, status, created_at
           FROM update_suggestions WHERE project_id = $1
          ORDER BY (status = 'pending') DESC, created_at DESC`,
        [projectId],
      );
      return { suggestions: rows };
    });
  }

  /**
   * 接受一条建议 → 写入 Product Brief 表达约束字段（confirmed）。
   *
   * 双重保险防越界改事实：
   *   1. update_suggestions.target_group 的 CHECK 只允许 style/constraint；
   *   2. 这里再断言一次，绝不把 fact/identity 等传给 ProductBriefService。
   */
  async acceptSuggestion(userId: string, projectId: string, suggestionId: string) {
    await this.assertOwner(userId, projectId);
    const sug = await this.db.withClient(async (client) => {
      const { rows } = await client.query<{
        id: string; status: string; target_group: string; target_key: string; target_value: string;
      }>(
        `SELECT id, status, target_group, target_key, target_value
           FROM update_suggestions WHERE id = $1 AND project_id = $2`,
        [suggestionId, projectId],
      );
      if (rows.length === 0) throw new NotFoundException("建议不存在");
      return rows[0];
    });
    if (sug.status !== "pending") throw new NotFoundException("该建议已处理");
    if (sug.target_group !== "style" && sug.target_group !== "constraint") {
      // 理论上被 CHECK 挡住，这里是纵深防御
      throw new NotFoundException("非法的目标分组，拒绝写入");
    }

    // 写入 Brief：候选 → 确认（用户已接受，即背书）
    const field = await this.briefs.upsertField(userId, projectId, {
      group: sug.target_group,
      key: sug.target_key,
      value: sug.target_value,
      source: "user",
      confidence: 0.9,
    });
    await this.briefs.confirm(userId, projectId, field.id);

    await this.db.withClient(async (client) => {
      await client.query(
        `UPDATE update_suggestions SET status = 'accepted', decided_at = NOW() WHERE id = $1`,
        [suggestionId],
      );
    });
    return { accepted: true, fieldId: field.id, group: sug.target_group, key: sug.target_key };
  }

  async rejectSuggestion(userId: string, projectId: string, suggestionId: string) {
    await this.assertOwner(userId, projectId);
    await this.db.withClient(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE update_suggestions SET status = 'rejected', decided_at = NOW()
          WHERE id = $1 AND project_id = $2 AND status = 'pending'`,
        [suggestionId, projectId],
      );
      if (rowCount === 0) throw new NotFoundException("建议不存在或已处理");
    });
    return { rejected: true };
  }
}
