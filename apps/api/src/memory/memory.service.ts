/**
 * MemoryService — feat-300.4
 *
 * agent_memory 表 CRUD + Distiller 共用的 upsert 入口。
 *
 * 设计要点：
 *   - 鉴权：所有读写都通过 projects.owner_id JOIN 校验，复用既有 owner 链路风格
 *   - source='manual' 与 'distilled' 共用同表，前端 MemoryPanel 列表时可按 source 标记来源
 *   - 不在本服务做"低 confidence 自动清理"——MVP 阶段保留全部，用户在 UI 上手动删
 *   - upsertDistilled 是给 Distiller 写一批候选的入口：按 (project_id, kind, content) 唯一性
 *     做内存级判重（同内容已存在则更新 confidence + source_feedback_ids 合并 + last_distilled_at）
 *     这避免了多次蒸馏产生重复条目。
 *
 * 为什么不引入唯一索引 (project_id, kind, content)：
 *   content 可长且包含中文，作为索引列性价比低；项目级 memory 体量 < 50 条
 *   全量加载+内存判重足够，逻辑也更可读（边查边 merge）。
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Client as PgClient } from "pg";
import { DbService } from "../db/db.service";
import {
  MEMORY_KINDS,
  type CreateMemoryInput,
  type MemoryKind,
  type MemoryRow,
  type MemorySource,
  type UpdateMemoryInput,
} from "./memory.types";

interface DbMemoryRow {
  id: string;
  project_id: string;
  kind: string;
  content: string;
  source: string;
  source_feedback_ids: string[] | unknown;
  confidence: string; // pg NUMERIC → string
  created_at: Date;
  updated_at: Date;
  last_distilled_at: Date | null;
}

const COLS = `id, project_id, kind, content, source, source_feedback_ids,
              confidence, created_at, updated_at, last_distilled_at`;

function mapRow(row: DbMemoryRow): MemoryRow {
  // source_feedback_ids 来自 JSONB；pg driver 已自动 parse 为 array
  const sfi = Array.isArray(row.source_feedback_ids)
    ? (row.source_feedback_ids as string[])
    : [];
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as MemoryKind,
    content: row.content,
    source: row.source as MemorySource,
    sourceFeedbackIds: sfi,
    confidence: Number(row.confidence),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastDistilledAt: row.last_distilled_at ? row.last_distilled_at.toISOString() : null,
  };
}

/** 蒸馏候选 → upsert 入口的形状 */
export interface UpsertDistilledInput {
  kind: MemoryKind;
  content: string;
  /** 0~1 */
  confidence: number;
  sourceFeedbackIds: string[];
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

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

  /** 列表（按 confidence DESC, updated_at DESC），不分页（MVP 体量小） */
  async list(userId: string, projectId: string): Promise<MemoryRow[]> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbMemoryRow>(
        `SELECT ${COLS} FROM agent_memory
         WHERE project_id = $1
         ORDER BY confidence DESC, updated_at DESC`,
        [projectId],
      );
      return rows.map(mapRow);
    });
  }

  /** 手动添加：source='manual'，confidence 默认 0.8（用户手动加的可信度高） */
  async create(
    userId: string,
    projectId: string,
    input: CreateMemoryInput,
  ): Promise<MemoryRow> {
    await this.assertOwner(userId, projectId);
    if (!MEMORY_KINDS.includes(input.kind)) {
      throw new BadRequestException(`kind 非法，必须是 ${MEMORY_KINDS.join("/")}`);
    }
    if (!input.content?.trim()) throw new BadRequestException("content 不能为空");
    const confidence = input.confidence ?? 0.8;
    if (confidence < 0 || confidence > 1) {
      throw new BadRequestException("confidence 必须在 0~1 之间");
    }

    return this.db.withClient(async (client) => {
      const id = randomUUID();
      const { rows } = await client.query<DbMemoryRow>(
        `INSERT INTO agent_memory
           (id, project_id, kind, content, source, source_feedback_ids, confidence)
         VALUES ($1, $2, $3, $4, 'manual', '[]'::jsonb, $5)
         RETURNING ${COLS}`,
        [id, projectId, input.kind, input.content.trim(), confidence],
      );
      return mapRow(rows[0]);
    });
  }

  async update(
    userId: string,
    projectId: string,
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<MemoryRow> {
    await this.assertOwner(userId, projectId);
    const sets: string[] = [];
    const vals: unknown[] = [];
    let p = 1;
    if (input.kind !== undefined) {
      if (!MEMORY_KINDS.includes(input.kind)) {
        throw new BadRequestException(`kind 非法`);
      }
      sets.push(`kind = $${p++}`);
      vals.push(input.kind);
    }
    if (input.content !== undefined) {
      if (!input.content.trim()) throw new BadRequestException("content 不能为空");
      sets.push(`content = $${p++}`);
      vals.push(input.content.trim());
    }
    if (input.confidence !== undefined) {
      if (input.confidence < 0 || input.confidence > 1) {
        throw new BadRequestException("confidence 必须在 0~1 之间");
      }
      sets.push(`confidence = $${p++}`);
      vals.push(input.confidence);
    }
    if (sets.length === 0) throw new BadRequestException("至少提供一个字段");
    sets.push("updated_at = NOW()");
    vals.push(memoryId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbMemoryRow>(
        `UPDATE agent_memory SET ${sets.join(", ")}
         WHERE id = $${p++} AND project_id = $${p++}
         RETURNING ${COLS}`,
        vals,
      );
      if (rows.length === 0) throw new NotFoundException("memory 不存在");
      return mapRow(rows[0]);
    });
  }

  async delete(userId: string, projectId: string, memoryId: string): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.db.withClient(async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM agent_memory WHERE id = $1 AND project_id = $2`,
        [memoryId, projectId],
      );
      if (rowCount === 0) throw new NotFoundException("memory 不存在");
    });
  }

  /**
   * Distiller 调：批量 upsert 蒸馏候选到 agent_memory。
   *
   * 判重规则：同 (project_id, kind, content) 内存级查重——
   *   命中 → confidence 取 max（避免被回退），source_feedback_ids 合并去重，last_distilled_at 更新
   *   未命中 → 新建一行 source='distilled'
   *
   * 走外部传入的 client：Distiller 已经持有一个 client 跑 LLM + DB 互动，
   * 避免重复借连接。
   */
  async upsertDistilled(
    client: PgClient,
    projectId: string,
    candidates: UpsertDistilledInput[],
  ): Promise<{ inserted: number; merged: number }> {
    if (candidates.length === 0) return { inserted: 0, merged: 0 };

    const { rows: existing } = await client.query<DbMemoryRow>(
      `SELECT ${COLS} FROM agent_memory
       WHERE project_id = $1 AND source = 'distilled'`,
      [projectId],
    );

    let inserted = 0;
    let merged = 0;
    const now = new Date().toISOString();

    for (const c of candidates) {
      const match = existing.find(
        (e) => e.kind === c.kind && e.content.trim() === c.content.trim(),
      );
      if (match) {
        // 合并：source_feedback_ids 去重，confidence 取大
        const existingIds = Array.isArray(match.source_feedback_ids)
          ? (match.source_feedback_ids as string[])
          : [];
        const mergedIds = Array.from(new Set([...existingIds, ...c.sourceFeedbackIds]));
        const newConfidence = Math.max(Number(match.confidence), c.confidence);
        await client.query(
          `UPDATE agent_memory
           SET confidence = $1,
               source_feedback_ids = $2::jsonb,
               last_distilled_at = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [newConfidence, JSON.stringify(mergedIds), now, match.id],
        );
        merged++;
      } else {
        const id = randomUUID();
        await client.query(
          `INSERT INTO agent_memory
             (id, project_id, kind, content, source, source_feedback_ids, confidence, last_distilled_at)
           VALUES ($1, $2, $3, $4, 'distilled', $5::jsonb, $6, $7)`,
          [
            id,
            projectId,
            c.kind,
            c.content.trim(),
            JSON.stringify(c.sourceFeedbackIds),
            c.confidence,
            now,
          ],
        );
        inserted++;
      }
    }

    this.logger.log(
      `[memory] distill upsert project=${projectId} inserted=${inserted} merged=${merged}`,
    );
    return { inserted, merged };
  }
}
