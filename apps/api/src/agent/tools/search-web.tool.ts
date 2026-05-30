/**
 * search_web tool — feat-300.2 Phase 3.5
 *
 * 委托给 TavilyClient（feat-300.1 已建好，含 30 天 LRU + 缺 key 降级）。
 * 这一层是最薄的——TavilyClient 已经返回好结构化结果，tool 只做：
 *   1. zod 入参校验
 *   2. 描述"何时应该调"
 *   3. 把 TavilyClient 的 unavailable/error 状态原样透传给 LLM 让它自主 fallback
 *
 * 这是"委托"的纯净示例：tool 体仅 5-6 行业务代码。
 */

import { tool } from "ai";
import { z } from "zod";
import type { TavilyClient } from "../../llm/tavily.client";
import type { AgentToolContext, AgentToolFactory } from "./types";
import {
  SEARCH_WEB_MAX_RESULTS,
  SEARCH_WEB_CONTENT_CHARS,
  truncateText,
} from "./util/output-limits";

const ParamsSchema = z.object({
  query: z.string().min(1).describe("web 搜索的英文/中文 query"),
  maxResults: z.number().int().min(1).max(10).optional().describe("默认 5"),
  searchDepth: z
    .enum(["basic", "advanced"])
    .optional()
    .describe("basic=便宜快 / advanced=更长摘要；只在 query 复杂时用 advanced"),
});

const DESCRIPTION = `做实时 web 搜索（通过 Tavily）。

什么时候调用：
- 用户问"行业最新 / 实时数据 / 最近趋势"
- 知识库（search_kb）找不到的外部信息（竞品最新动态、新闻、政策）
- 需要权威外部来源做引用

什么时候不要调：
- 答案在用户的项目知识库里（应先 search_kb）
- 闲聊 / 常识 / 已经 search_web 过同一 query（用上次 observation）

返回：
- status=ok：results 数组（title/url/content 摘要）
- status=unavailable：Tavily 未配置 → 改用 search_kb 或直接回答
- status=error 且 retryable=true：临时故障 → 可以稍后重试或换工具
- status=error 且 retryable=false：参数/key 问题 → 不要重试`;

/**
 * 工厂闭包式注入 TavilyClient：tool factory 不能直接拿 NestJS 容器，
 * 由上层 AgentToolsService 在 build 时把 tavilyClient 绑进闭包。
 */
export function buildSearchWebTool(tavilyClient: TavilyClient): AgentToolFactory {
  return (_ctx: AgentToolContext) =>
    tool({
      description: DESCRIPTION,
      parameters: ParamsSchema,
      execute: async ({ query, maxResults, searchDepth }) => {
        // 调用方传入的 maxResults 与硬上限 SEARCH_WEB_MAX_RESULTS 取 min——
        // 即使 LLM 要 10 条，最多给 SEARCH_WEB_MAX_RESULTS 条。
        const effectiveMax = Math.min(
          maxResults ?? SEARCH_WEB_MAX_RESULTS,
          SEARCH_WEB_MAX_RESULTS,
        );
        const raw = await tavilyClient.search({
          query,
          maxResults: effectiveMax,
          searchDepth,
        });

        // 非 ok 状态原样透传——agent 需要看到 unavailable / error 才能自主 fallback
        if (raw.status !== "ok") return raw;

        // ok 状态：再截断 content 字段，保 LLM messages 不爆
        return {
          ...raw,
          results: raw.results.slice(0, effectiveMax).map((r) => ({
            ...r,
            content: truncateText(r.content, SEARCH_WEB_CONTENT_CHARS),
          })),
        };
      },
    });
}
