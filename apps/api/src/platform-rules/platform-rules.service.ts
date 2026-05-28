/**
 * PlatformRulesService — feat-200.8 Week 8
 *
 * 平台规则 CRUD + 内部"按 ID 加载已启用规则"接口（generate 流程会用）。
 *
 * 设计要点：
 *   - owner 校验通过 projects.owner_id JOIN，禁止跨项目访问别人的规则；
 *   - 删除走真删 (CASCADE 不需要软删——MVP 阶段简化)；
 *   - config 默认 {}（什么约束都没有，纯 styleHint 模式）；
 *   - listEnabledByIds 给 generate 流程用：批量按 id 拉规则 + 自动过滤 disabled，
 *     避免前端记下后用户禁用了还在用旧规则。
 */

import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import type {
  CreatePlatformRuleInput,
  PlatformRuleConfig,
  PlatformRuleRow,
  UpdatePlatformRuleInput,
} from "./platform-rules.types";

interface DbRow {
  id: string;
  project_id: string;
  name: string;
  config: PlatformRuleConfig | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLS = `id, project_id, name, config, enabled, created_at, updated_at`;

function mapRow(row: DbRow): PlatformRuleRow {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    config: row.config ?? {},
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class PlatformRulesService {
  constructor(private readonly db: DbService) {}

  /** owner 校验：项目必须属于当前用户 */
  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  async create(
    userId: string,
    projectId: string,
    input: CreatePlatformRuleInput,
  ): Promise<PlatformRuleRow> {
    await this.assertOwner(userId, projectId);
    if (!input.name?.trim()) throw new BadRequestException("name 不能为空");

    const id = randomUUID();
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbRow>(
        `INSERT INTO platform_rules (id, project_id, name, config, enabled)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLS}`,
        [
          id,
          projectId,
          input.name.trim(),
          input.config ?? {},
          input.enabled ?? true,
        ],
      );
      return mapRow(rows[0]);
    });
  }

  async list(userId: string, projectId: string): Promise<PlatformRuleRow[]> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbRow>(
        `SELECT ${COLS} FROM platform_rules
         WHERE project_id = $1
         ORDER BY created_at ASC`,
        [projectId],
      );
      return rows.map(mapRow);
    });
  }

  async getOne(
    userId: string,
    projectId: string,
    ruleId: string,
  ): Promise<PlatformRuleRow> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbRow>(
        `SELECT ${COLS} FROM platform_rules WHERE id = $1 AND project_id = $2`,
        [ruleId, projectId],
      );
      if (rows.length === 0) throw new NotFoundException("规则不存在");
      return mapRow(rows[0]);
    });
  }

  async update(
    userId: string,
    projectId: string,
    ruleId: string,
    input: UpdatePlatformRuleInput,
  ): Promise<PlatformRuleRow> {
    await this.assertOwner(userId, projectId);
    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new BadRequestException("name 不能为空字符串");
      updates.push(`name = $${p++}`);
      values.push(input.name.trim());
    }
    if (input.config !== undefined) {
      updates.push(`config = $${p++}`);
      values.push(input.config);
    }
    if (input.enabled !== undefined) {
      updates.push(`enabled = $${p++}`);
      values.push(input.enabled);
    }
    if (updates.length === 0) {
      throw new BadRequestException("至少提供一个要更新的字段");
    }
    updates.push("updated_at = NOW()");
    values.push(ruleId, projectId);

    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbRow>(
        `UPDATE platform_rules SET ${updates.join(", ")}
         WHERE id = $${p++} AND project_id = $${p++}
         RETURNING ${COLS}`,
        values,
      );
      if (rows.length === 0) throw new NotFoundException("规则不存在");
      return mapRow(rows[0]);
    });
  }

  async delete(
    userId: string,
    projectId: string,
    ruleId: string,
  ): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.db.withClient(async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM platform_rules WHERE id = $1 AND project_id = $2`,
        [ruleId, projectId],
      );
      if (rowCount === 0) throw new NotFoundException("规则不存在");
    });
  }

  /**
   * 内部用：generate 流程按 ID 批量拉规则。
   * 自动过滤 disabled——用户在 Settings 把规则关掉后，
   * 前端缓存里的 ruleId 不会再被注入 prompt / 跑校验。
   *
   * 不做 owner 校验（generate 流程已校验 projectId 归属）。
   */
  async listEnabledByIds(
    projectId: string,
    ruleIds: string[],
  ): Promise<PlatformRuleRow[]> {
    if (ruleIds.length === 0) return [];
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbRow>(
        `SELECT ${COLS} FROM platform_rules
         WHERE project_id = $1
           AND id = ANY($2::text[])
           AND enabled = TRUE`,
        [projectId, ruleIds],
      );
      return rows.map(mapRow);
    });
  }
}
