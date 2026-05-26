/**
 * RAG Pipeline Stage - Rerank - 纯算法 + 双 provider 注入
 *
 * 5 method：
 *   score-only            按 filter 分数排序
 *   metadata-boost        关键词重叠加权（规则）
 *   hf-tei-rerank         注入 hfTeiEndpoint，POST /rerank
 *   llm-relevance-rerank  注入 LLMChatClient，每 chunk 1-10 评分
 *                         **per-chunk 失败降级为原分**，不中断（其他 chunk 仍评）
 *   pipeline-rerank       Metadata Boost → TEI 两步（混合策略）
 *
 * 注入语义：
 *   tei 缺 endpoint → PipelineError(missing_endpoint)
 *   llm 缺 client   → PipelineError(missing_client)
 *   per-chunk LLM 失败 → 静默降级 + warning（不中断）
 */

import type {
  FilteredChunk,
  LLMChatClient,
  RankChange,
  RankedChunk,
  RerankInput,
  RerankOutput,
  RerankResult,
} from "@harness/shared-types";
import { PipelineError } from "../errors";
import { tokenizeToSet } from "../util/nlp";

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function extractQueryTokens(query: string): Set<string> {
  return tokenizeToSet(query);
}

function buildRankChanges(ranked: RankedChunk[]): RankChange[] {
  return ranked.map((r) => ({
    chunkId: r.chunkId,
    sourceRef: r.sourceRef,
    originalRank: r.originalRank,
    newRank: r.newRank,
    delta: r.originalRank - r.newRank,
  }));
}

// ─── score-only ───────────────────────────────────────────────────────────────

function rerankScoreOnly(matches: FilteredChunk[], topN: number): RerankOutput {
  const ranked: RankedChunk[] = matches.slice(0, topN).map((m, i) => ({
    ...m,
    rerankScore: m.score,
    originalRank: m.filteredRank,
    newRank: i + 1,
  }));

  return {
    rankedMatches: ranked,
    rankChanges: buildRankChanges(ranked),
    method: "score-only",
    warnings: [],
  };
}

// ─── metadata-boost ───────────────────────────────────────────────────────────

function rerankMetadataBoost(
  matches: FilteredChunk[],
  query: string,
  topN: number,
): RerankOutput {
  const qTokens = extractQueryTokens(query);

  const scored = matches.map((m, originalIdx) => {
    const source = m.sourceRef.toLowerCase();
    const text = m.text.toLowerCase();
    const hits = [...qTokens].filter((t) => source.includes(t) || text.includes(t)).length;
    const boost = qTokens.size > 0 ? hits / qTokens.size : 0;
    return {
      ...m,
      rerankScore: parseFloat((m.score + 0.2 * boost).toFixed(4)),
      originalRank: originalIdx + 1,
    };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  const ranked: RankedChunk[] = scored.slice(0, topN).map((m, i) => ({ ...m, newRank: i + 1 }));

  return {
    rankedMatches: ranked,
    rankChanges: buildRankChanges(ranked),
    method: "metadata-boost",
    warnings: [],
  };
}

// ─── hf-tei-rerank ────────────────────────────────────────────────────────────

async function rerankHFTEI(
  matches: FilteredChunk[],
  query: string,
  topN: number,
  endpoint: string,
): Promise<RerankOutput> {
  const normalized = endpoint.replace(/\/$/, "");
  const texts = matches.map((m) => m.text);
  const resp = await fetch(`${normalized}/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, texts }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new PipelineError("provider_error", `TEI rerank 错误 ${resp.status}: ${msg}`);
  }

  const data = (await resp.json()) as Array<{ index: number; score: number }>;
  // TEI 已按 score 降序
  const ranked: RankedChunk[] = data.slice(0, topN).map((item, newIdx) => ({
    ...matches[item.index],
    rerankScore: parseFloat(item.score.toFixed(4)),
    originalRank: matches[item.index].filteredRank,
    newRank: newIdx + 1,
  }));

  return {
    rankedMatches: ranked,
    rankChanges: buildRankChanges(ranked),
    method: "hf-tei-rerank",
    warnings: [],
  };
}

// ─── llm-relevance-rerank ─────────────────────────────────────────────────────

async function rerankLLMRelevance(
  matches: FilteredChunk[],
  query: string,
  topN: number,
  model: string,
  criteria: string,
  client: LLMChatClient,
): Promise<RerankOutput> {
  const criteriaContext = criteria ? `\n额外评判标准：${criteria}` : "";
  const systemPrompt = `你是 RAG 检索质量评估员。
给定一个用户查询和一段文档内容，评估该内容对回答查询的相关性，输出 JSON：{"score": <1-10>, "reason": "<一句话说明>"}
评分标准：1-3 完全不相关，4-6 部分相关，7-9 相关，10 完全匹配${criteriaContext}
只输出 JSON，不要任何其他内容。`;

  // per-chunk 失败收集（不中断整体）
  const llmFailures: string[] = [];

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
        const raw = JSON.parse(resp.choices[0]?.message?.content ?? "{}") as { score?: number };
        return {
          ...m,
          rerankScore: (raw.score ?? 5) / 10,
          originalRank: idx + 1,
        };
      } catch (err) {
        const msg = `llm-relevance-rerank chunk[${idx}] 失败，已降级为原始分数: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`;
        llmFailures.push(msg);
        return { ...m, rerankScore: m.score, originalRank: idx + 1 };
      }
    }),
  );

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  const ranked: RankedChunk[] = scored.slice(0, topN).map((m, i) => ({ ...m, newRank: i + 1 }));

  return {
    rankedMatches: ranked,
    rankChanges: buildRankChanges(ranked),
    method: "llm-relevance-rerank",
    warnings: [`llm-relevance-rerank 消耗 ${matches.length} 次 API 调用`, ...llmFailures],
  };
}

// ─── pipeline-rerank（Boost → TEI 组合）──────────────────────────────────────

async function rerankCombined(
  matches: FilteredChunk[],
  query: string,
  topN: number,
  boostPassN: number,
  endpoint: string,
): Promise<RerankOutput & { pipelineSteps: { afterBoost: number; sentToTEI: number } }> {
  // Step 1: Metadata Boost
  const qTokens = extractQueryTokens(query);
  const boosted = matches.map((m, idx) => {
    const source = m.sourceRef.toLowerCase();
    const text = m.text.toLowerCase();
    const hits = [...qTokens].filter((t) => source.includes(t) || text.includes(t)).length;
    const boost = qTokens.size > 0 ? hits / qTokens.size : 0;
    return {
      ...m,
      boostedScore: parseFloat((m.score + 0.2 * boost).toFixed(4)),
      originalFilterRank: idx + 1,
    };
  });
  boosted.sort((a, b) => b.boostedScore - a.boostedScore);
  const afterBoost = boosted.length;

  // Step 2: TEI（只处理 boost 后前 boostPassN）
  const candidates = boosted.slice(0, boostPassN);
  const sentToTEI = candidates.length;

  const normalized = endpoint.replace(/\/$/, "");
  const resp = await fetch(`${normalized}/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, texts: candidates.map((c) => c.text) }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new PipelineError("provider_error", `TEI rerank 错误 ${resp.status}: ${msg}`);
  }

  const data = (await resp.json()) as Array<{ index: number; score: number }>;
  const ranked: RankedChunk[] = data.slice(0, topN).map((item, newIdx) => {
    const chunk = candidates[item.index];
    return {
      ...chunk,
      rerankScore: parseFloat(item.score.toFixed(4)),
      originalRank: chunk.originalFilterRank,
      newRank: newIdx + 1,
    };
  });

  return {
    rankedMatches: ranked,
    rankChanges: buildRankChanges(ranked),
    method: "pipeline-rerank",
    warnings: [`Metadata Boost 后取前 ${sentToTEI} 个送入 TEI，最终返回 top-${ranked.length}`],
    pipelineSteps: { afterBoost, sentToTEI },
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runRerank(input: RerankInput): Promise<RerankResult> {
  const { methodId, params, upstreamMatches, upstreamQuery, hfTeiEndpoint, llmClient } = input;

  if (!upstreamMatches || upstreamMatches.length === 0) {
    throw new PipelineError("empty_matches", "Filter 未产出任何候选 chunk");
  }

  // query 优先来自上游 filter.originalQuery
  const query = (upstreamQuery ?? params.query).trim();

  let output: RerankOutput;
  let pipelineSteps: { afterBoost: number; sentToTEI: number } | undefined;

  switch (methodId) {
    case "metadata-boost":
      output = rerankMetadataBoost(upstreamMatches, query, params.rerankTopN);
      break;

    case "hf-tei-rerank": {
      const endpoint = params.endpoint?.trim() || hfTeiEndpoint;
      if (!endpoint) {
        throw new PipelineError(
          "missing_endpoint",
          "hf-tei-rerank 需要 TEI endpoint；请在表单填写或设置 HF_TEI_ENDPOINT",
        );
      }
      if (!query) {
        throw new PipelineError("missing_query", "hf-tei-rerank 需要 query 参数");
      }
      output = await rerankHFTEI(upstreamMatches, query, params.rerankTopN, endpoint);
      break;
    }

    case "llm-relevance-rerank": {
      if (!llmClient) {
        throw new PipelineError(
          "missing_client",
          "llm-relevance-rerank 需要注入 LLMChatClient；路由层应通过 createLLMClient 创建后传入",
        );
      }
      if (!query) {
        throw new PipelineError("missing_query", "llm-relevance-rerank 需要 query 参数");
      }
      output = await rerankLLMRelevance(
        upstreamMatches,
        query,
        params.rerankTopN,
        params.model,
        params.criteria,
        llmClient,
      );
      break;
    }

    case "pipeline-rerank": {
      const endpoint = params.endpoint?.trim() || hfTeiEndpoint;
      if (!endpoint) {
        throw new PipelineError(
          "missing_endpoint",
          "pipeline-rerank 需要 TEI endpoint；请在表单填写或设置 HF_TEI_ENDPOINT",
        );
      }
      if (!query) {
        throw new PipelineError("missing_query", "pipeline-rerank 需要 query");
      }
      const combined = await rerankCombined(
        upstreamMatches,
        query,
        params.rerankTopN,
        params.boostPassN,
        endpoint,
      );
      output = combined;
      pipelineSteps = combined.pipelineSteps;
      break;
    }

    case "score-only":
    default:
      output = rerankScoreOnly(upstreamMatches, params.rerankTopN);
      break;
  }

  return {
    output: { ...output, originalQuery: query },
    trace: {
      methodId,
      inputCount: upstreamMatches.length,
      outputCount: output.rankedMatches.length,
      topN: params.rerankTopN,
      ...(pipelineSteps && { pipelineSteps }),
    },
    warnings: output.warnings,
  };
}
