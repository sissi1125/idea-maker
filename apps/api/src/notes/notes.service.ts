/**
 * NotesService — feat-200.7 Week 7
 *
 * 笔记库 CRUD。
 *
 * 设计选择：
 *   - owner 校验通过 projects.owner_id JOIN，避免越权；
 *   - generation_id 是可选外键，ON DELETE SET NULL（原 generation 被清掉后笔记不消失）；
 *   - 列表默认按 created_at DESC，cursor 分页和 generations 风格一致——
 *     但为了减少前端两套分页代码，MVP 直接走 limit+offset（笔记体量小，单项目 < 500 条够用），
 *     如需 cursor 后续迁移；
 *   - update 不传字段 → SQL set 该字段保持原值，不影响其他列。
 */

import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import type { CreateNoteInput, NoteRow, UpdateNoteInput } from "./notes.types";

interface DbNoteRow {
  id: string;
  project_id: string;
  generation_id: string | null;
  title: string;
  content: string;
  tags: string[];
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: DbNoteRow): NoteRow {
  return {
    id: row.id,
    projectId: row.project_id,
    generationId: row.generation_id,
    title: row.title,
    content: row.content,
    tags: row.tags ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLS = `id, project_id, generation_id, title, content, tags, created_at, updated_at`;

@Injectable()
export class NotesService {
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
    input: CreateNoteInput,
  ): Promise<NoteRow> {
    await this.assertOwner(userId, projectId);
    if (!input.title?.trim()) throw new BadRequestException("title 不能为空");
    if (!input.content?.trim()) throw new BadRequestException("content 不能为空");

    // generationId 校验：如有传值，验证它确实属于本项目（防越权或脏数据）
    if (input.generationId) {
      await this.db.withClient(async (client) => {
        const { rows } = await client.query(
          `SELECT 1 FROM generations WHERE id = $1 AND project_id = $2`,
          [input.generationId, projectId],
        );
        if (rows.length === 0) {
          throw new BadRequestException("generationId 不属于本项目");
        }
      });
    }

    const id = randomUUID();
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbNoteRow>(
        `INSERT INTO notes (id, project_id, generation_id, title, content, tags)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLS}`,
        [id, projectId, input.generationId ?? null, input.title.trim(),
         input.content, input.tags ?? []],
      );
      return mapRow(rows[0]);
    });
  }

  /** 按项目列出，最新优先；limit/offset 简单分页 */
  async list(
    userId: string,
    projectId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ notes: NoteRow[]; total: number }> {
    await this.assertOwner(userId, projectId);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbNoteRow>(
        `SELECT ${COLS} FROM notes
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [projectId, limit, offset],
      );
      const countRes = await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM notes WHERE project_id = $1`,
        [projectId],
      );
      return { notes: rows.map(mapRow), total: parseInt(countRes.rows[0].n, 10) };
    });
  }

  async getOne(
    userId: string,
    projectId: string,
    noteId: string,
  ): Promise<NoteRow> {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbNoteRow>(
        `SELECT ${COLS} FROM notes WHERE id = $1 AND project_id = $2`,
        [noteId, projectId],
      );
      if (rows.length === 0) throw new NotFoundException("笔记不存在");
      return mapRow(rows[0]);
    });
  }

  /** PATCH 语义：传字段才更新；不传字段保持原值 */
  async update(
    userId: string,
    projectId: string,
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<NoteRow> {
    await this.assertOwner(userId, projectId);
    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    if (input.title !== undefined) {
      if (!input.title.trim()) throw new BadRequestException("title 不能为空字符串");
      updates.push(`title = $${p++}`);
      values.push(input.title.trim());
    }
    if (input.content !== undefined) {
      if (!input.content.trim()) throw new BadRequestException("content 不能为空字符串");
      updates.push(`content = $${p++}`);
      values.push(input.content);
    }
    if (input.tags !== undefined) {
      updates.push(`tags = $${p++}`);
      values.push(input.tags);
    }
    if (updates.length === 0) {
      throw new BadRequestException("至少提供一个要更新的字段");
    }
    updates.push("updated_at = NOW()");
    values.push(noteId, projectId);

    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbNoteRow>(
        `UPDATE notes SET ${updates.join(", ")}
         WHERE id = $${p++} AND project_id = $${p++}
         RETURNING ${COLS}`,
        values,
      );
      if (rows.length === 0) throw new NotFoundException("笔记不存在");
      return mapRow(rows[0]);
    });
  }

  async delete(
    userId: string,
    projectId: string,
    noteId: string,
  ): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.db.withClient(async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM notes WHERE id = $1 AND project_id = $2`,
        [noteId, projectId],
      );
      if (rowCount === 0) throw new NotFoundException("笔记不存在");
    });
  }
}
