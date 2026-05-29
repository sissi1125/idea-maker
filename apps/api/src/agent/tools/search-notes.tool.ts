/**
 * search_notes tool — feat-300.2 Phase 3.5
 *
 * 在用户的"笔记库"（精选/保存过的 generation 结果）中找近似内容。
 *
 * 当前实现：text 检索（标题 ILIKE + 内容 ILIKE + tags 包含）。
 * 未来（feat-300.4）：notes 表加 embedding vector(1024) 列 → pgvector 余弦检索。
 * 接入点在 NotesService（届时该 tool 改委托 notesService.searchByEmbedding()）。
 *
 * 为什么 text 检索是合格的 MVP：笔记数量级远小于 rag_chunks（每个项目几十~上百条），
 * ILIKE 全表扫描成本可控；语义匹配上限可以接受到 feat-300.4 升级。
 */

import { tool } from "ai";
import { z } from "zod";
import type { Client as PgClient } from "pg";
import type { AgentToolContext, AgentToolFactory } from "./types";

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

export const buildSearchNotesTool: AgentToolFactory = (ctx: AgentToolContext) =>
  tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ query, tags, limit }) => {
      const effectiveLimit = limit ?? 5;
      // tags 为空数组时传 null，避免 @> '{}'::text[] 永真匹配语义混淆
      const tagsParam = tags && tags.length > 0 ? tags : null;

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

      return {
        status: "ok" as const,
        query,
        notes: rows.map((r) => ({
          id: r.id,
          title: r.title,
          // 截前 300 字，避免 tool 返回过长把 messages 撑爆
          contentPreview: r.content.slice(0, 300),
          tags: r.tags,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  });
