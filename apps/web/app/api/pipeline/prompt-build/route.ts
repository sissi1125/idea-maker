/**
 * RAG Pipeline Stage — Prompt Build（Prompt 构造）
 *
 * 作用：将 Citation 阶段产出的 evidence pack 和用户 query 组装为
 *       可直接传给 LLM 的完整 prompt，是 RAG → Generation 的最后桥梁。
 *
 * Pipeline 位置：
 *   Citation → [Prompt Build] → Generation
 *
 * 输出格式：
 *   系统提示词（system prompt）+ 用户消息（user message）+ 完整提示词（fullPrompt）
 *   fullPrompt 是两者拼接，供不支持角色区分的 API 直接使用。
 *   tokenEstimate 用于预估是否超出模型上下文窗口。
 *
 * 两种方法：
 *
 *   rag-template        标准 RAG 模板：角色设定 + 引用限制 + evidence 注入 + 查询
 *                       核心约束："仅基于提供的参考资料回答，若信息不足请说明"
 *
 *   marketing-template  营销场景模板：追加受众定向 + 语气要求 + 内容框架建议
 *                       适合生成卖点地图、内容 idea 等营销输出
 */

import { NextRequest, NextResponse } from "next/server";
import type { CitationOutput, EvidenceItem } from "@harness/shared-types";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface PromptBuildOutput {
  /** LLM system role 内容 */
  systemPrompt: string;
  /** LLM user message 内容（含 evidence context + query） */
  userPrompt: string;
  /** systemPrompt + "\n\n" + userPrompt 的完整拼接 */
  fullPrompt: string;
  /** 粗略 token 估算（chars / 4） */
  tokenEstimate: number;
  originalQuery: string;
  warnings: string[];
  /** passthrough from CitationOutput，供 generation → evaluation 使用 */
  evidencePack?: EvidenceItem[];
}

// ─── rag-template ─────────────────────────────────────────────────────────────

/**
 * 标准 RAG prompt 构造。
 *
 * System prompt 的三个核心约束（来自 Anthropic "Groundedness" 建议）：
 * 1. 基于提供的资料回答（grounding）
 * 2. 信息不足时明确说明（honesty）
 * 3. 不要编造不在资料里的内容（hallucination prevention）
 */
function buildRAGTemplate(
  contextText: string,
  query: string,
  systemPrompt: string,
  maxContextTokens: number,
  includeSourceRefs: boolean,
  evidencePack?: EvidenceItem[]
): PromptBuildOutput {
  const warnings: string[] = [];

  const defaultSystem = `你是一个专业的产品助手，基于提供的产品资料回答用户问题。
规则：
1. 仅基于"参考资料"中的内容回答，不要引入资料中没有的信息
2. 若参考资料不足以回答，请明确说明"根据现有资料，无法完整回答此问题"
3. 回答应简洁、准确，必要时可直接引用资料原文`;

  const finalSystem = systemPrompt || defaultSystem;

  // 估算 context token 数并在超限时截断
  const contextTokens = Math.ceil(contextText.length / 4);
  let truncatedContext = contextText;
  if (contextTokens > maxContextTokens) {
    const maxChars = maxContextTokens * 4;
    truncatedContext = contextText.slice(0, maxChars) + "\n…（参考资料已截断）";
    warnings.push(`参考资料超出 maxContextTokens (${maxContextTokens})，已截断至约 ${maxContextTokens} tokens`);
  }

  const refNote = includeSourceRefs
    ? "\n（回答时请在适当位置标注 [evidence-NNN] 引用编号）"
    : "";

  const userPrompt = `参考资料：
${truncatedContext}

用户问题：${query}${refNote}`;

  const fullPrompt = `${finalSystem}\n\n${userPrompt}`;
  const tokenEstimate = Math.ceil(fullPrompt.length / 4);

  return { systemPrompt: finalSystem, userPrompt, fullPrompt, tokenEstimate, originalQuery: query, warnings, evidencePack };
}

// ─── marketing-template ───────────────────────────────────────────────────────

/**
 * 营销场景 prompt 构造。
 * 在标准 RAG 基础上追加：
 * - 目标受众定向（targetAudience）
 * - 输出语气（tone）
 * - 内容框架建议（让 LLM 输出结构化营销内容）
 */
function buildMarketingTemplate(
  contextText: string,
  query: string,
  targetAudience: string,
  tone: string,
  maxContextTokens: number,
  evidencePack?: EvidenceItem[]
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

  return { systemPrompt, userPrompt, fullPrompt, tokenEstimate, originalQuery: query, warnings, evidencePack };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown>; upstreamOutput: CitationOutput | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Citation 产物，请先运行 Citation Stage" } },
      { status: 400 }
    );
  }

  const contextText = upstreamOutput.contextText ?? "";
  const query = (upstreamOutput.originalQuery ?? String(params.query ?? "")).trim();
  const maxContextTokens = Number(params.maxContextTokens ?? 2000);

  if (!query) {
    return NextResponse.json(
      { error: { code: "empty_query", message: "query 为空：请确保 retrieval → citation 链完整运行，或在 params.query 中填写" } },
      { status: 400 }
    );
  }

  let result: PromptBuildOutput;

  switch (methodId) {
    case "rag-template":
      result = buildRAGTemplate(
        contextText, query,
        String(params.systemPrompt ?? ""),
        maxContextTokens,
        Boolean(params.includeSourceRefs ?? true),
        upstreamOutput.evidencePack  // 新增：透传 evidence pack 供 evaluation 使用
      );
      break;
    case "marketing-template":
      result = buildMarketingTemplate(
        contextText, query,
        String(params.targetAudience ?? ""),
        String(params.tone ?? "professional"),
        maxContextTokens,
        upstreamOutput.evidencePack  // 新增：透传 evidence pack 供 evaluation 使用
      );
      break;
    default:
      return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
  }

  return NextResponse.json({
    output: result,
    trace: {
      methodId,
      evidenceCount: upstreamOutput.totalEvidence,
      tokenEstimate: result.tokenEstimate,
      contextLength: contextText.length,
      durationMs: Date.now() - startMs,
    },
    durationMs: Date.now() - startMs,
    warnings: result.warnings,
  });
}
