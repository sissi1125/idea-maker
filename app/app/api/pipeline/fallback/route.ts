/**
 * RAG Pipeline Stage — Fallback（降级处理）
 *
 * 作用：当检索结果不足或质量太低时，触发备用逻辑，
 *       防止 LLM 在没有可靠 evidence 的情况下"幻觉式"生成。
 *
 * Pipeline 位置：
 *   Rerank → [Fallback] → Prompt Build → Generation
 *
 * 触发条件：
 *   optional 步骤，默认关闭。建议在以下场景手动开启：
 *   - 文档覆盖范围有限，部分查询无法命中
 *   - 需要明确拒答超出范围的问题
 *   - 测试降级路径的行为
 *
 * 两种方法：
 *
 *   reject-answer     检索结果不足时返回预设拒绝消息，不进行生成
 *                     最保守，确保"无 evidence 不生成"的产品原则
 *
 *   generic-response  检索结果不足时调用 LLM 生成通用回复（不依赖 evidence）
 *                     适合需要礼貌回应而不是硬性拒绝的场景
 *
 * 判断"结果不足"的标准：
 *   - matches 数量 < minMatchCount（默认 1）
 *   - 或最高分 < minScore（默认 0.3）
 */

import { NextRequest, NextResponse } from "next/server";
import type { RerankOutput, RankedChunk } from "../rerank/route";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface FallbackOutput {
  /** true = 触发了降级处理，false = 质量达标，直接透传 */
  triggered: boolean;
  triggerReason: string;
  /** 触发时返回降级响应文本（reject/generic 消息） */
  fallbackResponse?: string;
  /** 未触发时透传上游 rankedMatches（供 prompt-build 使用） */
  rankedMatches: RankedChunk[];
  originalQuery: string;
  warnings: string[];
}

// ─── 质量评估 ─────────────────────────────────────────────────────────────────

function assessQuality(
  matches: RankedChunk[],
  minMatchCount: number,
  minScore: number
): { sufficient: boolean; reason: string } {
  if (matches.length < minMatchCount) {
    return { sufficient: false, reason: `检索结果数量 ${matches.length} < 最低要求 ${minMatchCount}` };
  }
  const topScore = matches[0]?.rerankScore ?? 0;
  if (topScore < minScore) {
    return { sufficient: false, reason: `最高分 ${topScore.toFixed(3)} < 最低分数要求 ${minScore}，结果质量不足` };
  }
  return { sufficient: true, reason: "质量达标，无需降级" };
}

// ─── reject-answer ────────────────────────────────────────────────────────────

function handleReject(
  matches: RankedChunk[],
  originalQuery: string,
  minMatchCount: number,
  minScore: number,
  rejectMessage: string
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

// ─── generic-response ────────────────────────────────────────────────────────

async function handleGenericResponse(
  matches: RankedChunk[],
  originalQuery: string,
  minMatchCount: number,
  minScore: number,
  model: string,
  paramApiKey?: string
): Promise<FallbackOutput> {
  const { sufficient, reason } = assessQuality(matches, minMatchCount, minScore);
  if (sufficient) {
    return { triggered: false, triggerReason: reason, rankedMatches: matches, originalQuery, warnings: [] };
  }

  const apiKey = paramApiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // 没有 API Key 时退化为拒答
    return {
      triggered: true,
      triggerReason: reason,
      fallbackResponse: "抱歉，我目前没有足够的信息来回答这个问题，建议您查阅产品官方文档。",
      rankedMatches: [],
      originalQuery,
      warnings: [`Fallback 触发（无 API Key，退化为拒答）：${reason}`],
    };
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const resp = await client.chat.completions.create({
    model, temperature: 0.5,
    messages: [
      { role: "system", content: "你是一个礼貌的产品助手。当无法从文档中找到相关信息时，请给出一个诚实、有帮助的通用回复，不要编造具体细节。" },
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

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown>; upstreamOutput: RerankOutput | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Rerank 产物，请先运行 Rerank Stage" } },
      { status: 400 }
    );
  }

  const matches = upstreamOutput.rankedMatches ?? [];
  const originalQuery = upstreamOutput.originalQuery ?? "";
  const minMatchCount = Number(params.minMatchCount ?? 1);
  const minScore = Number(params.minScore ?? 0.3);

  try {
    let result: FallbackOutput;

    switch (methodId) {
      case "reject-answer":
        result = handleReject(
          matches, originalQuery, minMatchCount, minScore,
          String(params.message ?? "抱歉，我目前没有足够的信息来回答这个问题。")
        );
        break;
      case "generic-response":
        result = await handleGenericResponse(
          matches, originalQuery, minMatchCount, minScore,
          String(params.model ?? "gpt-4o-mini"),
          typeof params.apiKey === "string" ? params.apiKey : undefined
        );
        break;
      default:
        return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
    }

    return NextResponse.json({
      output: result,
      trace: { methodId, triggered: result.triggered, triggerReason: result.triggerReason, inputCount: matches.length, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: { code: "fallback_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
