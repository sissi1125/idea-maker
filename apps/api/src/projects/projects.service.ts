/**
 * ProjectsService — feat-200.1 Week 1
 *
 * CRUD：list / create / get / update / delete + getSettings / updateSettings
 *
 * 权限模型：
 *   - 所有方法都强制传 ownerId（即调用方的 user.id）
 *   - get / update / delete / settings 都按 (id, owner_id) 联合查询
 *   - 跨 owner 访问 → NotFoundException(404) 而不是 ForbiddenException(403)
 *     避免泄漏"项目是否存在"信息（与 login 不区分用户/密码错的思路一致）
 *
 * 字段 mapping：
 *   - DB snake_case → camelCase 在本 service 内完成
 *   - updated_at 由触发器更新更稳，但 MVP 直接 SQL 写 NOW() 简化
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import type { ProjectRow, ProjectSettingsRow } from "./projects.types";

interface DbProjectRow {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  docs_count: number;
  total_cost_usd: string; // pg numeric → string
  created_at: Date;
  updated_at: Date;
}

interface DbSettingsRow {
  project_id: string;
  provider: string | null;
  encrypted_api_key: string | null;
  model: string | null;
  temperature: string | null;
  max_tokens: number | null;
  thinking_depth: string | null;
  retrieval_mode: string | null;
  updated_at: Date;
}

function mapProject(row: DbProjectRow): ProjectRow {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    docsCount: row.docs_count,
    // pg 把 NUMERIC 默认返回 string（避免 IEEE 754 精度丢失），前端要 number 就在 service 转
    totalCostUsd: Number(row.total_cost_usd),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSettings(row: DbSettingsRow): ProjectSettingsRow {
  return {
    projectId: row.project_id,
    provider: row.provider,
    encryptedApiKey: row.encrypted_api_key,
    model: row.model,
    temperature: row.temperature === null ? null : Number(row.temperature),
    maxTokens: row.max_tokens,
    thinkingDepth: row.thinking_depth,
    retrievalMode: row.retrieval_mode,
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DbService) {}

  async list(ownerId: string): Promise<ProjectRow[]> {
    return this.db.withClient(async (client) => {
      const res = await client.query<DbProjectRow>(
        `SELECT id, name, emoji, description, docs_count, total_cost_usd, created_at, updated_at
         FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC`,
        [ownerId],
      );
      return res.rows.map(mapProject);
    });
  }

  async create(
    ownerId: string,
    input: { name: string; emoji?: string; description?: string },
  ): Promise<ProjectRow> {
    if (!input.name?.trim()) {
      throw new BadRequestException("项目名不能为空");
    }
    const id = randomUUID();
    return this.db.withClient(async (client) => {
      // 项目和 settings 行一起建（保证后续 settings 端点不需先 "create then update"）
      // 简化：不开 transaction（feat-200.1 MVP 不强一致；FK 失败可手工清理）
      const insertProject = await client.query<DbProjectRow>(
        `INSERT INTO projects (id, owner_id, name, emoji, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, emoji, description, docs_count, total_cost_usd, created_at, updated_at`,
        [id, ownerId, input.name.trim(), input.emoji ?? null, input.description ?? null],
      );
      await client.query(`INSERT INTO project_settings (project_id) VALUES ($1)`, [id]);
      return mapProject(insertProject.rows[0]);
    });
  }

  async get(ownerId: string, id: string): Promise<ProjectRow> {
    return this.db.withClient(async (client) => {
      const res = await client.query<DbProjectRow>(
        `SELECT id, name, emoji, description, docs_count, total_cost_usd, created_at, updated_at
         FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1`,
        [id, ownerId],
      );
      if (res.rows.length === 0) throw new NotFoundException("项目不存在");
      return mapProject(res.rows[0]);
    });
  }

  async update(
    ownerId: string,
    id: string,
    patch: { name?: string; emoji?: string | null; description?: string | null },
  ): Promise<ProjectRow> {
    // 动态拼 SET 子句：只更新传进来的字段
    const sets: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new BadRequestException("name 不能为空字符串");
      sets.push(`name = $${p++}`);
      values.push(patch.name.trim());
    }
    if (patch.emoji !== undefined) {
      sets.push(`emoji = $${p++}`);
      values.push(patch.emoji);
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${p++}`);
      values.push(patch.description);
    }
    if (sets.length === 0) {
      // 全空 patch → 直接走 get（保持幂等）
      return this.get(ownerId, id);
    }
    sets.push(`updated_at = NOW()`);
    values.push(id, ownerId);
    return this.db.withClient(async (client) => {
      const res = await client.query<DbProjectRow>(
        `UPDATE projects SET ${sets.join(", ")}
         WHERE id = $${p++} AND owner_id = $${p}
         RETURNING id, name, emoji, description, docs_count, total_cost_usd, created_at, updated_at`,
        values,
      );
      if (res.rows.length === 0) throw new NotFoundException("项目不存在");
      return mapProject(res.rows[0]);
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const res = await client.query(
        `DELETE FROM projects WHERE id = $1 AND owner_id = $2`,
        [id, ownerId],
      );
      // pg.QueryResult.rowCount 为 0 表示没删到（要么不存在，要么不是 owner）
      if (res.rowCount === 0) throw new NotFoundException("项目不存在");
    });
  }

  // ─── Settings 子资源 ─────────────────────────────────────────────────────

  async getSettings(ownerId: string, projectId: string): Promise<ProjectSettingsRow> {
    return this.db.withClient(async (client) => {
      // 用 JOIN 强制按 owner 过滤：避免另开一次 SELECT projects 校验
      const res = await client.query<DbSettingsRow>(
        `SELECT s.project_id, s.provider, s.encrypted_api_key, s.model,
                s.temperature, s.max_tokens, s.thinking_depth, s.retrieval_mode, s.updated_at
         FROM project_settings s
         INNER JOIN projects p ON p.id = s.project_id
         WHERE s.project_id = $1 AND p.owner_id = $2
         LIMIT 1`,
        [projectId, ownerId],
      );
      if (res.rows.length === 0) throw new NotFoundException("项目不存在");
      return mapSettings(res.rows[0]);
    });
  }

  async updateSettings(
    ownerId: string,
    projectId: string,
    patch: {
      provider?: string | null;
      encryptedApiKey?: string | null;
      model?: string | null;
      temperature?: number | null;
      maxTokens?: number | null;
      thinkingDepth?: string | null;
      retrievalMode?: string | null;
    },
  ): Promise<ProjectSettingsRow> {
    // 先用 SELECT 强制权限校验（settings 表本身没 owner_id 列）
    await this.get(ownerId, projectId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    const map: Array<[keyof typeof patch, string]> = [
      ["provider", "provider"],
      ["encryptedApiKey", "encrypted_api_key"],
      ["model", "model"],
      ["temperature", "temperature"],
      ["maxTokens", "max_tokens"],
      ["thinkingDepth", "thinking_depth"],
      ["retrievalMode", "retrieval_mode"],
    ];
    for (const [k, col] of map) {
      if (patch[k] !== undefined) {
        sets.push(`${col} = $${p++}`);
        values.push(patch[k]);
      }
    }
    if (sets.length === 0) return this.getSettings(ownerId, projectId);
    sets.push(`updated_at = NOW()`);
    values.push(projectId);

    return this.db.withClient(async (client) => {
      const res = await client.query<DbSettingsRow>(
        `UPDATE project_settings SET ${sets.join(", ")}
         WHERE project_id = $${p}
         RETURNING project_id, provider, encrypted_api_key, model,
                   temperature, max_tokens, thinking_depth, retrieval_mode, updated_at`,
        values,
      );
      if (res.rows.length === 0) throw new NotFoundException("项目不存在");
      return mapSettings(res.rows[0]);
    });
  }
}
