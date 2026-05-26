/**
 * RAG Pipeline Stage - Multi-Recall Merge - 纯算法
 *
 * 2 method：
 *   rrf-merge    Reciprocal Rank Fusion：按 retrievalMethod 分组重排 → RRF
 *                经典融合算法，IR 领域 1990s 提出，对多路结果稳定有效
 *   score-merge  Min-Max 归一化 + 同 chunkId 取最高分 + 排序
 *                适合不同量纲分数（cosine 0-1 vs BM25 0-10）
 *
 * 纯函数，无 I/O，无注入。
 */

import type {
  MatchedChunk,
  MultiRecallMergeInput,
  MultiRecallMergeOutput,
  MultiRecallMergeResult,
} from "@harness/shared-types";

// ─── rrf-merge ────────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion：每个 chunk 在某路结果中的 RRF 分数 = 1 / (k + rank)。
 * 多路相加，sort 取 topK。
 * k=60 是业界经验值（Microsoft / Vespa / OpenSearch 默认）。
 */
function rrfMerge(allMatches: MatchedChunk[], k: number, topK: number): MatchedChunk[] {
  const groups = new Map<string, MatchedChunk[]>();
  for (const m of allMatches) {
    const grp = m.retrievalMethod || "default";
    if (!groups.has(grp)) groups.set(grp, []);
    groups.get(grp)!.push(m);
  }

  // 各组内分数降序
  for (const grp of groups.values()) {
    grp.sort((a, b) => b.score - a.score);
  }

  const rrfScores = new Map<string, number>();
  const chunkMap = new Map<string, MatchedChunk>();

  for (const grp of groups.values()) {
    grp.forEach((m, idx) => {
      rrfScores.set(m.chunkId, (rrfScores.get(m.chunkId) ?? 0) + 1 / (k + idx + 1));
      if (!chunkMap.has(m.chunkId)) chunkMap.set(m.chunkId, m);
    });
  }

  return [...rrfScores.entries()]
    .map(([id, rrf]) => ({
      ...chunkMap.get(id)!,
      score: parseFloat(rrf.toFixed(6)),
      retrievalMethod: "rrf-merged",
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── score-merge ──────────────────────────────────────────────────────────────

function scoreMerge(allMatches: MatchedChunk[], topK: number): MatchedChunk[] {
  if (allMatches.length === 0) return [];

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
      normalized.push({
        ...m,
        score: parseFloat(((m.score - minS) / range).toFixed(4)),
        retrievalMethod: "score-merged",
      });
    }
  }

  // 同 chunkId 取最高分
  const best = new Map<string, MatchedChunk>();
  for (const m of normalized) {
    const ex = best.get(m.chunkId);
    if (!ex || m.score > ex.score) best.set(m.chunkId, m);
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export function runMultiRecallMerge(input: MultiRecallMergeInput): MultiRecallMergeResult {
  const { methodId, params, upstream, additionalMatches } = input;

  const primaryMatches = upstream.matches ?? [];
  const extras = additionalMatches ?? [];
  const allMatches = [...primaryMatches, ...extras];

  const warnings: string[] = [...(upstream.warnings ?? [])];
  if (extras.length > 0) {
    warnings.push(
      `已合并主路 ${primaryMatches.length} 条 + 附加路 ${extras.length} 条，共 ${allMatches.length} 条候选`,
    );
  } else {
    warnings.push(
      "仅有一路检索结果，multi-recall-merge 退化为重新排序；如需多路融合，通过 additionalMatches 传入第二路结果",
    );
  }

  let mergedMatches: MatchedChunk[];
  switch (methodId) {
    case "score-merge":
      mergedMatches = scoreMerge(allMatches, params.topK);
      break;
    case "rrf-merge":
    default:
      mergedMatches = rrfMerge(allMatches, params.k, params.topK);
      break;
  }

  const deduplicatedCount = allMatches.length - mergedMatches.length;

  const output: MultiRecallMergeOutput = {
    originalQuery: upstream.originalQuery,
    queries: upstream.queries,
    matches: mergedMatches,
    totalMatches: mergedMatches.length,
    deduplicatedCount,
    method: methodId,
    warnings,
  };

  return {
    output,
    trace: {
      methodId,
      inputCount: allMatches.length,
      outputCount: mergedMatches.length,
      deduplicatedCount,
    },
    warnings,
  };
}
