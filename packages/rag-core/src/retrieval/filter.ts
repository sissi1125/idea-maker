/**
 * RAG Pipeline Stage - Filter - 纯算法
 *
 * 4 method：
 *   score-threshold   按 minScore 下限 + maxPerDocument 上限
 *   metadata-filter   按 sourceRef 路径前缀白名单
 *   mmr-diversity     MMR + Jaccard 词集相似度
 *   pipeline-filter   Metadata → Score → MMR 串联（工业标准组合）
 *
 * 设计：纯函数，无 I/O。tokenizeToSet 来自 util/nlp（同包内）。
 */

import type {
  FilterInput,
  FilterOutput,
  FilterResult,
  FilteredChunk,
  MatchedChunk,
  RemovedChunk,
} from "@harness/shared-types";
import { tokenizeToSet } from "../util/nlp";

// ─── score-threshold ──────────────────────────────────────────────────────────

function filterByScore(
  matches: MatchedChunk[],
  minScore: number,
  maxPerDocument: number,
): FilterOutput {
  const kept: FilteredChunk[] = [];
  const removed: RemovedChunk[] = [];
  const perDocCount = new Map<string, number>();

  for (const m of matches) {
    if (m.score < minScore) {
      removed.push({
        chunkId: m.chunkId,
        text: m.text,
        score: m.score,
        reason: `score ${m.score.toFixed(3)} < minScore ${minScore}`,
      });
      continue;
    }
    const count = perDocCount.get(m.documentId) ?? 0;
    if (count >= maxPerDocument) {
      removed.push({
        chunkId: m.chunkId,
        text: m.text,
        score: m.score,
        reason: `文档 ${m.documentId} 已达 maxPerDocument 限制 ${maxPerDocument}`,
      });
      continue;
    }
    perDocCount.set(m.documentId, count + 1);
    kept.push({ ...m, filteredRank: kept.length + 1 });
  }

  return {
    filteredMatches: kept,
    removedMatches: removed,
    keptCount: kept.length,
    removedCount: removed.length,
    method: "score-threshold",
    warnings: [],
  };
}

// ─── metadata-filter ──────────────────────────────────────────────────────────

function filterByMetadata(
  matches: MatchedChunk[],
  requiredSourceTypes: string[],
  maxPerDocument: number,
): FilterOutput {
  const kept: FilteredChunk[] = [];
  const removed: RemovedChunk[] = [];
  const perDocCount = new Map<string, number>();

  for (const m of matches) {
    const passesSource =
      requiredSourceTypes.length === 0 ||
      requiredSourceTypes.some((t) => m.sourceRef.includes(t));

    if (!passesSource) {
      removed.push({
        chunkId: m.chunkId,
        text: m.text,
        score: m.score,
        reason: `sourceRef "${m.sourceRef}" 不在白名单 [${requiredSourceTypes.join(", ")}]`,
      });
      continue;
    }

    const count = perDocCount.get(m.documentId) ?? 0;
    if (count >= maxPerDocument) {
      removed.push({
        chunkId: m.chunkId,
        text: m.text,
        score: m.score,
        reason: `文档已达 maxPerDocument 限制`,
      });
      continue;
    }
    perDocCount.set(m.documentId, count + 1);
    kept.push({ ...m, filteredRank: kept.length + 1 });
  }

  return {
    filteredMatches: kept,
    removedMatches: removed,
    keptCount: kept.length,
    removedCount: removed.length,
    method: "metadata-filter",
    warnings: [],
  };
}

// ─── mmr-diversity ────────────────────────────────────────────────────────────

/**
 * Jaccard 词集重叠：|A ∩ B| / |A ∪ B|
 *
 * 用 jieba 分词替代空格切分，中文相似度计算才有意义。
 * removeStop=false：相似度计算保留所有词（停用词在两文本里都出现，不影响相对相似度）
 */
function jaccardOverlap(a: string, b: string): number {
  const setA = tokenizeToSet(a, false);
  const setB = tokenizeToSet(b, false);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * MMR 多样性：
 *   mmrScore = λ * normalize(score) - (1-λ) * max Jaccard(d, d') for d' in selected
 *   贪心选最大，达 maxPerDocument 或 matches 总数停止
 */
function filterByMMR(
  matches: MatchedChunk[],
  mmrLambda: number,
  maxPerDocument: number,
): FilterOutput {
  const selected: FilteredChunk[] = [];
  const remaining = [...matches];
  const perDocCount = new Map<string, number>();

  const maxScore = Math.max(...matches.map((m) => m.score), 1e-9);
  const normalize = (s: number) => s / maxScore;

  while (remaining.length > 0 && selected.length < matches.length) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const m = remaining[i];
      const docCount = perDocCount.get(m.documentId) ?? 0;
      if (docCount >= maxPerDocument) continue;

      const relevance = normalize(m.score);
      const maxSim =
        selected.length === 0 ? 0 : Math.max(...selected.map((s) => jaccardOverlap(m.text, s.text)));

      const mmr = mmrLambda * relevance - (1 - mmrLambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    perDocCount.set(chosen.documentId, (perDocCount.get(chosen.documentId) ?? 0) + 1);
    selected.push({ ...chosen, filteredRank: selected.length + 1 });
  }

  const removed: RemovedChunk[] = remaining.map((m) => ({
    chunkId: m.chunkId,
    text: m.text,
    score: m.score,
    reason: "MMR 多样性过滤移除",
  }));

  return {
    filteredMatches: selected,
    removedMatches: removed,
    keptCount: selected.length,
    removedCount: removed.length,
    method: "mmr-diversity",
    warnings: [],
  };
}

// ─── pipeline-filter（Metadata → Score → MMR）─────────────────────────────────

function filterCombined(
  matches: MatchedChunk[],
  requiredSourceTypes: string[],
  minScore: number,
  maxPerDocument: number,
  finalTopK: number,
  mmrLambda: number,
): FilterOutput {
  const allRemoved: RemovedChunk[] = [];

  // Step 1: Metadata
  let current = matches;
  if (requiredSourceTypes.length > 0) {
    const r1 = filterByMetadata(current, requiredSourceTypes, Infinity);
    allRemoved.push(...r1.removedMatches.map((c) => ({ ...c, reason: `[metadata] ${c.reason}` })));
    current = r1.filteredMatches;
  }
  const afterMetadata = current.length;

  // Step 2: Score Threshold
  const r2 = filterByScore(current, minScore, maxPerDocument);
  allRemoved.push(...r2.removedMatches.map((c) => ({ ...c, reason: `[score] ${c.reason}` })));
  current = r2.filteredMatches;
  const afterScore = current.length;

  // Step 3: MMR 贪心选 finalTopK
  const warnings: string[] = [];
  const selected: FilteredChunk[] = [];
  const remaining = [...current];
  const maxScoreLocal = Math.max(...current.map((m) => m.score), 1e-9);
  const normalize = (s: number) => s / maxScoreLocal;
  const perDocCount = new Map<string, number>();

  while (remaining.length > 0 && selected.length < finalTopK) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const m = remaining[i];
      if ((perDocCount.get(m.documentId) ?? 0) >= maxPerDocument) continue;
      const relevance = normalize(m.score);
      const maxSim =
        selected.length === 0 ? 0 : Math.max(...selected.map((s) => jaccardOverlap(m.text, s.text)));
      const mmr = mmrLambda * relevance - (1 - mmrLambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const chosen = remaining.splice(bestIdx, 1)[0];
    perDocCount.set(chosen.documentId, (perDocCount.get(chosen.documentId) ?? 0) + 1);
    selected.push({ ...chosen, filteredRank: selected.length + 1 });
  }

  allRemoved.push(
    ...remaining.map((m) => ({
      chunkId: m.chunkId,
      text: m.text,
      score: m.score,
      reason: "[mmr] MMR 多样性过滤移除",
    })),
  );
  const afterMMR = selected.length;

  if (afterMetadata === 0 && requiredSourceTypes.length > 0)
    warnings.push("Metadata 过滤后无结果，请检查 requiredSourceTypes 是否与文档章节匹配");
  if (afterScore === 0) warnings.push("Score 过滤后无结果，建议降低 minScore");
  if (afterMMR === 0) warnings.push("MMR 过滤后无结果");

  return {
    filteredMatches: selected,
    removedMatches: allRemoved,
    keptCount: selected.length,
    removedCount: allRemoved.length,
    method: "pipeline-filter",
    warnings,
    pipelineSteps: { afterMetadata, afterScore, afterMMR },
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export function runFilter(input: FilterInput): FilterResult {
  const { methodId, params, upstreamMatches, originalQuery, upstreamWarnings } = input;
  const warnings: string[] = [...(upstreamWarnings ?? [])];

  let result: FilterOutput;

  switch (methodId) {
    case "metadata-filter":
      result = filterByMetadata(upstreamMatches, params.requiredSourceTypes, params.maxPerDocument);
      break;
    case "mmr-diversity":
      result = filterByMMR(upstreamMatches, params.mmrLambda, params.maxPerDocument);
      break;
    case "pipeline-filter":
      result = filterCombined(
        upstreamMatches,
        params.requiredSourceTypes,
        params.minScore,
        params.maxPerDocument,
        params.finalTopK,
        params.mmrLambda,
      );
      break;
    case "score-threshold":
    default:
      result = filterByScore(upstreamMatches, params.minScore, params.maxPerDocument);
      break;
  }

  if (result.keptCount === 0) {
    warnings.push("过滤后无结果，建议降低 minScore 或放宽 metadata 过滤条件");
  }

  return {
    output: { ...result, originalQuery, warnings: [...warnings, ...result.warnings] },
    trace: {
      methodId,
      inputCount: upstreamMatches.length,
      keptCount: result.keptCount,
      removedCount: result.removedCount,
      ...(result.pipelineSteps && { pipelineSteps: result.pipelineSteps }),
    },
    warnings: [...warnings, ...result.warnings],
  };
}
