import { z } from "zod";
import type { LLMChatClient } from "./query-rewrite";

/**
 * Intent Recognition - 共享类型定义
 *
 * 作用：把"随机闲聊"或"超范围问题"挡在 RAG 检索之前，节省成本 + 提升体验。
 *
 * 4 种意图：
 *   knowledge-qa        产品功能/定价/使用方式 → 走 RAG
 *   marketing-strategy  营销文案/内容策略     → 走 RAG + 生成
 *   chitchat            闲聊/问候              → 跳过检索
 *   out-of-scope        超出产品范围           → 跳过检索（可拒答）
 *
 * 2 种方法：
 *   rule-based  关键词正则匹配，零成本，意图边界清晰时够用
 *   llm-router  LLM 零样本分类，准确但需 100-200 tokens/次
 */

export const IntentValue = z.enum([
  "knowledge-qa",
  "marketing-strategy",
  "chitchat",
  "out-of-scope",
]);
export type Intent = z.infer<typeof IntentValue>;

export const IntentRecognitionMethodId = z.enum(["rule-based", "llm-router"]);
export type IntentRecognitionMethodId = z.infer<typeof IntentRecognitionMethodId>;

export const IntentRecognitionParamsSchema = z.object({
  /** 可选：路由层会回退到 upstreamOutput.query（来自 context-management） */
  query: z.string().optional().default(""),
  intents: z.array(z.string()).optional(),
  model: z.string().optional().default("gpt-4o-mini"),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});
export type IntentRecognitionParams = z.infer<typeof IntentRecognitionParamsSchema>;

export interface IntentRecognitionOutput {
  query: string;
  intent: Intent;
  confidence: number;
  routingDecision: "continue" | "skip-retrieval";
  routingReason: string;
  warnings: string[];
}

export interface IntentRecognitionTrace {
  methodId: IntentRecognitionMethodId;
  intent: Intent;
  confidence: number;
  routingDecision: "continue" | "skip-retrieval";
}

export interface IntentRecognitionInput {
  methodId: IntentRecognitionMethodId;
  params: IntentRecognitionParams;
  /** 上游 context-management.query（消歧后的完整查询）；为空则回退 params.query */
  upstreamQuery?: string;
  /** llm-router 时必传 */
  llmClient?: LLMChatClient;
}

export interface IntentRecognitionResult {
  output: IntentRecognitionOutput;
  trace: IntentRecognitionTrace;
  warnings: string[];
}
