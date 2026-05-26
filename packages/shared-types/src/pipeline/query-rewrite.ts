import { z } from "zod";

/**
 * Query Rewrite - 共享类型定义
 *
 * 3 method：
 *   none                    透传，rewrittenQueries = [query]
 *   rule-keyword-expansion  jieba 关键词提取 + 模板扩展（无 API 依赖）
 *   llm-marketing-rewrite   OpenAI 生成多查询变体（注入 LLMChatClient）
 *
 * 为什么需要：单 query 用词偏口语或太精确，会漏掉语义相近的 chunk。
 * 多路 query 取 union 检索（或 RRF 合并）可提升 Recall@K 15-30%。
 */

export const QueryRewriteMethodId = z.enum([
  "none",
  "rule-keyword-expansion",
  "llm-marketing-rewrite",
]);
export type QueryRewriteMethodId = z.infer<typeof QueryRewriteMethodId>;

export const QueryRewriteParamsSchema = z.object({
  query: z.string().min(1),
  maxQueries: z.number().int().min(1).max(10).optional().default(3),
  targetAudience: z.string().optional().default(""),
  rewriteGoal: z.string().optional().default(""),
  // llm-marketing-rewrite
  model: z.string().optional().default("gpt-4o-mini"),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});
export type QueryRewriteParams = z.infer<typeof QueryRewriteParamsSchema>;

/**
 * OpenAI-compatible chat client 的最小结构契约。
 *
 * 与 OpenAICompatibleClient（embeddings only）分开：
 *   - 让每个 stage 明确声明自己用什么 API
 *   - 真实 OpenAI SDK 实例同时满足两个接口（duck typing）
 *   - mock 时只造需要的方法即可
 */
export interface LLMChatClient {
  chat: {
    completions: {
      create(req: {
        model: string;
        temperature?: number;
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
        response_format?: { type: "json_object" };
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
        /** OpenAI 返回的 token usage，generation 等 stage 用于计费/trace */
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>;
    };
  };
}

export interface QueryRewriteOutput {
  originalQuery: string;
  /** 包含原 query 的扩展列表；下游 retrieval 对每个 query 并行检索 */
  rewrittenQueries: string[];
  method: QueryRewriteMethodId;
  warnings: string[];
}

export interface QueryRewriteTrace {
  methodId: QueryRewriteMethodId;
  originalQuery: string;
  queryCount: number;
  queries: string[];
}

export interface QueryRewriteInput {
  methodId: QueryRewriteMethodId;
  params: QueryRewriteParams;
  /** llm-marketing-rewrite 时必传 */
  llmClient?: LLMChatClient;
}

export interface QueryRewriteResult {
  output: QueryRewriteOutput;
  trace: QueryRewriteTrace;
  warnings: string[];
}
