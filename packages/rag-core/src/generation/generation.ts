/**
 * RAG Pipeline Stage - Generation - 4 method 全 LLM 调用
 *
 * 注入：LLMChatClient（所有 method 必传）+ defaultModel
 * Evidence-first：所有 method 提取 [evidence-NNN] 引用，保留溯源链
 */

import type {
  ContentIdea,
  ContentIdeasOutput,
  GenerationInput,
  GenerationMarketingIdeasOutput,
  GenerationResult,
  LLMChatClient,
  ProductPersonaOutput,
  SellingPoint,
  SellingPointsOutput,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

// ─── 提取 evidence ID ─────────────────────────────────────────────────────────

/**
 * 从生成文本中提取 [evidence-NNN] / [N] 引用。
 * 同时匹配 evidenceId 长格式（{docId}_v{ver}_c{idx}）和数字编号。
 */
function extractEvidenceIds(text: string): string[] {
  const seen = new Set<string>();
  const pattern1 = /\[evidence[-_][^\]]+\]/gi;
  const pattern2 = /\[\d+\]/g;
  for (const match of text.matchAll(pattern1)) seen.add(match[0]);
  for (const match of text.matchAll(pattern2)) seen.add(match[0]);
  return [...seen];
}

// ─── marketing-ideas（自由格式）───────────────────────────────────────────────

async function handleMarketingIdeas(
  client: LLMChatClient,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  includeEvidence: boolean,
): Promise<GenerationMarketingIdeasOutput> {
  const warnings: string[] = [];
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const generatedContent = completion.choices[0]?.message?.content ?? "";
  if (!generatedContent) warnings.push("LLM 返回了空内容");

  const citedEvidenceIds = extractEvidenceIds(generatedContent);
  if (citedEvidenceIds.length === 0 && includeEvidence) {
    warnings.push("生成内容中未检测到 evidence 引用标注");
  }

  return {
    generatedContent,
    citedEvidenceIds,
    model,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── product-persona（JSON mode）──────────────────────────────────────────────

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
  client: LLMChatClient,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  targetAudience: string,
): Promise<ProductPersonaOutput> {
  const warnings: string[] = [];
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          PRODUCT_PERSONA_SYSTEM +
          (targetAudience ? `\n\n目标受众提示：${targetAudience}` : "") +
          "\n\n背景：" +
          systemPrompt,
      },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<ProductPersonaOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    warnings.push(
      `LLM 输出无法解析为 JSON（${String(parseErr).slice(0, 80)}），请检查模型是否支持 JSON mode`,
    );
    parsed = {};
  }

  return {
    targetSegment: parsed.targetSegment ?? (targetAudience || "未能生成"),
    painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
    coreNeeds: Array.isArray(parsed.coreNeeds) ? parsed.coreNeeds : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: Array.isArray(parsed.citedEvidenceIds) ? parsed.citedEvidenceIds : [],
    model,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── selling-points（JSON mode）───────────────────────────────────────────────

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
  client: LLMChatClient,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  targetAudience: string,
): Promise<SellingPointsOutput> {
  const warnings: string[] = [];
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          SELLING_POINTS_SYSTEM +
          (targetAudience ? `\n\n目标受众提示：${targetAudience}` : "") +
          "\n\n背景：" +
          systemPrompt,
      },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<SellingPointsOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    warnings.push(`LLM 输出无法解析为 JSON（${String(parseErr).slice(0, 80)}）`);
    parsed = {};
  }

  const allEvidenceIds = Array.isArray(parsed.citedEvidenceIds)
    ? parsed.citedEvidenceIds
    : (parsed.sellingPoints ?? []).flatMap((sp: SellingPoint) => sp.evidenceIds ?? []);

  return {
    sellingPoints: Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints : [],
    differentiators: Array.isArray(parsed.differentiators) ? parsed.differentiators : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: [...new Set(allEvidenceIds)],
    model,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── content-ideas（JSON mode）────────────────────────────────────────────────

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
  client: LLMChatClient,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  targetAudience: string,
  ideaCount: number,
): Promise<ContentIdeasOutput> {
  const warnings: string[] = [];
  const systemWithCount = CONTENT_IDEAS_SYSTEM.replace("{ideaCount}", String(ideaCount));

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          systemWithCount +
          (targetAudience ? `\n\n目标受众提示：${targetAudience}` : "") +
          "\n\n背景：" +
          systemPrompt,
      },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<ContentIdeasOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    warnings.push(`LLM 输出无法解析为 JSON（${String(parseErr).slice(0, 80)}）`);
    parsed = {};
  }

  const allEvidenceIds = Array.isArray(parsed.citedEvidenceIds)
    ? parsed.citedEvidenceIds
    : (parsed.ideas ?? []).flatMap((idea: ContentIdea) => idea.evidenceIds ?? []);

  return {
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: [...new Set(allEvidenceIds)],
    model,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runGeneration(input: GenerationInput): Promise<GenerationResult> {
  const { methodId, params, upstream, llmClient, defaultModel } = input;

  if (!llmClient) {
    throw new PipelineError(
      "missing_client",
      "generation 所有 method 都需要注入 LLMChatClient",
    );
  }

  const { systemPrompt, userPrompt, originalQuery, evidencePack } = upstream;
  if (!userPrompt?.trim()) {
    throw new PipelineError("empty_prompt", "上游 Prompt Build 输出的 userPrompt 为空");
  }

  const resolvedModel = params.model.trim() || defaultModel;

  let output;
  try {
    switch (methodId) {
      case "product-persona":
        output = await handleProductPersona(
          llmClient,
          resolvedModel,
          systemPrompt,
          userPrompt,
          params.targetAudience,
        );
        break;
      case "selling-points":
        output = await handleSellingPoints(
          llmClient,
          resolvedModel,
          systemPrompt,
          userPrompt,
          params.targetAudience,
        );
        break;
      case "content-ideas":
        output = await handleContentIdeas(
          llmClient,
          resolvedModel,
          systemPrompt,
          userPrompt,
          params.targetAudience,
          params.ideaCount,
        );
        break;
      case "marketing-ideas":
      default:
        output = await handleMarketingIdeas(
          llmClient,
          resolvedModel,
          systemPrompt,
          userPrompt,
          params.includeEvidence,
        );
        break;
    }
  } catch (err) {
    // LLM 错误统一抛 PipelineError，路由层翻译为 HTTP（auth/rate_limit 等）
    if (err instanceof PipelineError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("401") || message.toLowerCase().includes("incorrect api key")
      ? "api_auth_failed"
      : message.includes("429")
        ? "rate_limited"
        : message.toLowerCase().includes("model")
          ? "invalid_model"
          : "llm_failed";
    throw new PipelineError(code, message);
  }

  // evidencePack 透传到 output（供下游 evaluation 使用）
  const withEvidence = { ...output, evidencePack };
  const citedCount =
    "citedEvidenceIds" in withEvidence ? withEvidence.citedEvidenceIds.length : 0;

  return {
    output: withEvidence,
    trace: {
      methodId,
      model: resolvedModel,
      originalQuery,
      inputTokens: withEvidence.inputTokens,
      outputTokens: withEvidence.outputTokens,
      citedCount,
    },
    warnings: withEvidence.warnings,
  };
}
