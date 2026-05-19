/**
 * RAG Pipeline Stage — Multi-Recall Merge（多路召回合并 / 去重）
 *
 * 作用：当来自不同检索策略或不同知识库的多路结果需要合并时，
 *       执行去重、分数归一化和融合排序，输出统一的候选集合。
 *
 * Pipeline 位置：
 *   Retrieval → [Multi-Recall Merge] → Filter → Rerank → Citation
 *
 * 触发条件：
 *   conditional 步骤，runtimeContext.multipleRetrievalSources = true 时激活，
 *   也可手动开启对当前检索结果做额外的去重/归一化处理。
 *
 * 两种方法：
 *
 *   rrf-merge     对输入的 matches 按来源分组，重新应用 RRF 融合
 *                 适合：同一 query 通过不同方法（dense + fulltext）检索后合并
 *                 输入可以通过 params.additionalMatches 追加第二路结果
 *
 *   score-merge   Min-Max 归一化后线性融合分数，去重后排序
 *                 适合：分数量纲不同的多路结果（如 cosine 0-1 vs BM25 0-10）
 */

import { NextRequest, NextResponse } from "next/server";
import type { RetrievalOutput, MatchedChunk } from "../retrieval/route";

// ─── rrf-merge ────────────────────────────────────────────────────────────────

/**
 * 把 matches 按 retrievalMethod 分组，在每组内重新排名，然后用 RRF 融合。
 * 如果所有 chunk 来自同一方法（如都是 dense），则退化为简单排序（仍然有效）。
 */
function rrfMerge(
  allMatches: MatchedChunk[],
  k: number,
  topK: number
): MatchedChunk[] {
  // 按 method 分组
  const groups = new Map<string, MatchedChunk[]>();
  for (const m of allMatches) {
    const grp = m.retrievalMethod || "default";
    if (!groups.has(grp)) groups.set(grp, []);
    groups.get(grp)!.push(m);
  }

  // 各组内排序（分数降序）
  for (const grp of groups.values()) {
    grp.sort((a, b) => b.score - a.score);
  }

  // RRF 融合
  const rrfScores = new Map<string, number>();
  const chunkMap = new Map<string, MatchedChunk>();

  for (const grp of groups.values()) {
    grp.forEach((m, idx) => {
      rrfScores.set(m.chunkId, (rrfScores.get(m.chunkId) ?? 0) + 1 / (k + idx + 1));
      if (!chunkMap.has(m.chunkId)) chunkMap.set(m.chunkId, m);
    });
  }

  return [...rrfScores.entries()]
    .map(([id, rrf]) => ({ ...chunkMap.get(id)!, score: parseFloat(rrf.toFixed(6)), retrievalMethod: "rrf-merged" }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── score-merge ──────────────────────────────────────────────────────────────

/**
 * Min-Max 归一化各路结果的分数，然后按归一化分数合并去重。
 * 同一 chunk 出现在多路结果时取最高归一化分数。
 */
function scoreMerge(
  allMatches: MatchedChunk[],
  topK: number
): MatchedChunk[] {
  if (allMatches.length === 0) return [];

  // 按 method 分组归一化
  const groups = new Map<string, MatchedChunk[]>();
  for (const m of allMatches) {
    const grp = m.retrievalMethod || "default";
    if (!groups.has(grp)) groups.set(grp, []);
    groups.get(grp)!.push(m);
  }

  const normalized: MatchedChunk[] = [];
  for (const grp of groups.values()) {
    const minS = Math.min(...grp.map((m) => m.score));
    const maxS = Math.max(...grp.map((m) => m.score));
    const range = maxS - minS || 1;
    for (const m of grp) {
      normalized.push({ ...m, score: parseFloat(((m.score - minS) / range).toFixed(4)), retrievalMethod: "score-merged" });
    }
  }

  // 去重：同 chunkId 取最高分
  const best = new Map<string, MatchedChunk>();
  for (const m of normalized) {
    const ex = best.get(m.chunkId);
    if (!ex || m.score > ex.score) best.set(m.chunkId, m);
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown>; upstreamOutput: RetrievalOutput | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Retrieval 产物，请先运行 Retrieval Stage" } },
      { status: 400 }
    );
  }

  // 支持通过 params.additionalMatches 注入第二路检索结果（JSON 数组）
  const primaryMatches = upstreamOutput.matches ?? [];
  const additionalRaw = Array.isArray(params.additionalMatches) ? params.additionalMatches as MatchedChunk[] : [];
  const allMatches = [...primaryMatches, ...additionalRaw];

  const topK = Number(params.topK ?? 10);
  const k = Number(params.k ?? 60);
  const warnings: string[] = [...(upstreamOutput.warnings ?? [])];

  if (additionalRaw.length > 0) {
    warnings.push(`已合并主路 ${primaryMatches.length} 条 + 附加路 ${additionalRaw.length} 条，共 ${allMatches.length} 条候选`);
  } else {
    warnings.push("仅有一路检索结果，multi-recall-merge 退化为重新排序；如需多路融合，通过 params.additionalMatches 传入第二路结果");
  }

  let mergedMatches: MatchedChunk[];

  switch (methodId) {
    case "rrf-merge":
      mergedMatches = rrfMerge(allMatches, k, topK);
      break;
    case "score-merge":
      mergedMatches = scoreMerge(allMatches, topK);
      break;
    default:
      return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
  }

  const deduplicatedCount = allMatches.length - mergedMatches.length;

  return NextResponse.json({
    output: {
      originalQuery: upstreamOutput.originalQuery,
      queries: upstreamOutput.queries,
      matches: mergedMatches,
      totalMatches: mergedMatches.length,
      deduplicatedCount,
      method: methodId,
      warnings,
    },
    trace: { methodId, inputCount: allMatches.length, outputCount: mergedMatches.length, deduplicatedCount, durationMs: Date.now() - startMs },
    durationMs: Date.now() - startMs,
    warnings,
  });
}
