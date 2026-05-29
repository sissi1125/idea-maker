/**
 * Agent Tools 类型与上下文 — feat-300.2 Phase 3.5
 *
 * 每个 tool 是一个 factory：(ctx: AgentToolContext) => Tool。
 * 这样 AgentRunner（feat-300.3）在每次 run 启动时按"本次 run 的上下文"实例化
 * 一套绑定 projectId / runId / pgClient 的 tools，再交给 ai-sdk 的 generateText。
 *
 * 为什么不让 tool 直接读 NestJS 全局 service：
 *   1. tool execute 内拿不到当前 run 的 runId、当前用户的 userId、当前连接好的 pgClient
 *      —— 这些是"每次 run 才确定"的运行时数据，必须以参数传入。
 *   2. 把上下文显式化使得单测可以注入 mock，无需起 Nest 容器。
 *   3. 满足"tool 只是翻译官"原则：execute 函数除了 zod 入参就只能拿 ctx，写不出
 *      跨界逻辑（如读 process.env 或全局单例）。
 */

import type { Tool } from "ai";
import type { Client as PgClient } from "pg";
import type { LanguageModelV1 } from "ai";
import type { OpenAICompatibleClient } from "@harness/shared-types";

/**
 * 一次 Agent run 的上下文。AgentRunner 在创建 run 时填充并传给 tool 工厂。
 *
 * 字段分类：
 *   - 路由身份：projectId / userId / runId / generationId
 *   - 连接好的 I/O 客户端：pgClient / embeddingClient / llmModel
 *   - 注入的 NestJS 服务引用（在 AgentToolsService 内绑定）
 */
export interface AgentToolContext {
  projectId: string;
  userId: string;
  /** 本次 agent_runs.id；log_decision 等需要写 agent_steps 表 */
  runId: string;
  /** 关联的 generations.id（可选——agent 可独立于 generation 跑） */
  generationId?: string;

  /** 已 connect 的 pg 客户端；rag-core retrieval / citation 需要 */
  pgClient: PgClient;
  /** OpenAI 兼容 embedding 客户端；retrieval 走 embeddingProvider='openai' 时必传 */
  embeddingClient: OpenAICompatibleClient;
  /** 已构造的 LanguageModelV1（来自 LlmService.create）；generate/critic/refine 用 */
  llmModel: LanguageModelV1;
  /** 默认 LLM model 名（用于 rag-core runGeneration 的 legacy llmClient 适配） */
  llmDefaultModel: string;

  /** Optional 配置：让 AgentRunner 按项目设置覆盖默认值 */
  options?: {
    /** retrieval 默认 topK */
    retrievalTopK?: number;
    /** retrieval 默认 method id */
    retrievalMethod?:
      | "dense-vector"
      | "postgres-fulltext"
      | "hybrid-rrf"
      | "bm25-chinese"
      | "hybrid-bm25-rrf";
    /** embedding 模型名 */
    embeddingModel?: string;
    embeddingDimension?: number;
  };
}

/**
 * 8 个 tool 的名字常量，避免 magic string 散落各处。AgentRunner 配 toolChoice 时也用。
 */
export const AGENT_TOOL_NAMES = {
  searchKb: "search_kb",
  searchWeb: "search_web",
  searchNotes: "search_notes",
  searchHistory: "search_history",
  generateDraft: "generate_draft",
  criticReview: "critic_review",
  refineDraft: "refine_draft",
  logDecision: "log_decision",
} as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[keyof typeof AGENT_TOOL_NAMES];

/** 工厂签名：依赖（DI 注入的 service / client）由外层闭包绑定，仅暴露 ctx 入参 */
export type AgentToolFactory = (ctx: AgentToolContext) => Tool;
