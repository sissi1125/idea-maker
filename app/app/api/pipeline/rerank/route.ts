/**
 * RAG Pipeline Stage — Rerank（重排）
 *
 * 作用：对 filter 后的候选 chunk 做精细排序，使最相关的 chunk 排在最前面，
 *       提升 LLM 接受到的 context 质量（Top-N precision）。
 *
 * Pipeline 位置：
 *   Filter → [Rerank] → Citation / Prompt Build
 *
 * 为什么需要 Rerank？
 *   向量检索（embedding 相似度）捕获"语义接近"，但不等于"回答这个问题最有用"。
 *   Cross-encoder reranker 同时看 query 和 passage，判断"这段话对回答 query 有多大帮助"，
 *   精度远高于 bi-encoder（embedding 模型），但速度慢，所以只对 filter 后的少量候选做。
 *
 * 四种方法：
 *
 *   score-only        直接按 filter 后的分数排序（无重排），作为基线对照
 *
 *   metadata-boost    给 sourceRef 包含 query 关键词的 chunk 加权
 *                     规则驱动，无 API 依赖，适合有清晰文档结构的场景
 *
 *   hf-tei-rerank     调用 HuggingFace TEI Cross-encoder Rerank 服务
 *                     POST /rerank，返回每个 passage 对 query 的 relevance score
 *                     需要自托管 TEI 服务（支持 BAAI/bge-reranker 系列）
 *
 *   llm-relevance-rerank  让 LLM 对每个 chunk 打 1-10 分
 *                         最准确，但成本高（N 个 chunk = N 次 API 调用）
 *                         适合 rerankTopN <= 5 的场景
 */

import { NextRequest, NextResponse } from "next/server";
import { createLLMClient } from "@/lib/providers";
import type { FilterOutput, FilteredChunk } from "../filter/route";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface RankedChunk extends FilteredChunk {
  rerankScore: number;
  originalRank: number;
  newRank: number;
}

export interface RerankOutput {
  /** 从 filter 透传，供 citation/prompt-build 使用（route handler 注入） */
  originalQuery?: string;
  rankedMatches: RankedChunk[];
  /** 重排前后对比，用于 Playground 展示顺序变化 */
  rankChanges: Array<{ chunkId: string; sourceRef: string; originalRank: number; newRank: number; delta: number }>;
  method: string;
  warnings: string[];
}

// ─── score-only ───────────────────────────────────────────────────────────────

function rerankScoreOnly(matches: FilteredChunk[], topN: number): RerankOutput {
  const ranked = matches
    .slice(0, topN)
    .map((m, i) => ({ ...m, rerankScore: m.score, originalRank: m.filteredRank, newRank: i + 1 }));

  return {
    rankedMatches: ranked,
    rankChanges: ranked.map((r) => ({ chunkId: r.chunkId, sourceRef: r.sourceRef, originalRank: r.originalRank, newRank: r.newRank, delta: r.originalRank - r.newRank })),
    method: "score-only",
    warnings: [],
  };
}

// ─── metadata-boost ───────────────────────────────────────────────────────────

/**
 * 关键词提升：计算 chunk 的 sourceRef 和 text 中与 query 关键词的重叠度，
 * 加权叠加到原始分数上。
 * 参数：boostWeight 控制加权幅度（默认 0.2，即原分 + 0.2 * 关键词重叠比例）。
 */
function rerankMetadataBoost(
  matches: FilteredChunk[],
  query: string,
  topN: number
): RerankOutput {
  // 提取 query 关键词（去停用词）
  const qTokens = new Set(
    query.toLowerCase()
      .split(/[\s，。？！、；：\?!,.:;()\n]+/)
      .filter((t) => t.length >= 2)
  );

  const scored = matches.map((m, originalIdx) => {
    const source = m.sourceRef.toLowerCase();
    const text = m.text.toLowerCase();
    const hits = [...qTokens].filter((t) => source.includes(t) || text.includes(t)).length;
    const boost = qTokens.size > 0 ? hits / qTokens.size : 0;
    return { ...m, rerankScore: parseFloat((m.score + 0.2 * boost).toFixed(4)), originalRank: originalIdx + 1 };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  const ranked = scored.slice(0, topN).map((m, i) => ({ ...m, newRank: i + 1 }));

  return {
    rankedMatches: ranked,
    rankChanges: ranked.map((r) => ({ chunkId: r.chunkId, sourceRef: r.sourceRef, originalRank: r.originalRank, newRank: r.newRank, delta: r.originalRank - r.newRank })),
    method: "metadata-boost",
    warnings: [],
  };
}

// ─── hf-tei-rerank ────────────────────────────────────────────────────────────

/**
 * HuggingFace TEI Cross-encoder Rerank。
 * TEI /rerank endpoint 接受：{ query: string, texts: string[], raw_scores?: boolean }
 * 返回：Array<{ index: number, score: number }>，按 score 降序。
 *
 * 部署示例：
 *   docker run -p 8080:80 ghcr.io/huggingface/text-embeddings-inference:cpu-1.5 \
 *     --model-id BAAI/bge-reranker-base
 */
async function rerankHFTEI(
  matches: FilteredChunk[],
  query: string,
  topN: number,
  paramEndpoint?: string
): Promise<RerankOutput> {
  const endpoint = (paramEndpoint?.trim() || process.env.HF_TEI_ENDPOINT)?.replace(/\/$/, "");
  if (!endpoint) throw new Error("缺少 TEI Endpoint：请在表单中填写或设置 HF_TEI_ENDPOINT 环境变量");

  const texts = matches.map((m) => m.text);
  const resp = await fetch(`${endpoint}/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, texts }),
  });
  if (!resp.ok) throw new Error(`TEI rerank 错误 ${resp.status}: ${await resp.text()}`);

  const data = await resp.json() as Array<{ index: number; score: number }>;
  // TEI 按 score 降序返回
  const ranked = data.slice(0, topN).map((item, newIdx) => ({
    ...matches[item.index],
    rerankScore: parseFloat(item.score.toFixed(4)),
    originalRank: matches[item.index].filteredRank,
    newRank: newIdx + 1,
  }));

  return {
    rankedMatches: ranked,
    rankChanges: ranked.map((r) => ({ chunkId: r.chunkId, sourceRef: r.sourceRef, originalRank: r.originalRank, newRank: r.newRank, delta: r.originalRank - r.newRank })),
    method: "hf-tei-rerank",
    warnings: [],
  };
}

// ─── llm-relevance-rerank ─────────────────────────────────────────────────────

/**
 * 让 LLM 对每个 chunk 的回答 query 的相关性打 1-10 分。
 * 每个 chunk 独立一次 API 调用，用 Structured Output（JSON mode）确保格式。
 *
 * 适用场景：topN <= 5 的精排，质量最高但成本最高。
 */
async function rerankLLMRelevance(
  matches: FilteredChunk[],
  query: string,
  topN: number,
  model: string,
  criteria: string,
  paramApiKey?: string
): Promise<RerankOutput> {
  const { client } = await createLLMClient(paramApiKey);

  const criteriaContext = criteria ? `\n额外评判标准：${criteria}` : "";
  const systemPrompt = `你是 RAG 检索质量评估员。
给定一个用户查询和一段文档内容，评估该内容对回答查询的相关性，输出 JSON：{"score": <1-10>, "reason": "<一句话说明>"}
评分标准：1-3 完全不相关，4-6 部分相关，7-9 相关，10 完全匹配${criteriaContext}
只输出 JSON，不要任何其他内容。`;

  const scored = await Promise.all(
    matches.map(async (m, idx) => {
      try {
        const resp = await client.chat.completions.create({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `查询：${query}\n\n文档内容：${m.text.slice(0, 500)}` },
          ],
        });
        const raw = JSON.parse(resp.choices[0].message.content ?? "{}") as { score?: number };
        return { ...m, rerankScore: (raw.score ?? 5) / 10, originalRank: idx + 1 };
      } catch {
        return { ...m, rerankScore: m.score, originalRank: idx + 1 };
      }
    })
  );

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  const ranked = scored.slice(0, topN).map((m, i) => ({ ...m, newRank: i + 1 }));

  return {
    rankedMatches: ranked,
    rankChanges: ranked.map((r) => ({ chunkId: r.chunkId, sourceRef: r.sourceRef, originalRank: r.originalRank, newRank: r.newRank, delta: r.originalRank - r.newRank })),
    method: "llm-relevance-rerank",
    warnings: [`llm-relevance-rerank 消耗 ${matches.length} 次 API 调用`],
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown>; upstreamOutput: FilterOutput | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Filter 产物，请先运行 Filter Stage" } },
      { status: 400 }
    );
  }

  const matches = upstreamOutput.filteredMatches ?? [];
  if (matches.length === 0) {
    return NextResponse.json({ error: { code: "empty_matches", message: "Filter 未产出任何候选 chunk" } }, { status: 400 });
  }

  // query 从 params 里获取（由 PlaygroundShell 无法自动传递，需要用户在 rerank params 里填写或复用 query-rewrite output）
  // query 优先从上游透传的 originalQuery 读取（retrieval → filter → rerank 链自动传递），
  // params.query 作为用户手动覆盖入口（直接运行 rerank 时使用）
  const query = (upstreamOutput.originalQuery ?? String(params.query ?? "")).trim();

  const topN = Number(params.rerankTopN ?? 5);

  try {
    let result: RerankOutput;

    switch (methodId) {
      case "score-only":
        result = rerankScoreOnly(matches, topN);
        break;
      case "metadata-boost":
        result = rerankMetadataBoost(matches, query, topN);
        break;
      case "hf-tei-rerank":
        if (!query) return NextResponse.json({ error: { code: "missing_query", message: "hf-tei-rerank 需要 query 参数，请在 filter/rerank 表单中填写" } }, { status: 400 });
        result = await rerankHFTEI(matches, query, topN, typeof params.endpoint === "string" ? params.endpoint : undefined);
        break;
      case "llm-relevance-rerank":
        if (!query) return NextResponse.json({ error: { code: "missing_query", message: "llm-relevance-rerank 需要 query 参数，请在表单中填写" } }, { status: 400 });
        result = await rerankLLMRelevance(
          matches, query, topN,
          String(params.model ?? "gpt-4o-mini"),
          String(params.criteria ?? ""),
          typeof params.apiKey === "string" ? params.apiKey : undefined
        );
        break;
      default:
        return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
    }

    return NextResponse.json({
      output: { ...result, originalQuery: query },
      trace: { methodId, inputCount: matches.length, outputCount: result.rankedMatches.length, topN, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: { code: "rerank_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
