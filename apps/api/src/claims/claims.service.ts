/**
 * ClaimsService — feat-400.2
 *
 * Claim Map 的 CRUD + 派生 + 审批。核心门禁：
 *   - 从"已确认"的 Brief 字段派生候选 Claim（未确认的事实不能进 Claim Map）。
 *   - 批准事实型 Claim（functional/outcome）时必须有 evidence，否则 400 —— 落实
 *     "事实型主张必须有 evidence"。
 *   - 只有 approved 的 Claim 才能被下游内容引用（门禁在 content-evaluation 侧校验）。
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Client as PgClient } from "pg";
import { DbService } from "../db/db.service";
import {
  EVIDENCE_REQUIRED_CLAIM_TYPES,
  GROUP_TO_CLAIM_TYPE,
  type ClaimRow,
  type ClaimType,
  type RiskLevel,
} from "./claims.types";

const COLS = `id, project_id, brief_id, text, claim_type, target_audience_ids, scenario_ids,
  evidence_chunk_ids, source_field_id, origin, risk_level, status, created_at, updated_at`;

export interface CreateClaimInput {
  text: string;
  claimType: ClaimType;
  evidenceChunkIds?: string[];
  riskLevel?: RiskLevel;
  targetAudienceIds?: string[];
  scenarioIds?: string[];
}

function toArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(private readonly db: DbService) {}

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  private map(row: ClaimRow): ClaimRow {
    return {
      ...row,
      target_audience_ids: toArr(row.target_audience_ids),
      scenario_ids: toArr(row.scenario_ids),
      evidence_chunk_ids: toArr(row.evidence_chunk_ids),
    };
  }

  private async getBriefId(client: PgClient, projectId: string): Promise<string | null> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM product_briefs WHERE project_id = $1`,
      [projectId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Claim 上保存的是两类可检索 evidence 的 id：上传文档 rag_chunks 或官网 source_content_chunks。
   * 只检查数组非空会让伪造、跨项目或已删除的 id 混入事实主张，因此在创建和批准时都校验归属。
   */
  private async assertEvidenceChunksExist(client: PgClient, projectId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const uniqueIds = [...new Set(ids)];
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM rag_chunks WHERE project_id = $1 AND id = ANY($2::text[])
       UNION
       SELECT id FROM source_content_chunks WHERE project_id = $1 AND id = ANY($2::text[])`,
      [projectId, uniqueIds],
    );
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException("evidence chunk 不存在、已删除或不属于当前项目");
    }
  }

  /**
   * 从"已确认"的 Brief 事实字段派生候选 Claim。
   * 幂等：按 source_field_id 去重（同一字段不重复派生）。只处理事实型分组。
   */
  async deriveFromBrief(client: PgClient, projectId: string): Promise<{ derived: number }> {
    const briefId = await this.getBriefId(client, projectId);
    if (!briefId) return { derived: 0 };

    const { rows: fields } = await client.query<{
      id: string; field_group: string; field_key: string; value: unknown; evidence_chunk_ids: unknown;
    }>(
      `SELECT id, field_group, field_key, value, evidence_chunk_ids
         FROM product_brief_fields
        WHERE brief_id = $1 AND status = 'confirmed'
          AND field_group IN ('fact', 'positioning', 'audience', 'identity')`,
      [briefId],
    );

    // 这些身份/元数据字段不是"卖点/营销方向"，不派生成 Claim（产品名、类别、官网等）
    const NON_CLAIM_KEYS = new Set(["name", "category", "website", "url"]);

    let derived = 0;
    for (const f of fields) {
      if (f.field_group === "identity" && NON_CLAIM_KEYS.has(f.field_key)) continue;

      // 已派生过则跳过
      const { rows: exist } = await client.query(
        `SELECT 1 FROM claims WHERE project_id = $1 AND source_field_id = $2`,
        [projectId, f.id],
      );
      if (exist.length > 0) continue;

      const text = this.fieldToText(f.field_key, f.value);
      if (!text) continue;
      const claimType = GROUP_TO_CLAIM_TYPE[f.field_group] ?? "functional";
      await client.query(
        `INSERT INTO claims
           (id, project_id, brief_id, text, claim_type, evidence_chunk_ids, source_field_id, origin, status)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'platform','candidate')`,
        [randomUUID(), projectId, briefId, text, claimType,
         JSON.stringify(toArr(f.evidence_chunk_ids)), f.id],
      );
      derived++;
    }
    return { derived };
  }

  private fieldToText(key: string, value: unknown): string {
    const v = Array.isArray(value) ? value.join("、") : String(value ?? "").trim();
    if (!v) return "";
    return `${key}：${v}`;
  }

  async list(userId: string, projectId: string): Promise<ClaimRow[]> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<ClaimRow>(
      `SELECT ${COLS} FROM claims WHERE project_id = $1
        ORDER BY status ASC, CASE origin WHEN 'user' THEN 0 ELSE 1 END, created_at DESC`,
        [projectId],
      );
      return rows.map((r) => this.map(r));
    });
  }

  /** Agent Grounding 使用同一 pgClient 读取 approved Claims，避免另开连接和重复鉴权查询。 */
  async listApprovedWithClient(client: PgClient, projectId: string): Promise<ClaimRow[]> {
    const { rows } = await client.query<ClaimRow>(
      `SELECT ${COLS} FROM claims
        WHERE project_id = $1 AND status = 'approved'
        ORDER BY CASE origin WHEN 'user' THEN 0 ELSE 1 END, created_at DESC`,
      [projectId],
    );
    return rows.map((row) => this.map(row));
  }

  async derive(userId: string, projectId: string): Promise<{ derived: number }> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient((client) => this.deriveFromBrief(client, projectId));
  }

  async create(userId: string, projectId: string, input: CreateClaimInput): Promise<ClaimRow> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const briefId = await this.getBriefId(client, projectId);
      if (!briefId) throw new BadRequestException("项目还没有 Product Brief");
      await this.assertEvidenceChunksExist(client, projectId, input.evidenceChunkIds ?? []);
      const id = randomUUID();
      const { rows } = await client.query<ClaimRow>(
        `INSERT INTO claims
           (id, project_id, brief_id, text, claim_type, evidence_chunk_ids, risk_level,
            target_audience_ids, scenario_ids, origin, status)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,'user','candidate')
         RETURNING ${COLS}`,
        [id, projectId, briefId, input.text.trim(), input.claimType,
         JSON.stringify(input.evidenceChunkIds ?? []), input.riskLevel ?? "low",
         JSON.stringify(input.targetAudienceIds ?? []), JSON.stringify(input.scenarioIds ?? [])],
      );
      return this.map(rows[0]);
    });
  }

  /**
   * 批准一个 Claim —— 事实型（functional/outcome）无 evidence 则拒绝。
   * 这是"事实型主张必须有 evidence"的执行点。
   */
  async approve(userId: string, projectId: string, claimId: string): Promise<ClaimRow> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const claim = await this.getById(client, projectId, claimId);
      if (
        EVIDENCE_REQUIRED_CLAIM_TYPES.includes(claim.claim_type) &&
        toArr(claim.evidence_chunk_ids).length === 0
      ) {
        throw new BadRequestException("事实型主张（功能/效果）必须有 evidence 才能批准");
      }
      await this.assertEvidenceChunksExist(client, projectId, toArr(claim.evidence_chunk_ids));
      const { rows } = await client.query<ClaimRow>(
        `UPDATE claims SET status = 'approved', updated_at = NOW()
          WHERE id = $1 RETURNING ${COLS}`,
        [claimId],
      );
      return this.map(rows[0]);
    });
  }

  async block(userId: string, projectId: string, claimId: string): Promise<ClaimRow> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      await this.getById(client, projectId, claimId);
      const { rows } = await client.query<ClaimRow>(
        `UPDATE claims SET status = 'blocked', updated_at = NOW()
          WHERE id = $1 RETURNING ${COLS}`,
        [claimId],
      );
      return this.map(rows[0]);
    });
  }

  /** 用户编辑卖点只更新传播表达，原有 evidence 与来源关系保持不变。 */
  async update(
    userId: string,
    projectId: string,
    claimId: string,
    input: { text: string; claimType: ClaimType },
  ): Promise<ClaimRow> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      await this.getById(client, projectId, claimId);
      const text = input.text.trim();
      if (!text) throw new BadRequestException("卖点内容不能为空");
      const { rows } = await client.query<ClaimRow>(
        `UPDATE claims SET text = $3, claim_type = $4, origin = 'user', status = 'candidate', updated_at = NOW()
          WHERE id = $1 AND project_id = $2 RETURNING ${COLS}`,
        [claimId, projectId, text, input.claimType],
      );
      return this.map(rows[0]);
    });
  }

  /** 删除卖点；visual_assets.claim_id 的 ON DELETE SET NULL 保证资产仍可继续使用。 */
  async remove(userId: string, projectId: string, claimId: string): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.db.withClient(async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM claims WHERE id = $1 AND project_id = $2`,
        [claimId, projectId],
      );
      if (!rowCount) throw new NotFoundException("Claim 不存在");
    });
  }

  private async getById(client: PgClient, projectId: string, claimId: string): Promise<ClaimRow> {
    const { rows } = await client.query<ClaimRow>(
      `SELECT ${COLS} FROM claims WHERE id = $1 AND project_id = $2`,
      [claimId, projectId],
    );
    if (rows.length === 0) throw new NotFoundException("Claim 不存在");
    return this.map(rows[0]);
  }
}
