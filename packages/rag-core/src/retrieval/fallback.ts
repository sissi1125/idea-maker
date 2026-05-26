/**
 * RAG Pipeline Stage - Fallback - 纯算法 + LLMChatClient 注入（可选优雅降级）
 *
 * 2 method：
 *   reject-answer     返回预设拒答消息
 *   generic-response  调 LLMChatClient 生成通用回复（无 client 时降级到拒答）
 *
 * 触发条件：matches < minMatchCount 或 topScore < minScore
 *
 * **注入语义特殊**：generic-response 缺 llmClient 时**不抛错**，而是降级到拒答
 * 文案 + warning。这是 fallback stage 的特性——它本身就是降级路径，再降一级符合语义。
 */

import type {
  FallbackInput,
  FallbackOutput,
  FallbackResult,
  LLMChatClient,
  RankedChunk,
} from "@harness/shared-types";

// ─── 质量评估 ─────────────────────────────────────────────────────────────────

function assessQuality(
  matches: RankedChunk[],
  minMatchCount: number,
  minScore: number,
): { sufficient: boolean; reason: string } {
  if (matches.length < minMatchCount) {
    return {
      sufficient: false,
      reason: `检索结果数量 ${matches.length} < 最低要求 ${minMatchCount}`,
    };
  }
  const topScore = matches[0]?.rerankScore ?? 0;
  if (topScore < minScore) {
    return {
      sufficient: false,
      reason: `最高分 ${topScore.toFixed(3)} < 最低分数要求 ${minScore}，结果质量不足`,
    };
  }
  return { sufficient: true, reason: "质量达标，无需降级" };
}

// ─── reject-answer ────────────────────────────────────────────────────────────

function handleReject(
  matches: RankedChunk[],
  originalQuery: string,
  minMatchCount: number,
  minScore: number,
  rejectMessage: string,
): FallbackOutput {
  const { sufficient, reason } = assessQuality(matches, minMatchCount, minScore);
  if (sufficient) {
    return { triggered: false, triggerReason: reason, rankedMatches: matches, originalQuery, warnings: [] };
  }
  return {
    triggered: true,
    triggerReason: reason,
    fallbackResponse: rejectMessage,
    rankedMatches: [],
    originalQuery,
    warnings: [`Fallback 触发：${reason}`],
  };
}

// ─── generic-response ─────────────────────────────────────────────────────────

async function handleGenericResponse(
  matches: RankedChunk[],
  originalQuery: string,
  minMatchCount: number,
  minScore: number,
  model: string,
  client: LLMChatClient | undefined,
): Promise<FallbackOutput> {
  const { sufficient, reason } = assessQuality(matches, minMatchCount, minScore);
  if (sufficient) {
    return { triggered: false, triggerReason: reason, rankedMatches: matches, originalQuery, warnings: [] };
  }

  // 缺 client 时优雅降级（不抛错）
  if (!client) {
    return {
      triggered: true,
      triggerReason: reason,
      fallbackResponse:
        "抱歉，我目前没有足够的信息来回答这个问题，建议您查阅产品官方文档。",
      rankedMatches: [],
      originalQuery,
      warnings: [`Fallback 触发（无 LLM 配置，退化为拒答）：${reason}`],
    };
  }

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          "你是一个礼貌的产品助手。当无法从文档中找到相关信息时，请给出一个诚实、有帮助的通用回复，不要编造具体细节。",
      },
      { role: "user", content: originalQuery },
    ],
  });

  return {
    triggered: true,
    triggerReason: reason,
    fallbackResponse: resp.choices[0]?.message?.content?.trim() ?? "抱歉，暂时无法回答这个问题。",
    rankedMatches: [],
    originalQuery,
    warnings: [`Fallback 触发（通用回复）：${reason}`],
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runFallback(input: FallbackInput): Promise<FallbackResult> {
  const { methodId, params, upstream, llmClient } = input;
  const matches = upstream.rankedMatches ?? [];
  const originalQuery = upstream.originalQuery ?? "";

  let output: FallbackOutput;

  switch (methodId) {
    case "generic-response":
      output = await handleGenericResponse(
        matches,
        originalQuery,
        params.minMatchCount,
        params.minScore,
        params.model,
        llmClient,
      );
      break;
    case "reject-answer":
    default:
      output = handleReject(
        matches,
        originalQuery,
        params.minMatchCount,
        params.minScore,
        params.message,
      );
      break;
  }

  return {
    output,
    trace: {
      methodId,
      triggered: output.triggered,
      triggerReason: output.triggerReason,
      inputCount: matches.length,
    },
    warnings: output.warnings,
  };
}
