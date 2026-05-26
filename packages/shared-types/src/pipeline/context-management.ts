import { z } from "zod";
import type { LLMChatClient } from "./query-rewrite";

/**
 * Context Management - 多轮对话指代消解
 *
 * 2 method：
 *   session-history    规则替换代词（it/这/它/该/此 → 上轮 user 最后名词）
 *   llm-disambiguate   LLM 改写最新消息为独立完整查询
 */

export const ContextManagementMethodId = z.enum(["session-history", "llm-disambiguate"]);
export type ContextManagementMethodId = z.infer<typeof ContextManagementMethodId>;

export const ConversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export const ContextManagementParamsSchema = z.object({
  currentMessage: z.string().min(1),
  history: z.array(ConversationTurnSchema).optional().default([]),
  model: z.string().optional().default("gpt-4o-mini"),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});
export type ContextManagementParams = z.infer<typeof ContextManagementParamsSchema>;

export interface ContextManagementOutput {
  originalMessage: string;
  /** 消解后的完整查询，下游 intent-recognition / query-rewrite 用 */
  query: string;
  wasDisambiguated: boolean;
  sessionHistory: ConversationTurn[];
  warnings: string[];
}

export interface ContextManagementTrace {
  methodId: ContextManagementMethodId;
  wasDisambiguated: boolean;
  historyTurns: number;
}

export interface ContextManagementInput {
  methodId: ContextManagementMethodId;
  params: ContextManagementParams;
  /** llm-disambiguate 时必传 */
  llmClient?: LLMChatClient;
}

export interface ContextManagementResult {
  output: ContextManagementOutput;
  trace: ContextManagementTrace;
  warnings: string[];
}
