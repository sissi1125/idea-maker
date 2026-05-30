/**
 * search_kb tool — feat-300.2 Phase 3.5
 *
 * 在项目知识库（已 ingest 的 chunks）中做混合检索。委托 rag-core runRetrieval。
 *
 * 为什么 tool 内只做 retrieval，不做 rerank/citation：
 *   - rerank 依赖外部 reranker 服务 / LLM 关联性打分，未必每个项目都配
 *   - citation 是给 prompt-build 用的格式化层，agent 视角不需要
 *   - tool 返回 raw chunks 后，由 LLM 自己决定要不要拼 contextText（它非常擅长）
 *   - 保留单一职责：search_kb = "找相关 chunks"，不做更多
 *   - rerank 想要可以后续加 search_kb_rerank tool 单独委托 runRerank（YAGNI 先不做）
 *
 * description 写"何时应该调"不是"做什么"——LLM 把它当决策依据。
 */

import { tool } from "ai";
import { z } from "zod";
import { runRetrieval } from "@harness/rag-core";
import type { AgentToolContext, AgentToolFactory } from "./types";
import {
  SEARCH_KB_MAX_CHUNKS,
  SEARCH_KB_CHUNK_TEXT_CHARS,
  truncateText,
} from "./util/output-limits";
import { spillIfLarge } from "./util/spill-if-large";
import type { SpillStorage } from "../spill-storage.service";

const ParamsSchema = z.object({
  query: z.string().min(1).describe("检索 query。从用户问题里提炼关键词，不要照搬整句"),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("返回前 K 条，默认 5。复杂问题可调大但不超过 20"),
  category: z
    .enum(["product", "compete", "history"])
    .optional()
    .describe("按文档分类过滤；不填 = 全分类"),
});

const DESCRIPTION = `在项目知识库（已上传并解析的文档片段）中检索相关内容。

什么时候调用：
- 用户问题涉及"自家产品的具体功能 / 历史营销文案 / 竞品的具体策略"
- 需要有依据的事实，不是常识

什么时候不要调：
- 用户问"实时数据 / 最新趋势" → 用 search_web
- 在追问刚才已检索到的内容 → 直接用上次的 observation，不要重复检索
- 简单常识 / 闲聊 → 不需要任何检索

返回：相关 chunks（含原文 + 出处 + 相似度分数）。如果返回 status=empty，
说明知识库里没有相关内容，应该考虑换路径（search_web / search_notes）。`;

/**
 * 工厂签名变化：原来 `AgentToolFactory` 直接 export，现在改成
 * `(spillStorage) => AgentToolFactory`，闭包绑定 SpillStorage（与 search_web
 * 绑定 TavilyClient 同模式）。AgentToolsService.build() 负责注入。
 */
export function buildSearchKbTool(spillStorage: SpillStorage): AgentToolFactory {
  return (ctx: AgentToolContext) =>
    tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ query, topK, category }) => {
      // topK 三段优先级：参数 > ctx.options > 默认。再与 SEARCH_KB_MAX_CHUNKS 取 min
      // 作为返还给 LLM 的硬上限——即使调用方要 20，也只返 SEARCH_KB_MAX_CHUNKS 条。
      const requested = topK ?? ctx.options?.retrievalTopK ?? SEARCH_KB_MAX_CHUNKS;
      const effectiveTopK = Math.min(requested, SEARCH_KB_MAX_CHUNKS);
      const method = ctx.options?.retrievalMethod ?? "hybrid-bm25-rrf";
      const embeddingModel = ctx.options?.embeddingModel ?? "text-embedding-v4";
      const embeddingDimension = ctx.options?.embeddingDimension ?? 1024;

      const retrieval = await runRetrieval({
        methodId: method,
        params: {
          topK: effectiveTopK,
          threshold: 0.5,
          embeddingProvider: "openai",
          embeddingModel,
          embeddingDimension,
          k1: 1.5,
          b: 0.75,
        },
        queries: [query],
        pgClient: ctx.pgClient,
        // projectId 严格隔离，与 feat-200.8.x P0 保持一致
        projectId: ctx.projectId,
        openaiClient: ctx.embeddingClient,
      });

      const matches = retrieval.output.matches ?? [];
      if (matches.length === 0) {
        return {
          status: "empty" as const,
          query,
          message:
            "知识库中未检索到相关 chunks。建议改用 search_web 找外部资料，或换更宽泛的 query。",
        };
      }

      // category 后置过滤：rag-core retrieval 暂无 category 字段下推到 SQL，
      // 用 sourceRef 启发式。TODO(perf): feat-300.4 之后把 category 推到 SQL where。
      const filtered = category
        ? matches.filter((m) => (m.sourceRef ?? "").includes(category))
        : matches;

      const okResult = {
        status: "ok" as const,
        query,
        chunks: filtered.slice(0, effectiveTopK).map((m) => ({
          chunkId: m.chunkId,
          // 截断到 SEARCH_KB_CHUNK_TEXT_CHARS 字符，避免一次返回撑爆 LLM messages
          // 原文如果需要全文检视，agent_steps trace 里保存的是同一截断版（一致性）
          text: truncateText(m.text, SEARCH_KB_CHUNK_TEXT_CHARS),
          source: m.sourceRef,
          score: Number((m.score ?? 0).toFixed(4)),
        })),
      };

      // 通常 3×200 字 ≈ 600 字 + meta ≈ <2KB，不触发 spill；但 category 过滤前
      // 全量 matches 可能很多——保留 spillIfLarge 作为兜底，对边界场景免疫。
      return spillIfLarge(okResult, {
        kind: "search_kb",
        preview: (r) =>
          r.chunks
            .slice(0, 2)
            .map((c, i) => `[${i + 1}] (${c.source}) ${c.text.slice(0, 80)}`)
            .join("\n"),
        summary: (r) => ({ chunkCount: r.chunks.length, query: r.query }),
        storage: spillStorage,
      });
    },
  });
}
