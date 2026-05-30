/**
 * search_history tool — feat-300.2 Phase 3.5
 *
 * 查项目历史 generations（包括自动生成 + 用户手动生成）。
 *
 * 与 search_notes 的区别（面试考点）：
 *   notes      = 用户筛选过的"精品库"，体量小，有 tags
 *   history    = 全量历史调用记录，体量大，含失败/低分的尝试
 *   定位不同：search_notes 找"好的范例"；search_history 找"过去尝试过 X 主题没"
 *
 * 当前实现：query / status / source / 时间窗的组合过滤。语义匹配走 result_notes ILIKE
 * 简单方案。embedding 检索看未来需要。
 */

import { tool } from "ai";
import { z } from "zod";
import type { Client as PgClient } from "pg";
import type { AgentToolContext, AgentToolFactory } from "./types";
import { spillIfLarge } from "./util/spill-if-large";
import type { SpillStorage } from "../spill-storage.service";

const ParamsSchema = z.object({
  query: z.string().min(1).describe("从 generations.query 或 result_notes 文本里匹配的关键词"),
  status: z
    .enum(["succeeded", "failed", "running"])
    .optional()
    .describe("过滤状态；默认只返 succeeded"),
  source: z
    .enum(["manual", "auto"])
    .optional()
    .describe("过滤来源；manual=用户主动 / auto=ingestion 触发"),
  limit: z.number().int().min(1).max(20).optional().describe("默认 5"),
});

const DESCRIPTION = `查项目的历史 generations 记录（含 query / 结果摘要 / 状态）。

什么时候调用：
- 用户问"我之前生成过类似主题吗" / "上次写XX的那次结果如何"
- 想避免重复生成（先查有无）
- 用历史结果做"风格延续"或"对比改进"

什么时候不要调：
- 找精选的好内容 → search_notes（notes 是用户主动筛选的）
- 找事实/知识 → search_kb

返回：matched generations 列表（含 query / 状态 / 结果前 300 字）。零结果说明
项目里还没有相关历史。`;

const SEARCH_SQL = `
SELECT id, query, status, source, result_notes, created_at
FROM generations
WHERE project_id = $1
  AND ($2::text IS NULL OR status = $2)
  AND ($3::text IS NULL OR source = $3)
  AND (
    query ILIKE '%' || $4 || '%'
    OR (result_notes IS NOT NULL AND result_notes ILIKE '%' || $4 || '%')
  )
ORDER BY created_at DESC
LIMIT $5
`;

interface HistoryRow {
  id: string;
  query: string;
  status: string;
  source: string;
  result_notes: string | null;
  created_at: Date;
}

export function buildSearchHistoryTool(spillStorage: SpillStorage): AgentToolFactory {
  return (ctx: AgentToolContext) =>
    tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ query, status, source, limit }) => {
      // 默认 succeeded：失败/running 状态对 agent 决策意义有限，主动筛掉
      const effectiveStatus = status ?? "succeeded";
      const effectiveLimit = limit ?? 5;

      const pg = ctx.pgClient as PgClient;
      const { rows } = await pg.query<HistoryRow>(SEARCH_SQL, [
        ctx.projectId,
        effectiveStatus,
        source ?? null,
        query,
        effectiveLimit,
      ]);

      if (rows.length === 0) {
        return {
          status: "empty" as const,
          query,
          message: "无匹配的历史 generation。可能是项目还没产生过相关主题的内容。",
        };
      }

      const okResult = {
        status: "ok" as const,
        query,
        generations: rows.map((r) => ({
          id: r.id,
          query: r.query,
          status: r.status,
          source: r.source,
          resultPreview: r.result_notes?.slice(0, 300) ?? null,
          createdAt: r.created_at.toISOString(),
        })),
      };
      return spillIfLarge(okResult, {
        kind: "search_history",
        preview: (r) =>
          r.generations.slice(0, 3).map((g) => `[${g.id}] ${g.query}`).join("\n"),
        summary: (r) => ({ generationCount: r.generations.length, query: r.query }),
        storage: spillStorage,
      });
    },
  });
}
