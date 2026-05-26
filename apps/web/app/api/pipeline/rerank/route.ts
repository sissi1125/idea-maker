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
import { tokenizeToSet } from "@harness/rag-core";

// jieba 单例、停用词表、分词逻辑统一在 lib/nlp.ts 管理，此处直接使用封装函数。
// 不再本地维护副本，避免三份停用词表发散的历史问题。

/**
 * 提取 query 中的有效关键词 token 集合（用于 Metadata Boost 关键词匹配）。
 * 委托给 lib/nlp.ts 的 tokenizeToSet，确保与其他 stage 使用相同的分词逻辑。
 */
function extractQueryTokens(query: string): Set<string> {
  return tokenizeToSet(query);
}

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
 *
 * ⚠️ 架构局限性（已知）：
 *   此方法的 boost 基于分数偏移（score += weight * overlap），适合分数分布均匀的场景
 *   （如余弦相似度 0.3-0.8）。若下游接 cross-encoder reranker（score 极度集中，
 *   top-1 可能 0.9+，其余 <0.01），boost 的微小偏移无法翻转排名。
 *   在 pipeline-rerank 中，boost 的核心价值在于预筛选（boostPassN 截断）而非分数混合。
 */
function rerankMetadataBoost(
  matches: FilteredChunk[],
  query: string,
  topN: number
): RerankOutput {
  // 使用 jieba 分词提取关键词，支持中英文混合 query（见模块顶部 extractQueryTokens）
  const qTokens = extractQueryTokens(query);

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

  // 收集每个 LLM 调用的失败信息，供调用方感知（而非静默降级）
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
        const raw = JSON.parse(resp.choices[0].message.content ?? "{}") as { score?: number };
        return { ...m, rerankScore: (raw.score ?? 5) / 10, originalRank: idx + 1 };
      } catch (err) {
        // LLM 调用失败时降级为原始分数，并记录具体错误（而非静默失败）
        const msg = `llm-relevance-rerank chunk[${idx}] 失败，已降级为原始分数: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`;
        llmFailures.push(msg);
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
    warnings: [`llm-relevance-rerank 消耗 ${matches.length} 次 API 调用`, ...llmFailures],
  };
}

// ─── pipeline-rerank（组合：Metadata Boost → HF-TEI）──────────────────────────

/**
 * 两步串联重排，对应工业实践中的轻量级 + 精准模型组合策略：
 *
 *   Step 1: Metadata Boost  — 规则层：根据 sourceRef/关键词给 chunk 加权，快速提升有结构信号的结果
 *   Step 2: HF-TEI Rerank   — 模型层：Cross-encoder 精排，只对 boost 后前 boostPassN 个 chunk 打分
 *
 * 设计意图：
 *   - Metadata Boost 成本为零，把"肯定相关"的章节先提到前排
 *   - TEI Rerank 精度高但有延迟，限制输入量（boostPassN）控制耗时
 *   - 两步结合比单独 TEI Rerank 更快，比单独 Boost 更准
 *
 * trace 记录 boost 后和 TEI 后各自的排名，方便对比两步的贡献。
 */
async function rerankCombined(
  matches: FilteredChunk[],
  query: string,
  topN: number,
  boostPassN: number,
  paramEndpoint?: string
): Promise<RerankOutput & { pipelineSteps: { afterBoost: number; sentToTEI: number } }> {
  // ── Step 1: Metadata Boost ────────────────────────────────────────────────
  // 使用 jieba 分词（见模块顶部 extractQueryTokens），解决中文整句无法切分的问题
  const qTokens = extractQueryTokens(query);

  const boosted = matches.map((m, idx) => {
    const source = m.sourceRef.toLowerCase();
    const text = m.text.toLowerCase();
    const hits = [...qTokens].filter((t) => source.includes(t) || text.includes(t)).length;
    const boost = qTokens.size > 0 ? hits / qTokens.size : 0;
    return { ...m, boostedScore: parseFloat((m.score + 0.2 * boost).toFixed(4)), originalFilterRank: idx + 1 };
  });

  boosted.sort((a, b) => b.boostedScore - a.boostedScore);
  const afterBoost = boosted.length;

  // ── Step 2: HF-TEI Rerank（只处理 boost 后前 boostPassN 个）─────────────
  const candidates = boosted.slice(0, boostPassN);
  const sentToTEI = candidates.length;

  const endpoint = (paramEndpoint?.trim() || process.env.HF_TEI_ENDPOINT)?.replace(/\/$/, "");
  if (!endpoint) throw new Error("缺少 TEI Endpoint：请在表单中填写或设置 HF_TEI_ENDPOINT 环境变量");

  const resp = await fetch(`${endpoint}/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, texts: candidates.map((c) => c.text) }),
  });
  if (!resp.ok) throw new Error(`TEI rerank 错误 ${resp.status}: ${await resp.text()}`);

  const data = await resp.json() as Array<{ index: number; score: number }>;
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
    rankChanges: ranked.map((r) => ({
      chunkId: r.chunkId,
      sourceRef: r.sourceRef,
      originalRank: r.originalRank,
      newRank: r.newRank,
      delta: r.originalRank - r.newRank,
    })),
    method: "pipeline-rerank",
    warnings: [`Metadata Boost 后取前 ${sentToTEI} 个送入 TEI，最终返回 top-${ranked.length}`],
    pipelineSteps: { afterBoost, sentToTEI },
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
      case "pipeline-rerank": {
        if (!query) return NextResponse.json({ error: { code: "missing_query", message: "pipeline-rerank 需要 query，请确保上游 originalQuery 已透传" } }, { status: 400 });
        const boostPassN = Number(params.boostPassN ?? Math.min(matches.length, 20));
        const combined = await rerankCombined(
          matches, query, topN, boostPassN,
          typeof params.endpoint === "string" ? params.endpoint : undefined
        );
        result = combined;
        return NextResponse.json({
          output: { ...result, originalQuery: query },
          trace: { methodId, inputCount: matches.length, outputCount: result.rankedMatches.length, topN, pipelineSteps: combined.pipelineSteps, durationMs: Date.now() - startMs },
          durationMs: Date.now() - startMs,
          warnings: result.warnings,
        });
      }
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
