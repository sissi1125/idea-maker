import { z } from "zod";
import type { EvidenceItem } from "./citation";
import type { LLMChatClient } from "./query-rewrite";
import type { PromptBuildOutput } from "./prompt-build";

/**
 * Generation - 共享类型定义
 *
 * 4 method：
 *   marketing-ideas    自由格式 LLM 输出 + 提取 [evidence-NNN] 引用
 *   product-persona    JSON mode：targetSegment / painPoints / coreNeeds / summary
 *   selling-points     JSON mode：sellingPoints[] / differentiators / summary
 *   content-ideas      JSON mode：ideas[]（title/angle/format/evidenceIds）
 *
 * 所有 method 都注入 LLMChatClient。
 * Evidence-first 原则：生成内容必须含 [evidence-NNN] 引用，后端可反查溯源。
 */

export const GenerationMethodId = z.enum([
  "marketing-ideas",
  "product-persona",
  "selling-points",
  "content-ideas",
]);
export type GenerationMethodId = z.infer<typeof GenerationMethodId>;

export const GenerationParamsSchema = z.object({
  model: z.string().optional().default(""),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  /** marketing-ideas：要不要 warning 提示缺 evidence 引用 */
  includeEvidence: z.boolean().optional().default(true),
  /** content-ideas：生成几条 idea */
  ideaCount: z.number().int().min(1).max(20).optional().default(5),
  /** 所有 method：目标受众增强提示 */
  targetAudience: z.string().optional().default(""),
});
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;

// ─── 各 method 的结构化输出 ───────────────────────────────────────────────────

export interface GenerationMarketingIdeasOutput {
  generatedContent: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: EvidenceItem[];
}

export interface ProductPersonaOutput {
  targetSegment: string;
  painPoints: string[];
  coreNeeds: string[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: EvidenceItem[];
}

export interface SellingPoint {
  title: string;
  description: string;
  evidenceIds: string[];
}

export interface SellingPointsOutput {
  sellingPoints: SellingPoint[];
  differentiators: string[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: EvidenceItem[];
}

export interface ContentIdea {
  title: string;
  angle: string;
  format: string;
  evidenceIds: string[];
}

export interface ContentIdeasOutput {
  ideas: ContentIdea[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: EvidenceItem[];
}

export type GenerationOutput =
  | GenerationMarketingIdeasOutput
  | ProductPersonaOutput
  | SellingPointsOutput
  | ContentIdeasOutput;

export interface GenerationTrace {
  methodId: GenerationMethodId;
  model: string;
  originalQuery: string;
  inputTokens: number;
  outputTokens: number;
  citedCount: number;
}

export interface GenerationInput {
  methodId: GenerationMethodId;
  params: GenerationParams;
  upstream: PromptBuildOutput;
  /** 必传，所有 method 都调 LLM */
  llmClient: LLMChatClient;
  /** 注入实际使用的模型 ID（路由层从 createLLMClient 的 defaultModel 拿） */
  defaultModel: string;
}

export interface GenerationResult {
  output: GenerationOutput;
  trace: GenerationTrace;
  warnings: string[];
}
