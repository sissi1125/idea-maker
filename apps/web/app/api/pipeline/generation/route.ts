/**
 * RAG Pipeline Stage — Generation（内容生成）
 *
 * 作用：接收 Prompt Build 阶段组装好的 systemPrompt + userPrompt，
 *       调用 LLM 生成营销内容（卖点地图、内容 idea 等），
 *       并从输出中提取 [evidence-NNN] 引用 ID 保留溯源链。
 *
 * Pipeline 位置：
 *   Prompt Build → [Generation] → （输出展示）
 *
 * Evidence-first 原则：
 *   生成内容中的每个营销主张都应携带 [evidence-NNN] 标注，
 *   后端提取这些 ID 存入 citedEvidenceIds，可反查到原始 chunk。
 */

import { NextRequest, NextResponse } from "next/server";
import { createLLMClient } from "@/lib/providers";
import type { PromptBuildOutput } from "@harness/shared-types";
import type { EvidenceItem } from "@harness/shared-types";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface GenerationOutput {
  /** LLM 原始输出文本 */
  generatedContent: string;
  /** 从 generatedContent 中提取的 evidence 引用 ID 列表（去重后） */
  citedEvidenceIds: string[];
  /** 实际使用的模型 */
  model: string;
  /** 输入 token 用量（由 LLM API 返回） */
  inputTokens: number;
  /** 输出 token 用量 */
  outputTokens: number;
  warnings: string[];
  /** 从上游 Citation Stage 传递的完整 evidence 列表，供下游溯源展示 */
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
  /** 从上游 Citation Stage 传递的完整 evidence 列表，供下游溯源展示 */
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
  /** 从上游 Citation Stage 传递的完整 evidence 列表，供下游溯源展示 */
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
  /** 从上游 Citation Stage 传递的完整 evidence 列表，供下游溯源展示 */
  evidencePack?: EvidenceItem[];
}

// ─── 工具：提取 evidence 引用 ─────────────────────────────────────────────────

/**
 * 从生成文本中提取所有 [evidence-NNN] 格式的引用 ID。
 * 格式由 citation stage 的 evidenceId 决定：{documentId}_v{version}_c{chunkIndex}
 * prompt-build 将其编号为 [1]、[2]… 或保留原始 evidenceId。
 * 这里同时匹配两种格式。
 */
function extractEvidenceIds(text: string): string[] {
  const seen = new Set<string>();
  // 匹配 [evidence-xxx] 格式
  const pattern1 = /\[evidence[-_][^\]]+\]/gi;
  // 匹配 [1]、[2] 等数字编号格式
  const pattern2 = /\[\d+\]/g;
  for (const match of text.matchAll(pattern1)) seen.add(match[0]);
  for (const match of text.matchAll(pattern2)) seen.add(match[0]);
  return [...seen];
}

// ─── product-persona ──────────────────────────────────────────────────────────

const PRODUCT_PERSONA_SYSTEM = `你是一个专业的产品营销策略师。
基于用户提供的产品资料，生成目标用户画像，输出严格 JSON，字段如下：
{
  "targetSegment": "目标人群描述（1-2句话）",
  "painPoints": ["痛点1", "痛点2", "痛点3"],
  "coreNeeds": ["需求1", "需求2", "需求3"],
  "summary": "markdown格式的整体画像摘要（3-5句）",
  "citedEvidenceIds": ["[1]", "[2]"]
}
规则：所有内容必须基于提供的资料；citedEvidenceIds 填写资料中引用的编号如 [1]、[2]；
若资料不足，painPoints/coreNeeds 可少于3条但不能为空；不要编造资料中没有的内容。`;

async function handleProductPersona(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  systemPrompt: string,
  userPrompt: string,
  params: Record<string, unknown>
): Promise<ProductPersonaOutput> {
  const warnings: string[] = [];
  const targetAudience = String(params.targetAudience || "").trim();
  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: PRODUCT_PERSONA_SYSTEM + (targetAudience ? `\n\n目标受众提示：${targetAudience}` : "") + "\n\n背景：" + systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<ProductPersonaOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    warnings.push(`LLM 输出无法解析为 JSON（${String(parseErr).slice(0, 80)}），请检查模型是否支持 JSON mode`);
    parsed = {};
  }

  return {
    targetSegment: parsed.targetSegment ?? (targetAudience || "未能生成"),
    painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
    coreNeeds: Array.isArray(parsed.coreNeeds) ? parsed.coreNeeds : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: Array.isArray(parsed.citedEvidenceIds) ? parsed.citedEvidenceIds : [],
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── selling-points ───────────────────────────────────────────────────────────

const SELLING_POINTS_SYSTEM = `你是一个专业的产品营销策略师。
基于用户提供的产品资料，提炼核心卖点和差异化优势，输出严格 JSON，字段如下：
{
  "sellingPoints": [
    { "title": "卖点标题（5-10字）", "description": "卖点说明（2-3句）", "evidenceIds": ["[1]"] }
  ],
  "differentiators": ["差异化优势1", "差异化优势2"],
  "summary": "markdown格式的卖点总结",
  "citedEvidenceIds": ["[1]", "[2]"]
}
规则：sellingPoints 3-5条；differentiators 2-3条；所有内容基于资料，引用编号如 [1]、[2]；
不要编造资料中没有的内容。`;

async function handleSellingPoints(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  systemPrompt: string,
  userPrompt: string,
  params: Record<string, unknown>
): Promise<SellingPointsOutput> {
  const warnings: string[] = [];
  const targetAudience = String(params.targetAudience || "").trim();
  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: SELLING_POINTS_SYSTEM + (targetAudience ? `\n\n目标受众提示：${targetAudience}` : "") + "\n\n背景：" + systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<SellingPointsOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    warnings.push(`LLM 输出无法解析为 JSON（${String(parseErr).slice(0, 80)}），请检查模型是否支持 JSON mode`);
    parsed = {};
  }

  const allEvidenceIds = Array.isArray(parsed.citedEvidenceIds)
    ? parsed.citedEvidenceIds
    : (parsed.sellingPoints ?? []).flatMap((sp) => sp.evidenceIds ?? []);

  return {
    sellingPoints: Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints : [],
    differentiators: Array.isArray(parsed.differentiators) ? parsed.differentiators : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: [...new Set(allEvidenceIds)],
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── content-ideas ────────────────────────────────────────────────────────────

const CONTENT_IDEAS_SYSTEM = `你是一个专业的内容营销策略师。
基于用户提供的产品资料，生成可执行的营销内容创意，输出严格 JSON，字段如下：
{
  "ideas": [
    {
      "title": "内容标题",
      "angle": "切入角度（一句话）",
      "format": "推荐内容形式（如：短视频/图文/文章/海报/直播等）",
      "evidenceIds": ["[1]"]
    }
  ],
  "summary": "markdown格式的创意思路总结",
  "citedEvidenceIds": ["[1]", "[2]"]
}
规则：生成 {ideaCount} 条 idea；所有 idea 必须基于资料中的事实；
每条 idea 的 evidenceIds 标注该创意的资料依据；不要编造。`;

async function handleContentIdeas(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  systemPrompt: string,
  userPrompt: string,
  params: Record<string, unknown>
): Promise<ContentIdeasOutput> {
  const warnings: string[] = [];
  const ideaCount = Number(params.ideaCount ?? 5);
  const systemWithCount = CONTENT_IDEAS_SYSTEM.replace("{ideaCount}", String(ideaCount));
  const targetAudience = String(params.targetAudience || "").trim();

  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: systemWithCount + (targetAudience ? `\n\n目标受众提示：${targetAudience}` : "") + "\n\n背景：" + systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<ContentIdeasOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    warnings.push(`LLM 输出无法解析为 JSON（${String(parseErr).slice(0, 80)}），请检查模型是否支持 JSON mode`);
    parsed = {};
  }

  const allEvidenceIds = Array.isArray(parsed.citedEvidenceIds)
    ? parsed.citedEvidenceIds
    : (parsed.ideas ?? []).flatMap((idea) => idea.evidenceIds ?? []);

  return {
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: [...new Set(allEvidenceIds)],
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: PromptBuildOutput | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      {
        error: {
          code: "missing_upstream",
          message: "缺少上游 Prompt Build 产物，请先运行 Prompt Build Stage",
        },
      },
      { status: 400 }
    );
  }

  const { systemPrompt, userPrompt, originalQuery } = upstreamOutput;

  if (!userPrompt?.trim()) {
    return NextResponse.json(
      { error: { code: "empty_prompt", message: "上游 Prompt Build 输出的 userPrompt 为空" } },
      { status: 400 }
    );
  }

  const model = String(params.model || "").trim() || undefined;
  const warnings: string[] = [];

  let llmConfig: Awaited<ReturnType<typeof createLLMClient>>;
  try {
    llmConfig = await createLLMClient(
      String(params.apiKey || ""),
      String(params.baseUrl || "")
    );
  } catch (err) {
    return NextResponse.json(
      { error: { code: "missing_api_key", message: err instanceof Error ? err.message : String(err) } },
      { status: 400 }
    );
  }

  const resolvedModel = model || llmConfig.defaultModel;

  const ALLOWED_METHODS = ["marketing-ideas", "product-persona", "selling-points", "content-ideas"];
  if (!ALLOWED_METHODS.includes(methodId)) {
    return NextResponse.json(
      { error: { code: "unknown_method", message: `未知方法: ${methodId}` } },
      { status: 400 }
    );
  }

  try {
    // marketing-ideas：保留原有自由格式逻辑
    if (methodId === "marketing-ideas") {
      const completion = await llmConfig.client.chat.completions.create({
        model: resolvedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      });
      const generatedContent = completion.choices[0]?.message?.content ?? "";
      if (!generatedContent) warnings.push("LLM 返回了空内容");
      const citedEvidenceIds = extractEvidenceIds(generatedContent);
      if (citedEvidenceIds.length === 0 && Boolean(params.includeEvidence ?? true)) {
        warnings.push("生成内容中未检测到 evidence 引用标注");
      }
      const output: GenerationOutput = {
        generatedContent, citedEvidenceIds, model: resolvedModel,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        warnings,
        evidencePack: upstreamOutput.evidencePack,
      };
      return NextResponse.json({
        output,
        trace: { methodId, model: resolvedModel, originalQuery, inputTokens: output.inputTokens, outputTokens: output.outputTokens, citedCount: citedEvidenceIds.length, durationMs: Date.now() - startMs },
        durationMs: Date.now() - startMs,
        warnings,
      });
    }

    // 三种结构化方法
    let output: ProductPersonaOutput | SellingPointsOutput | ContentIdeasOutput;
    if (methodId === "product-persona") {
      output = await handleProductPersona(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
    } else if (methodId === "selling-points") {
      output = await handleSellingPoints(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
    } else {
      output = await handleContentIdeas(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
    }
    // passthrough evidencePack from upstream Citation Stage
    output = { ...output, evidencePack: upstreamOutput.evidencePack };

    return NextResponse.json({
      output,
      trace: {
        methodId, model: resolvedModel, originalQuery,
        inputTokens: output.inputTokens, outputTokens: output.outputTokens,
        citedCount: output.citedEvidenceIds.length,
        durationMs: Date.now() - startMs,
      },
      durationMs: Date.now() - startMs,
      warnings: output.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("401") || message.includes("Incorrect API key") ? "api_auth_failed"
      : message.includes("429") ? "rate_limited"
      : message.includes("model") ? "invalid_model"
      : "llm_failed";
    return NextResponse.json({ error: { code, message } }, { status: 500 });
  }
}
