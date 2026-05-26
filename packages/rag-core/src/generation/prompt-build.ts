/**
 * RAG Pipeline Stage - Prompt Build - 纯算法
 *
 * 2 method：
 *   rag-template        标准 RAG（grounding 三规则）
 *   marketing-template  营销场景（受众 / 语气 / 结构化）
 */

import type {
  EvidenceItem,
  PromptBuildInput,
  PromptBuildOutput,
  PromptBuildResult,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

// ─── rag-template ─────────────────────────────────────────────────────────────

/**
 * System prompt 的三个核心约束（Anthropic Groundedness）：
 *   1. 基于资料回答（grounding）
 *   2. 信息不足时明确说明（honesty）
 *   3. 不编造资料里没有的内容（hallucination prevention）
 */
function buildRAGTemplate(
  contextText: string,
  query: string,
  systemPromptOverride: string,
  maxContextTokens: number,
  includeSourceRefs: boolean,
  evidencePack?: EvidenceItem[],
): PromptBuildOutput {
  const warnings: string[] = [];

  const defaultSystem = `你是一个专业的产品助手，基于提供的产品资料回答用户问题。
规则：
1. 仅基于"参考资料"中的内容回答，不要引入资料中没有的信息
2. 若参考资料不足以回答，请明确说明"根据现有资料，无法完整回答此问题"
3. 回答应简洁、准确，必要时可直接引用资料原文`;

  const finalSystem = systemPromptOverride || defaultSystem;

  const contextTokens = Math.ceil(contextText.length / 4);
  let truncatedContext = contextText;
  if (contextTokens > maxContextTokens) {
    const maxChars = maxContextTokens * 4;
    truncatedContext = contextText.slice(0, maxChars) + "\n…（参考资料已截断）";
    warnings.push(
      `参考资料超出 maxContextTokens (${maxContextTokens})，已截断至约 ${maxContextTokens} tokens`,
    );
  }

  const refNote = includeSourceRefs ? "\n（回答时请在适当位置标注 [evidence-NNN] 引用编号）" : "";

  const userPrompt = `参考资料：
${truncatedContext}

用户问题：${query}${refNote}`;

  const fullPrompt = `${finalSystem}\n\n${userPrompt}`;
  const tokenEstimate = Math.ceil(fullPrompt.length / 4);

  return {
    systemPrompt: finalSystem,
    userPrompt,
    fullPrompt,
    tokenEstimate,
    originalQuery: query,
    warnings,
    evidencePack,
  };
}

// ─── marketing-template ───────────────────────────────────────────────────────

function buildMarketingTemplate(
  contextText: string,
  query: string,
  targetAudience: string,
  tone: string,
  maxContextTokens: number,
  evidencePack?: EvidenceItem[],
): PromptBuildOutput {
  const warnings: string[] = [];

  const audienceNote = targetAudience ? `目标受众：${targetAudience}` : "";
  const toneNote = tone ? `输出语气：${tone}` : "";

  const systemPrompt = `你是一个专业的产品营销策略师，擅长基于产品资料生成营销内容。
${audienceNote}
${toneNote}
规则：
1. 所有营销主张必须基于提供的产品资料（evidence first 原则）
2. 生成卖点或内容 idea 时，标注对应的 [evidence-NNN] 引用
3. 若某个营销角度缺乏资料支撑，明确标注"低置信度 / 需补充资料"`.trim();

  const contextTokens = Math.ceil(contextText.length / 4);
  let truncatedContext = contextText;
  if (contextTokens > maxContextTokens) {
    truncatedContext = contextText.slice(0, maxContextTokens * 4) + "\n…（资料已截断）";
    warnings.push(`参考资料超出 maxContextTokens，已截断`);
  }

  const userPrompt = `产品资料：
${truncatedContext}

任务：${query}

请基于以上资料，输出结构化营销内容（可包含：核心卖点、使用场景、差异化优势、内容角度建议）。每个要点标注 evidence 来源。`;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  const tokenEstimate = Math.ceil(fullPrompt.length / 4);

  return {
    systemPrompt,
    userPrompt,
    fullPrompt,
    tokenEstimate,
    originalQuery: query,
    warnings,
    evidencePack,
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export function runPromptBuild(input: PromptBuildInput): PromptBuildResult {
  const { methodId, params, upstream } = input;

  const contextText = upstream.contextText ?? "";
  // 上游 citation.originalQuery 优先于 params.query；空字符串也回退到 params.query
  const query = (upstream.originalQuery?.trim() || params.query).trim();
  if (!query) {
    throw new PipelineError(
      "empty_query",
      "query 为空：请确保 retrieval → citation 链完整运行，或在 params.query 中填写",
    );
  }

  let output: PromptBuildOutput;

  switch (methodId) {
    case "marketing-template":
      output = buildMarketingTemplate(
        contextText,
        query,
        params.targetAudience,
        params.tone,
        params.maxContextTokens,
        upstream.evidencePack,
      );
      break;
    case "rag-template":
    default:
      output = buildRAGTemplate(
        contextText,
        query,
        params.systemPrompt,
        params.maxContextTokens,
        params.includeSourceRefs,
        upstream.evidencePack,
      );
      break;
  }

  return {
    output,
    trace: {
      methodId,
      evidenceCount: upstream.totalEvidence,
      tokenEstimate: output.tokenEstimate,
      contextLength: contextText.length,
    },
    warnings: output.warnings,
  };
}
