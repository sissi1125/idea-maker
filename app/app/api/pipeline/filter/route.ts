/**
 * RAG Pipeline Stage — Filter（过滤）
 *
 * 作用：从 retrieval 的候选 chunk 集合中，按规则移除低质量或冗余结果，
 *       减少送入 rerank 和 LLM 的 token 数量，同时提高精度。
 *
 * Pipeline 位置：
 *   Retrieval → [Filter] → Rerank → Citation
 *
 * 三种方法：
 *
 *   score-threshold     按相似度分数下限过滤 + 每文档保留上限
 *                       最简单高效，适合 dense-vector 检索结果
 *
 *   metadata-filter     按 sourceRef（章节路径）类型白名单过滤
 *                       当文档有明确结构时，可以只保留特定章节的内容
 *
 *   mmr-diversity       Maximal Marginal Relevance 多样性过滤
 *                       同时考虑相关性（分数）和与已选内容的差异性
 *                       目标：避免返回内容高度重复的 chunk，提升 LLM context 的信息密度
 *
 * MMR 算法：
 *   score_mmr = λ * score(d, q) - (1-λ) * max_{d'∈S} overlap(d, d')
 *   每轮选择 score_mmr 最大的 chunk 加入结果集 S，直到达到 maxPerDocument 限制。
 *   overlap 用 Jaccard 词重叠代替向量余弦（避免依赖向量数据）。
 */

import { NextRequest, NextResponse } from "next/server";
import type { RetrievalOutput, MatchedChunk } from "../retrieval/route";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface FilteredChunk extends MatchedChunk {
  /** 过滤后的排名（从 1 开始） */
  filteredRank: number;
}

export interface RemovedChunk {
  chunkId: string;
  text: string;
  score: number;
  reason: string;
}

export interface FilterOutput {
  filteredMatches: FilteredChunk[];
  removedMatches: RemovedChunk[];
  keptCount: number;
  removedCount: number;
  method: string;
  warnings: string[];
}

// ─── score-threshold ──────────────────────────────────────────────────────────

function filterByScore(
  matches: MatchedChunk[],
  minScore: number,
  maxPerDocument: number
): FilterOutput {
  const kept: FilteredChunk[] = [];
  const removed: RemovedChunk[] = [];
  const perDocCount = new Map<string, number>();

  for (const m of matches) {
    if (m.score < minScore) {
      removed.push({ chunkId: m.chunkId, text: m.text, score: m.score, reason: `score ${m.score.toFixed(3)} < minScore ${minScore}` });
      continue;
    }
    const count = perDocCount.get(m.documentId) ?? 0;
    if (count >= maxPerDocument) {
      removed.push({ chunkId: m.chunkId, text: m.text, score: m.score, reason: `文档 ${m.documentId} 已达 maxPerDocument 限制 ${maxPerDocument}` });
      continue;
    }
    perDocCount.set(m.documentId, count + 1);
    kept.push({ ...m, filteredRank: kept.length + 1 });
  }

  return { filteredMatches: kept, removedMatches: removed, keptCount: kept.length, removedCount: removed.length, method: "score-threshold", warnings: [] };
}

// ─── metadata-filter ──────────────────────────────────────────────────────────

/**
 * 按 sourceRef 白名单过滤。
 * requiredSourceTypes 是路径前缀列表，例如 ["产品介绍", "核心功能"]。
 * chunk 的 sourceRef 包含任意一个前缀则保留。
 * 空列表 = 不按来源过滤（只做 maxPerDocument 限制）。
 */
function filterByMetadata(
  matches: MatchedChunk[],
  requiredSourceTypes: string[],
  maxPerDocument: number
): FilterOutput {
  const kept: FilteredChunk[] = [];
  const removed: RemovedChunk[] = [];
  const perDocCount = new Map<string, number>();

  for (const m of matches) {
    const passesSource = requiredSourceTypes.length === 0 ||
      requiredSourceTypes.some((t) => m.sourceRef.includes(t));

    if (!passesSource) {
      removed.push({ chunkId: m.chunkId, text: m.text, score: m.score, reason: `sourceRef "${m.sourceRef}" 不在白名单 [${requiredSourceTypes.join(", ")}]` });
      continue;
    }

    const count = perDocCount.get(m.documentId) ?? 0;
    if (count >= maxPerDocument) {
      removed.push({ chunkId: m.chunkId, text: m.text, score: m.score, reason: `文档已达 maxPerDocument 限制` });
      continue;
    }
    perDocCount.set(m.documentId, count + 1);
    kept.push({ ...m, filteredRank: kept.length + 1 });
  }

  return { filteredMatches: kept, removedMatches: removed, keptCount: kept.length, removedCount: removed.length, method: "metadata-filter", warnings: [] };
}

// ─── mmr-diversity ────────────────────────────────────────────────────────────

/**
 * Jaccard 词集重叠度：|A ∩ B| / |A ∪ B|
 * 替代向量余弦相似度，不需要原始 embedding。
 */
function jaccardOverlap(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/[\s，。？！、；：\?!,.:;()\n]+/).filter((t) => t.length > 1));
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * MMR 多样性过滤。
 * 每轮迭代选出 MMR 分数最高的 chunk 加入结果集 S。
 * mmrScore = λ * score(d) - (1-λ) * max_{d'∈S} Jaccard(d, d')
 * λ 越大越偏向相关性，越小越偏向多样性。
 */
function filterByMMR(
  matches: MatchedChunk[],
  mmrLambda: number,
  maxPerDocument: number
): FilterOutput {
  const warnings: string[] = [];
  const selected: FilteredChunk[] = [];
  const remaining = [...matches];
  const perDocCount = new Map<string, number>();

  // 归一化分数到 [0,1]
  const maxScore = Math.max(...matches.map((m) => m.score), 1e-9);
  const normalize = (s: number) => s / maxScore;

  while (remaining.length > 0 && selected.length < matches.length) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const m = remaining[i];
      const docCount = perDocCount.get(m.documentId) ?? 0;
      if (docCount >= maxPerDocument) continue; // 已达每文档上限

      const relevance = normalize(m.score);
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((s) => jaccardOverlap(m.text, s.text)));

      const mmr = mmrLambda * relevance - (1 - mmrLambda) * maxSim;
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }

    if (bestIdx === -1) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    perDocCount.set(chosen.documentId, (perDocCount.get(chosen.documentId) ?? 0) + 1);
    selected.push({ ...chosen, filteredRank: selected.length + 1 });
  }

  const removed: RemovedChunk[] = remaining.map((m) => ({
    chunkId: m.chunkId, text: m.text, score: m.score, reason: "MMR 多样性过滤移除",
  }));

  return { filteredMatches: selected, removedMatches: removed, keptCount: selected.length, removedCount: removed.length, method: "mmr-diversity", warnings };
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

  const matches = upstreamOutput.matches ?? [];
  const warnings: string[] = [...(upstreamOutput.warnings ?? [])];

  let result: FilterOutput;

  try {
    switch (methodId) {
      case "score-threshold":
        result = filterByScore(matches, Number(params.minScore ?? 0.6), Number(params.maxPerDocument ?? 3));
        break;
      case "metadata-filter": {
        const types = Array.isArray(params.requiredSourceTypes) ? params.requiredSourceTypes as string[] : [];
        result = filterByMetadata(matches, types, Number(params.maxPerDocument ?? 3));
        break;
      }
      case "mmr-diversity":
        result = filterByMMR(matches, Number(params.mmrLambda ?? 0.5), Number(params.maxPerDocument ?? 3));
        break;
      default:
        return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
    }

    if (result.keptCount === 0) warnings.push("过滤后无结果，建议降低 minScore 或放宽 metadata 过滤条件");

    return NextResponse.json({
      output: { ...result, warnings: [...warnings, ...result.warnings] },
      trace: { methodId, inputCount: matches.length, keptCount: result.keptCount, removedCount: result.removedCount, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: [...warnings, ...result.warnings],
    });
  } catch (err) {
    return NextResponse.json({ error: { code: "filter_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
