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

import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { embedSingleText } from "@harness/rag-core";
import type OpenAI from "openai";
import { DbService } from "../db/db.service";
import { ProvidersService } from "../pipeline/providers.service";
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
  private readonly logger = new Logger(NotesService.name);

  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  /**
   * 算 note 的 embedding 向量（feat-300.4）。
   *
   * 失败兜底：返回 null 而非抛错——embedding 是检索时的优化，写入时如果
   * embedding 服务挂掉不应该阻塞用户保存笔记。NULL 的笔记 search_notes tool
   * 走 ILIKE fallback。
   *
   * 输入策略：title + "\n" + content 前 2KB 拼接。title 给重要权重（被截前），
   * content 截短避免 OpenAI token 上限。
   */
  private async computeEmbedding(title: string, content: string): Promise<number[] | null> {
    try {
      const cfg = this.providers.createEmbeddingClient();
      const text = `${title}\n${content.slice(0, 2000)}`;
      const vec = await embedSingleText(
        text,
        cfg.defaultModel,
        cfg.defaultDimension,
        cfg.client as unknown as OpenAI,
      );
      return vec;
    } catch (err) {
      this.logger.warn(
        `[notes] embedding 计算失败，落 NULL，search_notes 走 ILIKE fallback: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** pgvector 把 number[] 序列化成字符串字面量 '[1,2,3]' */
  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(",")}]`;
  }

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
    // 先算 embedding（外部 IO，放在 withClient 之外避免独占 DB 连接）
    const embedding = await this.computeEmbedding(input.title.trim(), input.content);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbNoteRow>(
        `INSERT INTO notes (id, project_id, generation_id, title, content, tags, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
         RETURNING ${COLS}`,
        [id, projectId, input.generationId ?? null, input.title.trim(),
         input.content, input.tags ?? [], embedding ? this.toVectorLiteral(embedding) : null],
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

    // feat-300.4：title / content 变更时同步刷新 embedding
    // tags 改了不重算（语义不变，省一次 embedding 调用）
    if (input.title !== undefined || input.content !== undefined) {
      // 拿到完整 title+content（缺的那个用 DB 现有值）
      const current = await this.db.withClient(async (client) => {
        const { rows } = await client.query<{ title: string; content: string }>(
          `SELECT title, content FROM notes WHERE id = $1 AND project_id = $2`,
          [noteId, projectId],
        );
        return rows[0];
      });
      if (current) {
        const newTitle = input.title !== undefined ? input.title.trim() : current.title;
        const newContent = input.content !== undefined ? input.content : current.content;
        const embedding = await this.computeEmbedding(newTitle, newContent);
        updates.push(`embedding = $${p++}::vector`);
        values.push(embedding ? this.toVectorLiteral(embedding) : null);
      }
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

  /**
   * pgvector 余弦检索（feat-300.4 升级 search_notes tool）。
   *
   * 行为：
   *   - 传 query 文本进来，本地算 embedding，按 1 - (embedding <=> q) 排序取 topK
   *   - 当某条 note.embedding 为 NULL（embedding 服务挂过）时跳过——这条只能 ILIKE 召回
   *   - 调用方拿到 ID 列表后再按需取 content（避免向量列大字段传输）
   *
   * 注意：embedding 服务挂掉时返回 null，调用方应 fallback 走 ILIKE。
   */
  async searchByEmbedding(
    projectId: string,
    query: string,
    limit: number,
    tags?: string[] | null,
  ): Promise<Array<NoteRow & { distance: number }> | null> {
    const vec = await this.computeEmbedding(query, "");
    if (!vec) return null;
    const tagsParam = tags && tags.length > 0 ? tags : null;
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<DbNoteRow & { distance: string }>(
        `SELECT ${COLS}, (embedding <=> $2::vector) AS distance
         FROM notes
         WHERE project_id = $1
           AND embedding IS NOT NULL
           AND ($3::text[] IS NULL OR tags @> $3::text[])
         ORDER BY embedding <=> $2::vector
         LIMIT $4`,
        [projectId, this.toVectorLiteral(vec), tagsParam, limit],
      );
      return rows.map((r) => ({ ...mapRow(r), distance: Number(r.distance) }));
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
