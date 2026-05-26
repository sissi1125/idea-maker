import { z } from "zod";
import type { CitationOutput, EvidenceItem } from "./citation";

/**
 * Prompt Build - 共享类型定义
 *
 * 2 method：
 *   rag-template        标准 RAG 模板（grounding + honesty + 不编造）
 *   marketing-template  营销场景模板（受众 + 语气 + 结构化输出）
 *
 * 纯算法，无 I/O 注入。
 */

export const PromptBuildMethodId = z.enum(["rag-template", "marketing-template"]);
export type PromptBuildMethodId = z.infer<typeof PromptBuildMethodId>;

export const PromptBuildParamsSchema = z.object({
  maxContextTokens: z.number().int().min(100).optional().default(2000),
  includeSourceRefs: z.boolean().optional().default(true),
  systemPrompt: z.string().optional().default(""),
  targetAudience: z.string().optional().default(""),
  tone: z.string().optional().default("professional"),
  /** 当无上游 citation 时手动指定 query */
  query: z.string().optional().default(""),
});
export type PromptBuildParams = z.infer<typeof PromptBuildParamsSchema>;

export interface PromptBuildOutput {
  systemPrompt: string;
  userPrompt: string;
  /** systemPrompt + "\n\n" + userPrompt */
  fullPrompt: string;
  /** 粗略 token 估算 (chars/4) */
  tokenEstimate: number;
  originalQuery: string;
  warnings: string[];
  /** 透传 citation 的 evidencePack，供下游 generation → evaluation 使用 */
  evidencePack?: EvidenceItem[];
}

export interface PromptBuildTrace {
  methodId: PromptBuildMethodId;
  evidenceCount: number;
  tokenEstimate: number;
  contextLength: number;
}

export interface PromptBuildInput {
  methodId: PromptBuildMethodId;
  params: PromptBuildParams;
  upstream: CitationOutput;
}

export interface PromptBuildResult {
  output: PromptBuildOutput;
  trace: PromptBuildTrace;
  warnings: string[];
}
