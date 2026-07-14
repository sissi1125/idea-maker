/**
 * ProductBriefService — feat-400.1
 *
 * 职责：Product Brief 事实层的 CRUD + 状态机 + 缺失/矛盾检测。
 *
 * 设计要点（面试考点）：
 *   1. 事实门禁从"数据层"就开始：提取阶段只能写 candidate，永远不能自动 confirmed。
 *      只有用户显式 confirm/edit 才会 confirmed，且每次都写 revision 审计（谁、为什么、第几版）。
 *   2. 官网/文档同步不能覆盖已确认字段：upsertCandidate 命中 confirmed 字段时只标 stale，
 *      不改值——对应规格"一次同步只能标 stale 或生成候选更新"。
 *   3. detectIssues 是"确认整份 Brief"的前置门禁：缺关键字段 / 有未核实事实 → 不许确认。
 *
 * 测试友好：核心逻辑方法都接收 client（可注入 fake client 做纯逻辑单测），
 *   public 方法只负责 assertOwner + withClient 包一层。与 MemoryService 同款风格。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Client as PgClient } from "pg";
import { DbService } from "../db/db.service";
import {
  FACTUAL_FIELD_GROUPS,
  REQUIRED_FIELDS,
  type BriefFieldGroup,
  type BriefFieldRow,
  type BriefFieldSource,
  type BriefIssues,
  type ProductBriefRow,
} from "./product-brief.types";

/** 提取 / 手动新增一个候选字段的入参 */
export interface UpsertFieldInput {
  group: BriefFieldGroup;
  key: string;
  value: unknown;
  source?: BriefFieldSource;
  evidenceChunkIds?: string[];
  confidence?: number;
}

const FIELD_COLS = `id, brief_id, field_group, field_key, value, source,
  evidence_chunk_ids, confidence, status, version, created_at, updated_at`;

function toEvidenceArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

@Injectable()
export class ProductBriefService {
  private readonly logger = new Logger(ProductBriefService.name);

  constructor(private readonly db: DbService) {}

  /** 项目所属校验：项目必须属于 userId，否则 404（与既有 service 一致语义） */
  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  // ── 核心逻辑（接收 client，可单测） ─────────────────────────────

  /**
   * get-or-create 项目的 Brief 容器。一项目一份（表上 UNIQUE project_id）。
   * ON CONFLICT DO NOTHING + 回查，避免并发下两次 INSERT 抛唯一约束。
   */
  async ensureBrief(client: PgClient, projectId: string): Promise<ProductBriefRow> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO product_briefs (id, project_id)
       VALUES ($1, $2)
       ON CONFLICT (project_id) DO NOTHING`,
      [id, projectId],
    );
    const { rows } = await client.query(
      `SELECT id, project_id, version, status, created_at, updated_at
         FROM product_briefs WHERE project_id = $1`,
      [projectId],
    );
    return rows[0] as ProductBriefRow;
  }

  /** 读取一份 Brief 的全部字段（按分组、key 稳定排序，前端渲染顺序稳定） */
  async listFields(client: PgClient, briefId: string): Promise<BriefFieldRow[]> {
    const { rows } = await client.query(
      `SELECT ${FIELD_COLS} FROM product_brief_fields
        WHERE brief_id = $1
        ORDER BY field_group ASC, field_key ASC`,
      [briefId],
    );
    return (rows as BriefFieldRow[]).map((r) => ({
      ...r,
      evidence_chunk_ids: toEvidenceArray(r.evidence_chunk_ids),
      confidence: Number(r.confidence),
    }));
  }

  /**
   * 写入 / 更新一个候选字段。
   *
   * 幂等键 (brief_id, group, key)：同一字段重复提取只保留一行。
   * 关键规则：命中一个 status='confirmed' 的字段时，不覆盖它的值，
   *   而是把它标为 'stale'（待用户复核），保护"已确认事实"不被自动改写。
   *   命中 candidate/stale/rejected 则允许更新值。
   */
  async upsertCandidateField(
    client: PgClient,
    briefId: string,
    input: UpsertFieldInput,
  ): Promise<BriefFieldRow> {
    const existing = await this.findField(client, briefId, input.group, input.key);
    const source = input.source ?? "inferred";
    const evidence = JSON.stringify(input.evidenceChunkIds ?? []);
    const confidence = input.confidence ?? 0.5;

    if (existing && existing.status === "confirmed") {
      // 已确认字段：不覆盖值，只标 stale，等用户决定是否采纳新候选
      await client.query(
        `UPDATE product_brief_fields
            SET status = 'stale', updated_at = NOW()
          WHERE id = $1`,
        [existing.id],
      );
      return { ...existing, status: "stale" };
    }

    if (existing) {
      const { rows } = await client.query(
        `UPDATE product_brief_fields
            SET value = $2::jsonb, source = $3, evidence_chunk_ids = $4::jsonb,
                confidence = $5, status = 'candidate', updated_at = NOW()
          WHERE id = $1
        RETURNING ${FIELD_COLS}`,
        [existing.id, JSON.stringify(input.value ?? null), source, evidence, confidence],
      );
      return this.mapField(rows[0]);
    }

    const id = randomUUID();
    const { rows } = await client.query(
      `INSERT INTO product_brief_fields
         (id, brief_id, field_group, field_key, value, source, evidence_chunk_ids, confidence, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, 'candidate')
       RETURNING ${FIELD_COLS}`,
      [id, briefId, input.group, input.key, JSON.stringify(input.value ?? null), source, evidence, confidence],
    );
    return this.mapField(rows[0]);
  }

  /**
   * 用户确认一个字段：candidate/stale → confirmed。
   *
   * 注意：确认是"用户显式动作"，即使 fact 字段没有 evidence 也允许——
   *   规格明确"fact 有 evidence 或用户确认二者之一即可"。确认本身就是背书。
   * 每次确认写 revision（原因默认 'user confirmed'），版本号 +1。
   */
  async confirmField(
    client: PgClient,
    fieldId: string,
    userId: string,
  ): Promise<BriefFieldRow> {
    const field = await this.getFieldById(client, fieldId);
    const nextVersion = field.version + 1;
    const { rows } = await client.query(
      `UPDATE product_brief_fields
          SET status = 'confirmed', version = $2, updated_at = NOW()
        WHERE id = $1
      RETURNING ${FIELD_COLS}`,
      [fieldId, nextVersion],
    );
    await this.writeRevision(client, fieldId, nextVersion, field.value, "confirmed", "user confirmed", userId);
    return this.mapField(rows[0]);
  }

  /**
   * 用户编辑一个字段的值：写新值 + source='user' + status='confirmed'，版本 +1。
   *
   * 硬规则：编辑事实型字段（identity/fact/audience/positioning）必须给 reason，
   *   落实"改事实必须记录原因和新版本"。非事实型（style 等）reason 可选。
   */
  async editField(
    client: PgClient,
    fieldId: string,
    userId: string,
    input: { value: unknown; reason?: string },
  ): Promise<BriefFieldRow> {
    const field = await this.getFieldById(client, fieldId);
    if (FACTUAL_FIELD_GROUPS.includes(field.field_group) && !input.reason?.trim()) {
      throw new NotFoundException("编辑事实型字段必须填写修改原因");
    }
    const nextVersion = field.version + 1;
    const { rows } = await client.query(
      `UPDATE product_brief_fields
          SET value = $2::jsonb, source = 'user', status = 'confirmed',
              version = $3, updated_at = NOW()
        WHERE id = $1
      RETURNING ${FIELD_COLS}`,
      [fieldId, JSON.stringify(input.value ?? null), nextVersion],
    );
    await this.writeRevision(
      client,
      fieldId,
      nextVersion,
      input.value,
      "confirmed",
      input.reason?.trim() ?? "user edited",
      userId,
    );
    return this.mapField(rows[0]);
  }

  /** 用户拒绝一个字段：→ rejected，写 revision */
  async rejectField(
    client: PgClient,
    fieldId: string,
    userId: string,
    reason?: string,
  ): Promise<BriefFieldRow> {
    const field = await this.getFieldById(client, fieldId);
    const nextVersion = field.version + 1;
    const { rows } = await client.query(
      `UPDATE product_brief_fields
          SET status = 'rejected', version = $2, updated_at = NOW()
        WHERE id = $1
      RETURNING ${FIELD_COLS}`,
      [fieldId, nextVersion],
    );
    await this.writeRevision(client, fieldId, nextVersion, field.value, "rejected", reason?.trim() ?? "user rejected", userId);
    return this.mapField(rows[0]);
  }

  /**
   * 检测一份 Brief 的问题（纯函数逻辑，供审核工作台顶部展示）：
   *   - missingRequired：关键字段没有 confirmed 值
   *   - unverifiedFacts：事实型字段里，来源是 inferred/historical_content 且无 evidence 的候选
   */
  detectIssues(fields: BriefFieldRow[]): BriefIssues {
    const confirmedKeys = new Set(
      fields
        .filter((f) => f.status === "confirmed")
        .map((f) => `${f.field_group}/${f.field_key}`),
    );
    const missingRequired = REQUIRED_FIELDS.filter(
      (r) => !confirmedKeys.has(`${r.group}/${r.key}`),
    );

    const unverifiedFacts = fields
      .filter(
        (f) =>
          f.status === "candidate" &&
          FACTUAL_FIELD_GROUPS.includes(f.field_group) &&
          (f.source === "inferred" || f.source === "historical_content") &&
          toEvidenceArray(f.evidence_chunk_ids).length === 0,
      )
      .map((f) => ({ id: f.id, group: f.field_group, key: f.field_key, source: f.source }));

    return { missingRequired, unverifiedFacts };
  }

  /**
   * 确认整份 Brief v(N)：前置门禁——不能有缺失关键字段，也不能有未核实事实。
   * 通过则 status='confirmed'、version +1（生成内容时只引用这一版的 confirmed 字段）。
   */
  async confirmBrief(client: PgClient, briefId: string): Promise<ProductBriefRow> {
    const fields = await this.listFields(client, briefId);
    const issues = this.detectIssues(fields);
    if (issues.missingRequired.length > 0 || issues.unverifiedFacts.length > 0) {
      throw new NotFoundException(
        `Brief 尚不完备：缺 ${issues.missingRequired.length} 个关键字段，${issues.unverifiedFacts.length} 个未核实事实`,
      );
    }
    const { rows } = await client.query(
      `UPDATE product_briefs
          SET status = 'confirmed', version = version + 1, updated_at = NOW()
        WHERE id = $1
      RETURNING id, project_id, version, status, created_at, updated_at`,
      [briefId],
    );
    return rows[0] as ProductBriefRow;
  }

  // ── private helpers ────────────────────────────────────────────

  private async findField(
    client: PgClient,
    briefId: string,
    group: BriefFieldGroup,
    key: string,
  ): Promise<BriefFieldRow | null> {
    const { rows } = await client.query(
      `SELECT ${FIELD_COLS} FROM product_brief_fields
        WHERE brief_id = $1 AND field_group = $2 AND field_key = $3`,
      [briefId, group, key],
    );
    return rows.length ? this.mapField(rows[0]) : null;
  }

  private async getFieldById(client: PgClient, fieldId: string): Promise<BriefFieldRow> {
    const { rows } = await client.query(
      `SELECT ${FIELD_COLS} FROM product_brief_fields WHERE id = $1`,
      [fieldId],
    );
    if (rows.length === 0) throw new NotFoundException("字段不存在");
    return this.mapField(rows[0]);
  }

  private async writeRevision(
    client: PgClient,
    fieldId: string,
    version: number,
    value: unknown,
    status: string,
    reason: string,
    userId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO product_brief_field_revisions
         (id, field_id, version, value, status, reason, changed_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [randomUUID(), fieldId, version, JSON.stringify(value ?? null), status, reason, userId],
    );
  }

  private mapField(row: BriefFieldRow): BriefFieldRow {
    return {
      ...row,
      evidence_chunk_ids: toEvidenceArray(row.evidence_chunk_ids),
      confidence: Number(row.confidence),
    };
  }

  // ── public 端点入口（assertOwner + withClient） ─────────────────

  /** 读取项目 Brief 全景：容器 + 字段 + 问题清单 */
  async getBrief(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const brief = await this.ensureBrief(client, projectId);
      const fields = await this.listFields(client, brief.id);
      return { brief, fields, issues: this.detectIssues(fields) };
    });
  }

  async upsertField(userId: string, projectId: string, input: UpsertFieldInput) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const brief = await this.ensureBrief(client, projectId);
      return this.upsertCandidateField(client, brief.id, input);
    });
  }

  async confirm(userId: string, projectId: string, fieldId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient((client) => this.confirmField(client, fieldId, userId));
  }

  async edit(userId: string, projectId: string, fieldId: string, input: { value: unknown; reason?: string }) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient((client) => this.editField(client, fieldId, userId, input));
  }

  async reject(userId: string, projectId: string, fieldId: string, reason?: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient((client) => this.rejectField(client, fieldId, userId, reason));
  }

  async confirmWholeBrief(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const brief = await this.ensureBrief(client, projectId);
      return this.confirmBrief(client, brief.id);
    });
  }
}
