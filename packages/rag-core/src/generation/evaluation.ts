/**
 * RAG Pipeline Stage - Evaluation - 算法指标 + 可选 LLM Faithfulness
 *
 * 2 method：
 *   rag-metrics-only              纯算法（hitRate / citationCoverage / confidenceScore）
 *   rag-metrics-with-faithfulness 算法 + LLMChatClient Faithfulness judge
 *
 * 指标计算细节：
 *   - hitRate: 与上游 score 阈值相关，反映检索召回质量
 *   - citationCoverage: 反映生成 evidence-first 遵守度
 *   - confidenceScore: 被引用 evidence 的平均分（不是全部 evidence）
 *   - faithfulness: LLM judge（JSON mode），失败不阻塞，warning + 保 null
 *
 * 引用 ID 归一化兼容 3 种格式：[N] / [evidence-NNN] / 原始 evidenceId
 */

import type {
  EvaluationInput,
  EvaluationOutput,
  EvaluationResult,
  EvaluationUpstream,
  EvidenceItem,
  FaithfulnessResult,
  LLMChatClient,
} from "@harness/shared-types";

// ─── 算法指标 ─────────────────────────────────────────────────────────────────

function computeAlgorithmicMetrics(
  evidencePack: EvidenceItem[],
  citedEvidenceIds: string[],
  scoreThreshold: number,
): Pick<EvaluationOutput, "hitRate" | "citationCoverage" | "confidenceScore" | "totalEvidence" | "citedCount"> {
  const totalEvidence = evidencePack.length;
  if (totalEvidence === 0) {
    return { hitRate: 0, citationCoverage: 0, confidenceScore: 0, totalEvidence: 0, citedCount: 0 };
  }

  const hitCount = evidencePack.filter((e) => e.score >= scoreThreshold).length;
  const hitRate = hitCount / totalEvidence;

  // 兼容三种引用格式
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
  const confidenceScore =
    citedEvidence.length > 0
      ? citedEvidence.reduce((sum, e) => sum + e.score, 0) / citedEvidence.length
      : 0;

  return { hitRate, citationCoverage, confidenceScore, totalEvidence, citedCount };
}

// ─── Warnings + Level ─────────────────────────────────────────────────────────

function generateWarnings(
  metrics: Pick<EvaluationOutput, "hitRate" | "citationCoverage" | "confidenceScore" | "totalEvidence">,
  evidencePackMissing: boolean,
  faithfulnessScore: number | null,
): string[] {
  const warnings: string[] = [];

  if (evidencePackMissing) {
    warnings.push(
      "未检测到 evidence pack，请确认 citation stage 已运行且 prompt-build / generation 已完成 evidencePack 透传",
    );
    return warnings;
  }
  if (metrics.totalEvidence === 0) {
    warnings.push("evidence pack 为空（totalEvidence = 0），无法计算指标");
    return warnings;
  }
  if (metrics.hitRate < 0.3) {
    warnings.push(
      `检索命中率偏低（${(metrics.hitRate * 100).toFixed(0)}%），大部分 evidence 相关度未达阈值，建议调整 retrieval top-k 或 score threshold`,
    );
  }
  if (metrics.citationCoverage === 0) {
    warnings.push("生成内容未引用任何 evidence，evidence-first 原则被违反，请检查 generation prompt");
  } else if (metrics.citationCoverage < 0.3) {
    warnings.push(
      `引用覆盖率偏低（${(metrics.citationCoverage * 100).toFixed(0)}%），生成内容可能存在幻觉风险`,
    );
  }
  if (metrics.confidenceScore > 0 && metrics.confidenceScore < 0.4) {
    warnings.push(
      `被引用 evidence 平均分偏低（${metrics.confidenceScore.toFixed(2)}），检索质量可能不足`,
    );
  }
  if (faithfulnessScore !== null && faithfulnessScore < 0.6) {
    warnings.push(
      `LLM Faithfulness 评分偏低（${faithfulnessScore.toFixed(2)}），生成内容与 evidence 存在较多不一致`,
    );
  }

  return warnings;
}

function computeLevel(
  metrics: Pick<EvaluationOutput, "hitRate" | "citationCoverage">,
  faithfulnessScore: number | null,
  warnings: string[],
): "good" | "warning" | "poor" {
  if (metrics.citationCoverage === 0 || warnings.length >= 2) return "poor";
  const faithOk = faithfulnessScore === null || faithfulnessScore >= 0.7;
  if (metrics.hitRate >= 0.5 && metrics.citationCoverage >= 0.5 && faithOk) return "good";
  return "warning";
}

// ─── Faithfulness Judge ───────────────────────────────────────────────────────

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

function buildGeneratedText(upstream: EvaluationUpstream): string {
  if (upstream.generatedContent) return upstream.generatedContent;
  const parts: string[] = [];
  if (upstream.targetSegment) parts.push(`目标人群：${upstream.targetSegment}`);
  if (upstream.painPoints?.length) parts.push(`痛点：${upstream.painPoints.join("；")}`);
  if (upstream.coreNeeds?.length) parts.push(`核心需求：${upstream.coreNeeds.join("；")}`);
  if (upstream.sellingPoints?.length) {
    parts.push(
      ...upstream.sellingPoints.map(
        (sp: { title: string; description: string }) => `卖点：${sp.title} — ${sp.description}`,
      ),
    );
  }
  if (upstream.differentiators?.length) parts.push(`差异化：${upstream.differentiators.join("；")}`);
  if (upstream.ideas?.length) {
    parts.push(
      ...upstream.ideas.map(
        (i: { title: string; angle: string; format: string }) =>
          `Idea：${i.title}（${i.angle}，${i.format}）`,
      ),
    );
  }
  if (upstream.summary) parts.push(`总结：${upstream.summary}`);
  return parts.join("\n") || "（无生成内容）";
}

async function runFaithfulnessJudge(
  client: LLMChatClient,
  model: string,
  originalQuery: string,
  evidencePack: EvidenceItem[],
  upstream: EvaluationUpstream,
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

  const completion = await client.chat.completions.create({
    model,
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
    throw new Error(`LLM 返回内容无法解析为 JSON，原始内容：${raw.slice(0, 100)}`);
  }

  return {
    score:
      typeof parsed.faithfulnessScore === "number"
        ? Math.max(0, Math.min(1, parsed.faithfulnessScore))
        : 0,
    unsupportedClaims: Array.isArray(parsed.unsupportedClaims) ? parsed.unsupportedClaims : [],
    reason: parsed.reason ?? "LLM 未返回说明",
    model,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runEvaluation(input: EvaluationInput): Promise<EvaluationResult> {
  const startMs = Date.now();
  const {
    methodId,
    params,
    upstream,
    llmClient,
    defaultModel,
    evidencePackMissing = !upstream.evidencePack,
  } = input;

  const evidencePack = upstream.evidencePack ?? [];
  const citedEvidenceIds = upstream.citedEvidenceIds ?? [];
  const originalQuery = upstream.originalQuery ?? "";
  const scoreThreshold = params.scoreThreshold;

  const algorithmicMetrics = computeAlgorithmicMetrics(
    evidencePack,
    citedEvidenceIds,
    scoreThreshold,
  );

  let faithfulness: FaithfulnessResult | null = null;
  const faithfulnessWarnings: string[] = [];

  if (methodId === "rag-metrics-with-faithfulness") {
    if (!llmClient) {
      faithfulnessWarnings.push("LLM Faithfulness 需要注入 llmClient，降级为纯算法评估");
    } else {
      const resolvedModel = params.model.trim() || defaultModel || "gpt-4o-mini";
      try {
        faithfulness = await runFaithfulnessJudge(
          llmClient,
          resolvedModel,
          originalQuery,
          evidencePack,
          upstream,
        );
      } catch (err) {
        faithfulnessWarnings.push(
          `LLM Faithfulness judge 调用失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const warnings = [
    ...generateWarnings(algorithmicMetrics, evidencePackMissing, faithfulness?.score ?? null),
    ...faithfulnessWarnings,
  ];

  const level = computeLevel(algorithmicMetrics, faithfulness?.score ?? null, warnings);
  const durationMs = Date.now() - startMs;

  const output: EvaluationOutput = {
    ...algorithmicMetrics,
    scoreThreshold,
    faithfulness,
    level,
    warnings,
    method: methodId,
    durationMs,
  };

  return {
    output,
    trace: {
      methodId,
      totalEvidence: algorithmicMetrics.totalEvidence,
      citedCount: algorithmicMetrics.citedCount,
      hitRate: algorithmicMetrics.hitRate,
      citationCoverage: algorithmicMetrics.citationCoverage,
      confidenceScore: algorithmicMetrics.confidenceScore,
      faithfulnessScore: faithfulness?.score ?? null,
    },
    warnings,
  };
}
