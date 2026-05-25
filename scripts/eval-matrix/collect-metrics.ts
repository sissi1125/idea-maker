import type { QueryMetrics } from "./types.js";

// stageOutputs 中每个值已经是提取后的 output 对象（非 { output: ... } 包装）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractQueryMetrics(stageOutputs: Record<string, any>, totalDurationMs: number): QueryMetrics {
  const evaluation = stageOutputs.evaluation;
  const retrieval = stageOutputs.retrieval;
  const generation = stageOutputs.generation;
  const citation = stageOutputs.citation;

  const hitRate = evaluation?.hitRate ?? null;
  const citationCoverage = evaluation?.citationCoverage ?? null;
  const confidenceScore = evaluation?.confidenceScore ?? null;

  const matches: { score: number }[] = retrieval?.matches ?? [];
  const retrievedCount = matches.length;
  const avgScore =
    retrievedCount > 0
      ? matches.reduce((sum: number, m: { score: number }) => sum + (m.score ?? 0), 0) / retrievedCount
      : null;

  // marketing-ideas 输出文本，其他方法输出结构化数组；用 citedEvidenceIds 数量作为通用指标
  const citedIds: unknown[] = generation?.citedEvidenceIds ?? generation?.ideas ?? [];
  const ideaCount = citedIds.length > 0 ? citedIds.length : null;

  // Citation 指标：实验四对比 chunk-citation / section-citation 三种模式的关键产物
  const contextText: string = citation?.contextText ?? "";
  const contextLength = contextText.length > 0 ? contextText.length : null;
  const evidencePack: unknown[] = citation?.evidencePack ?? [];
  const evidenceCount = evidencePack.length > 0 ? evidencePack.length : null;
  const avgEvidenceLength = contextLength !== null && evidenceCount !== null && evidenceCount > 0
    ? Math.round(contextLength / evidenceCount)
    : null;

  return {
    hitRate, citationCoverage, confidenceScore,
    retrievedCount, avgScore, ideaCount,
    contextLength, avgEvidenceLength, evidenceCount,
    durationMs: totalDurationMs,
  };
}

export function averageQueryMetrics(results: QueryMetrics[]): import("./types.js").TestCaseMetrics {
  const successful = results.filter((r) => r.hitRate !== null || r.retrievedCount > 0);
  const n = successful.length;

  function avg(vals: (number | null)[]): number | null {
    const defined = vals.filter((v): v is number => v !== null);
    return defined.length > 0 ? defined.reduce((a, b) => a + b, 0) / defined.length : null;
  }

  return {
    hitRate: avg(successful.map((r) => r.hitRate)),
    citationCoverage: avg(successful.map((r) => r.citationCoverage)),
    confidenceScore: avg(successful.map((r) => r.confidenceScore)),
    retrievedCount: n > 0 ? successful.reduce((s, r) => s + r.retrievedCount, 0) / n : 0,
    avgScore: avg(successful.map((r) => r.avgScore)),
    ideaCount: avg(successful.map((r) => r.ideaCount)),
    contextLength: avg(successful.map((r) => r.contextLength)),
    avgEvidenceLength: avg(successful.map((r) => r.avgEvidenceLength)),
    evidenceCount: avg(successful.map((r) => r.evidenceCount)),
    totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
  };
}
