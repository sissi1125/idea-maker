/**
 * search_notes tool — feat-300.2 + feat-300.4 升级
 *
 * 在用户的"笔记库"（精选/保存过的 generation 结果）中找近似内容。
 *
 * 检索策略（feat-300.4 实装）：
 *   1) 优先委托 NotesService.searchByEmbedding（pgvector 余弦）
 *   2) embedding 不可用（API 挂了 / 库里全 NULL）→ fallback ILIKE
 *
 * 为什么保留 ILIKE fallback：笔记可能在 embedding 列上线前已存在（NULL）；
 * 此外 embedding 服务挂掉也不应阻塞 agent 调 search_notes —— 召回少总比报错好。
 */

import { tool } from "ai";
import { z } from "zod";
import type { Client as PgClient } from "pg";
import type { AgentToolContext, AgentToolFactory } from "./types";
import { spillIfLarge } from "./util/spill-if-large";
import type { SpillStorage } from "../spill-storage.service";
import type { NotesService } from "../../notes/notes.service";

const ParamsSchema = z.object({
  query: z.string().min(1).describe("检索关键词；建议用产品/主题名词"),
  tags: z
    .array(z.string())
    .max(5)
    .optional()
    .describe("按标签过滤（AND 语义：必须全部包含）"),
  limit: z.number().int().min(1).max(20).optional().describe("默认 5"),
});

const DESCRIPTION = `在项目的"笔记库"（用户精选过的过往优质内容）中查相似笔记。

什么时候调用：
- 用户说"我之前写过类似的" / "之前那篇..." → 找他保存过的精选内容
- 想参考自己沉淀的风格/句式时
- 生成新内容前看历史成功案例的措辞

什么时候不要调：
- 找事实/知识 → 用 search_kb 而不是 search_notes（notes 是用户主观精选，不一定全面）

返回：matched notes（title + content 前 300 字 + tags）。零结果说明该项目笔记库
里没有相关内容；可以考虑 search_kb 或 search_history。`;

const SEARCH_SQL = `
SELECT id, title, content, tags, created_at
FROM notes
WHERE project_id = $1
  AND (
    title ILIKE '%' || $2 || '%'
    OR content ILIKE '%' || $2 || '%'
    OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE '%' || $2 || '%')
  )
  AND ($3::text[] IS NULL OR tags @> $3::text[])
ORDER BY created_at DESC
LIMIT $4
`;

interface NoteSearchRow {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: Date;
}

export function buildSearchNotesTool(
  spillStorage: SpillStorage,
  notesService: NotesService,
): AgentToolFactory {
  return (ctx: AgentToolContext) =>
    tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ query, tags, limit }) => {
      const effectiveLimit = limit ?? 5;
      // tags 为空数组时传 null，避免 @> '{}'::text[] 永真匹配语义混淆
      const tagsParam = tags && tags.length > 0 ? tags : null;

      // ── 1) 优先 pgvector 余弦检索 ────────────────────────────────────
      const semantic = await notesService.searchByEmbedding(
        ctx.projectId,
        query,
        effectiveLimit,
        tagsParam,
      );

      if (semantic && semantic.length > 0) {
        const okResult = {
          status: "ok" as const,
          query,
          mode: "embedding" as const,
          notes: semantic.map((r) => ({
            id: r.id,
            title: r.title,
            contentPreview: r.content.slice(0, 300),
            tags: r.tags,
            createdAt: r.createdAt,
            // distance 越小越相似（cosine distance）；展示给 LLM 评估相关性
            distance: r.distance,
          })),
        };
        return spillIfLarge(okResult, {
          kind: "search_notes",
          preview: (r) =>
            r.notes.slice(0, 3).map((n) => `[${n.id}] ${n.title}`).join("\n"),
          summary: (r) => ({ noteCount: r.notes.length, query: r.query, mode: r.mode }),
          storage: spillStorage,
        });
      }

      // ── 2) Fallback：ILIKE 文本检索（embedding 不可用 / 命中为空） ──
      const pg = ctx.pgClient as PgClient;
      const { rows } = await pg.query<NoteSearchRow>(SEARCH_SQL, [
        ctx.projectId,
        query,
        tagsParam,
        effectiveLimit,
      ]);

      if (rows.length === 0) {
        return {
          status: "empty" as const,
          query,
          message: "笔记库中无匹配条目。建议改用 search_kb 或 search_history。",
        };
      }

      const okResult = {
        status: "ok" as const,
        query,
        mode: "ilike" as const,
        notes: rows.map((r) => ({
          id: r.id,
          title: r.title,
          // 截前 300 字，避免 tool 返回过长把 messages 撑爆
          contentPreview: r.content.slice(0, 300),
          tags: r.tags,
          createdAt: r.created_at.toISOString(),
        })),
      };
      return spillIfLarge(okResult, {
        kind: "search_notes",
        preview: (r) =>
          r.notes.slice(0, 3).map((n) => `[${n.id}] ${n.title}`).join("\n"),
        summary: (r) => ({ noteCount: r.notes.length, query: r.query }),
        storage: spillStorage,
      });
    },
  });
}
