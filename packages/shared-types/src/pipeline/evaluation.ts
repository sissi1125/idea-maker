import { z } from "zod";
import type { EvidenceItem } from "./citation";
import type { LLMChatClient } from "./query-rewrite";

/**
 * Evaluation - 共享类型定义
 *
 * 2 method：
 *   rag-metrics-only              纯算法（hitRate / citationCoverage / confidenceScore）
 *   rag-metrics-with-faithfulness 算法 + LLM Faithfulness judge（JSON mode）
 *
 * 指标定义：
 *   hitRate          = evidence[score >= scoreThreshold].count / totalEvidence
 *   citationCoverage = cited.count / totalEvidence
 *   confidenceScore  = mean(score of cited evidence)
 *   faithfulness     = LLM 评 0-1 分（rag-metrics-only 时为 null）
 *
 * 引用格式映射（normalizedCited）：
 *   [1] / [2] …          generation structured 简单编号
 *   [evidence-001] …     citation contextText 标注
 *   doc1_v1_c0 …         evidenceId 原始值（兜底）
 */

export const EvaluationMethodId = z.enum(["rag-metrics-only", "rag-metrics-with-faithfulness"]);
export type EvaluationMethodId = z.infer<typeof EvaluationMethodId>;

export const EvaluationParamsSchema = z.object({
  scoreThreshold: z.number().min(0).max(1).optional().default(0.5),
  model: z.string().optional().default(""),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});
export type EvaluationParams = z.infer<typeof EvaluationParamsSchema>;

/** Generation 各 method 输出的最小子集（evaluation 只需读这些字段） */
export interface EvaluationUpstream {
  citedEvidenceIds?: string[];
  evidencePack?: EvidenceItem[];
  originalQuery?: string;
  // marketing-ideas
  generatedContent?: string;
  // product-persona
  targetSegment?: string;
  painPoints?: string[];
  coreNeeds?: string[];
  summary?: string;
  // selling-points
  sellingPoints?: Array<{ title: string; description: string }>;
  differentiators?: string[];
  // content-ideas
  ideas?: Array<{ title: string; angle: string; format: string }>;
}

export interface FaithfulnessResult {
  score: number;
  unsupportedClaims: string[];
  reason: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EvaluationOutput {
  hitRate: number;
  citationCoverage: number;
  confidenceScore: number;
  totalEvidence: number;
  citedCount: number;
  scoreThreshold: number;
  /** rag-metrics-only 时为 null */
  faithfulness: FaithfulnessResult | null;
  level: "good" | "warning" | "poor";
  warnings: string[];
  method: EvaluationMethodId;
  durationMs: number;
}

export interface EvaluationTrace {
  methodId: EvaluationMethodId;
  totalEvidence: number;
  citedCount: number;
  hitRate: number;
  citationCoverage: number;
  confidenceScore: number;
  faithfulnessScore: number | null;
}

export interface EvaluationInput {
  methodId: EvaluationMethodId;
  params: EvaluationParams;
  upstream: EvaluationUpstream;
  /** rag-metrics-with-faithfulness 时必传；缺则降级到纯算法 + warning */
  llmClient?: LLMChatClient;
  /** 实际使用的模型（路由层从 createLLMClient.defaultModel 拿） */
  defaultModel?: string;
  /** 标记 upstream.evidencePack 是否实际缺失（与空数组区分） */
  evidencePackMissing?: boolean;
}

export interface EvaluationResult {
  output: EvaluationOutput;
  trace: EvaluationTrace;
  warnings: string[];
}
