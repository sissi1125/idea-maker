/**
 * RAG Pipeline Stage — Evaluation（质量评估）
 *
 * 作用：基于 generation 输出（citedEvidenceIds）和 evidencePack（来自 citation，
 *       经 prompt-build → generation 透传），算法计算三个 RAG 质量指标，
 *       并可选地调用 LLM 评估 Faithfulness（生成内容与 evidence 的忠实度）。
 *
 * 两种方法：
 *   rag-metrics-only              纯算法，无 LLM 调用
 *   rag-metrics-with-faithfulness 算法 + LLM Faithfulness judge（JSON mode）
 *
 * 指标定义：
 *   hitRate          = evidence[score >= scoreThreshold].length / totalEvidence
 *   citationCoverage = citedEvidenceIds.length / totalEvidence
 *   confidenceScore  = mean(score of cited evidence items)
 *   faithfulness     = LLM 评估 0-1 分（忠实度）
 */

import { NextRequest, NextResponse } from "next/server";
import { createLLMClient } from "@/lib/providers";
import type { EvidenceItem } from "@harness/shared-types";

// GenerationOutput 的最小结构（只取 evaluation 需要的字段）
interface GenerationUpstream {
  citedEvidenceIds?: string[];
  evidencePack?: EvidenceItem[];
  originalQuery?: string;
  // marketing-ideas 的原始文本
  generatedContent?: string;
  // 结构化方法的输出（product-persona / selling-points / content-ideas）
  targetSegment?: string;
  painPoints?: string[];
  coreNeeds?: string[];
  summary?: string;
  sellingPoints?: Array<{ title: string; description: string }>;
  differentiators?: string[];
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
  // 算法指标
  hitRate: number;
  citationCoverage: number;
  confidenceScore: number;
  totalEvidence: number;
  citedCount: number;
  scoreThreshold: number;
  // LLM Faithfulness（rag-metrics-only 时为 null）
  faithfulness: FaithfulnessResult | null;
  // 综合等级
  level: "good" | "warning" | "poor";
  warnings: string[];
  method: string;
  durationMs: number;
}

// ─── 算法指标计算 ──────────────────────────────────────────────────────────────

function computeAlgorithmicMetrics(
  evidencePack: EvidenceItem[],
  citedEvidenceIds: string[],
  scoreThreshold: number
): Pick<EvaluationOutput, "hitRate" | "citationCoverage" | "confidenceScore" | "totalEvidence" | "citedCount"> {
  const totalEvidence = evidencePack.length;

  if (totalEvidence === 0) {
    return { hitRate: 0, citationCoverage: 0, confidenceScore: 0, totalEvidence: 0, citedCount: 0 };
  }

  const hitCount = evidencePack.filter((e) => e.score >= scoreThreshold).length;
  const hitRate = hitCount / totalEvidence;

  // 建立索引映射，兼容三种引用格式：
  //   [1],[2]…          — generation structured 方法返回的简单编号
  //   [evidence-001]…   — citation buildContextText 在 contextText 里的标注
  //   doc1_v1_c0…       — evidenceId 原始值（直接匹配，作为兜底）
  const indexToId = new Map<string, string>();
  evidencePack.forEach((e, i) => {
    indexToId.set(`[${i + 1}]`, e.evidenceId);
    indexToId.set(`[evidence-${String(i + 1).padStart(3, "0")}]`, e.evidenceId);
  });
  const normalizedCited = citedEvidenceIds.map((id) => indexToId.get(id) ?? id);
  const citedSet = new Set(normalizedCited);
  const citedEvidence = evidencePack.filter((e) => citedSet.has(e.evidenceId));
  const citedCount = citedEvidence.length;
  const citationCoverage = citedCount / totalEvidence;
  const confidenceScore = citedEvidence.length > 0
    ? citedEvidence.reduce((sum, e) => sum + e.score, 0) / citedEvidence.length
    : 0;

  return { hitRate, citationCoverage, confidenceScore, totalEvidence, citedCount };
}

// ─── Warnings 生成 ─────────────────────────────────────────────────────────────

function generateWarnings(
  metrics: Pick<EvaluationOutput, "hitRate" | "citationCoverage" | "confidenceScore" | "totalEvidence">,
  evidencePackMissing: boolean,
  faithfulnessScore: number | null
): string[] {
  const warnings: string[] = [];

  if (evidencePackMissing) {
    warnings.push("未检测到 evidence pack，请确认 citation stage 已运行且 prompt-build / generation 已完成 evidencePack 透传");
    return warnings;
  }

  if (metrics.totalEvidence === 0) {
    warnings.push("evidence pack 为空（totalEvidence = 0），无法计算指标");
    return warnings;
  }

  if (metrics.hitRate < 0.3) {
    warnings.push(`检索命中率偏低（${(metrics.hitRate * 100).toFixed(0)}%），大部分 evidence 相关度未达阈值，建议调整 retrieval top-k 或 score threshold`);
  }

  if (metrics.citationCoverage === 0) {
    warnings.push("生成内容未引用任何 evidence，evidence-first 原则被违反，请检查 generation prompt");
  } else if (metrics.citationCoverage < 0.3) {
    warnings.push(`引用覆盖率偏低（${(metrics.citationCoverage * 100).toFixed(0)}%），生成内容可能存在幻觉风险`);
  }

  if (metrics.confidenceScore > 0 && metrics.confidenceScore < 0.4) {
    warnings.push(`被引用 evidence 平均分偏低（${metrics.confidenceScore.toFixed(2)}），检索质量可能不足`);
  }

  if (faithfulnessScore !== null && faithfulnessScore < 0.6) {
    warnings.push(`LLM Faithfulness 评分偏低（${faithfulnessScore.toFixed(2)}），生成内容与 evidence 存在较多不一致`);
  }

  return warnings;
}

// ─── Level 计算 ────────────────────────────────────────────────────────────────

function computeLevel(
  metrics: Pick<EvaluationOutput, "hitRate" | "citationCoverage">,
  faithfulnessScore: number | null,
  warnings: string[]
): "good" | "warning" | "poor" {
  if (metrics.citationCoverage === 0 || warnings.length >= 2) return "poor";
  const faithOk = faithfulnessScore === null || faithfulnessScore >= 0.7;
  if (metrics.hitRate >= 0.5 && metrics.citationCoverage >= 0.5 && faithOk) return "good";
  return "warning";
}

// ─── LLM Faithfulness Judge ────────────────────────────────────────────────────

const FAITHFULNESS_SYSTEM = `你是一个专业的 RAG 系统质量评估员。
你的任务是评估生成内容与 evidence 的忠实度（Faithfulness）。

规则：
1. 逐条检查生成内容中的事实性主张是否能在提供的 evidence 中找到依据
2. faithfulnessScore: 0-1 浮点数（1=完全有依据，0=完全无依据）
3. unsupportedClaims: 列出无 evidence 支撑的具体主张（简洁，每条 ≤ 30 字）
4. reason: 一句话总结评估结论

输出严格 JSON：
{
  "faithfulnessScore": 0.85,
  "unsupportedClaims": ["主张1"],
  "reason": "生成内容整体忠实度较高"
}`;

function buildGeneratedText(upstream: GenerationUpstream): string {
  if (upstream.generatedContent) return upstream.generatedContent;
  const parts: string[] = [];
  if (upstream.targetSegment) parts.push(`目标人群：${upstream.targetSegment}`);
  if (upstream.painPoints?.length) parts.push(`痛点：${upstream.painPoints.join("；")}`);
  if (upstream.coreNeeds?.length) parts.push(`核心需求：${upstream.coreNeeds.join("；")}`);
  if (upstream.sellingPoints?.length) {
    parts.push(...upstream.sellingPoints.map((sp) => `卖点：${sp.title} — ${sp.description}`));
  }
  if (upstream.differentiators?.length) parts.push(`差异化：${upstream.differentiators.join("；")}`);
  if (upstream.ideas?.length) {
    parts.push(...upstream.ideas.map((i) => `Idea：${i.title}（${i.angle}，${i.format}）`));
  }
  if (upstream.summary) parts.push(`总结：${upstream.summary}`);
  return parts.join("\n") || "（无生成内容）";
}

async function runFaithfulnessJudge(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  originalQuery: string,
  evidencePack: EvidenceItem[],
  upstream: GenerationUpstream
): Promise<FaithfulnessResult> {
  const evidenceText = evidencePack
    .map((e, i) => `[${i + 1}] ${e.text.slice(0, 300)} (score: ${e.score.toFixed(2)})`)
    .join("\n");
  const generatedText = buildGeneratedText(upstream);

  const userPrompt = `用户问题：${originalQuery || "（未知）"}

Evidence（共 ${evidencePack.length} 条）：
${evidenceText}

生成内容：
${generatedText}

请评估生成内容的忠实度。`;

  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: FAITHFULNESS_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { faithfulnessScore?: number; unsupportedClaims?: string[]; reason?: string } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 解析失败时抛出，被外层 catch 捕获为 faithfulnessWarnings，faithfulness 保持 null，避免误触低分 warning
    throw new Error(`LLM 返回内容无法解析为 JSON，原始内容：${raw.slice(0, 100)}`);
  }

  return {
    score: typeof parsed.faithfulnessScore === "number" ? Math.max(0, Math.min(1, parsed.faithfulnessScore)) : 0,
    unsupportedClaims: Array.isArray(parsed.unsupportedClaims) ? parsed.unsupportedClaims : [],
    reason: parsed.reason ?? "LLM 未返回说明",
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

const ALLOWED_METHODS = ["rag-metrics-only", "rag-metrics-with-faithfulness"];

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: GenerationUpstream | null;
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
      { error: { code: "missing_upstream", message: "缺少上游 Generation 产物，请先运行 Generation Stage" } },
      { status: 400 }
    );
  }

  if (!ALLOWED_METHODS.includes(methodId)) {
    return NextResponse.json(
      { error: { code: "unknown_method", message: `未知方法: ${methodId}` } },
      { status: 400 }
    );
  }

  const rawThreshold = Number(params.scoreThreshold);
  const scoreThreshold = isNaN(rawThreshold) ? 0.5 : Math.max(0, Math.min(1, rawThreshold));
  const evidencePack = upstreamOutput.evidencePack ?? [];
  const evidencePackMissing = !upstreamOutput.evidencePack;
  const citedEvidenceIds = upstreamOutput.citedEvidenceIds ?? [];
  const originalQuery = upstreamOutput.originalQuery ?? "";

  const algorithmicMetrics = computeAlgorithmicMetrics(evidencePack, citedEvidenceIds, scoreThreshold);

  let faithfulness: FaithfulnessResult | null = null;
  const faithfulnessWarnings: string[] = [];

  if (methodId === "rag-metrics-with-faithfulness") {
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

    const resolvedModel = String(params.model || "").trim() || llmConfig.defaultModel;

    try {
      faithfulness = await runFaithfulnessJudge(
        llmConfig, resolvedModel, originalQuery, evidencePack, upstreamOutput
      );
    } catch (err) {
      faithfulnessWarnings.push(`LLM Faithfulness judge 调用失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const warnings = [
    ...generateWarnings(algorithmicMetrics, evidencePackMissing, faithfulness?.score ?? null),
    ...faithfulnessWarnings,
  ];

  const level = computeLevel(algorithmicMetrics, faithfulness?.score ?? null, warnings);

  const durationMs = Date.now() - startMs;  // 缓存一次，避免三处调用时间不一致

  const output: EvaluationOutput = {
    ...algorithmicMetrics,
    scoreThreshold,
    faithfulness,
    level,
    warnings,
    method: methodId,
    durationMs,
  };

  return NextResponse.json({
    output,
    trace: {
      methodId,
      totalEvidence: algorithmicMetrics.totalEvidence,
      citedCount: algorithmicMetrics.citedCount,
      hitRate: algorithmicMetrics.hitRate,
      citationCoverage: algorithmicMetrics.citationCoverage,
      confidenceScore: algorithmicMetrics.confidenceScore,
      faithfulnessScore: faithfulness?.score ?? null,
      durationMs,
    },
    durationMs,
    warnings,
  });
}
