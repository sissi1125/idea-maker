import { describe, expect, it } from "vitest";
import type { FilterInput, FilterParams, MatchedChunk } from "@harness/shared-types";
import { runFilter } from "../filter";

const defaultParams: FilterParams = {
  minScore: 0.6,
  maxPerDocument: 3,
  requiredSourceTypes: [],
  mmrLambda: 0.5,
  finalTopK: 10,
};

function makeMatch(over: Partial<MatchedChunk> = {}): MatchedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    version: 1,
    chunkIndex: 0,
    text: "测试内容",
    sourceRef: "章节A",
    keywords: [],
    score: 0.8,
    retrievalMethod: "dense",
    ...over,
  };
}

function makeInput(over: Partial<FilterInput> = {}): FilterInput {
  return {
    methodId: "score-threshold",
    params: defaultParams,
    upstreamMatches: [makeMatch()],
    originalQuery: "test",
    ...over,
  };
}

describe("runFilter - score-threshold", () => {
  it("低于 minScore 的被移除", () => {
    const matches = [
      makeMatch({ chunkId: "A", score: 0.9 }),
      makeMatch({ chunkId: "B", score: 0.5 }), // 移除
    ];
    const r = runFilter(makeInput({ upstreamMatches: matches }));
    expect(r.output.keptCount).toBe(1);
    expect(r.output.removedCount).toBe(1);
    expect(r.output.removedMatches[0].reason).toContain("minScore");
  });

  it("maxPerDocument 限制每文档命中数", () => {
    const matches = [
      makeMatch({ chunkId: "A1", documentId: "d1", score: 0.9 }),
      makeMatch({ chunkId: "A2", documentId: "d1", score: 0.85 }),
      makeMatch({ chunkId: "A3", documentId: "d1", score: 0.8 }),
      makeMatch({ chunkId: "A4", documentId: "d1", score: 0.75 }), // 超 maxPerDoc=3
    ];
    const r = runFilter(
      makeInput({
        upstreamMatches: matches,
        params: { ...defaultParams, maxPerDocument: 3, minScore: 0 },
      }),
    );
    expect(r.output.keptCount).toBe(3);
    expect(r.output.removedMatches[0].reason).toContain("maxPerDocument");
  });

  it("filteredRank 从 1 递增", () => {
    const matches = [
      makeMatch({ chunkId: "A", score: 0.9 }),
      makeMatch({ chunkId: "B", score: 0.85 }),
    ];
    const r = runFilter(makeInput({ upstreamMatches: matches }));
    expect(r.output.filteredMatches[0].filteredRank).toBe(1);
    expect(r.output.filteredMatches[1].filteredRank).toBe(2);
  });
});

describe("runFilter - metadata-filter", () => {
  it("requiredSourceTypes 白名单匹配", () => {
    const matches = [
      makeMatch({ chunkId: "A", sourceRef: "产品介绍 > 核心功能" }),
      makeMatch({ chunkId: "B", sourceRef: "FAQ" }),
    ];
    const r = runFilter(
      makeInput({
        methodId: "metadata-filter",
        upstreamMatches: matches,
        params: { ...defaultParams, requiredSourceTypes: ["产品介绍"] },
      }),
    );
    expect(r.output.keptCount).toBe(1);
    expect(r.output.filteredMatches[0].chunkId).toBe("A");
  });

  it("空白名单：保留全部（仍受 maxPerDocument 约束）", () => {
    const matches = [makeMatch({ chunkId: "A" }), makeMatch({ chunkId: "B", documentId: "d2" })];
    const r = runFilter(
      makeInput({
        methodId: "metadata-filter",
        upstreamMatches: matches,
        params: { ...defaultParams, requiredSourceTypes: [] },
      }),
    );
    expect(r.output.keptCount).toBe(2);
  });
});

describe("runFilter - mmr-diversity", () => {
  it("内容高度相似的两个 chunk：MMR 偏向多样性会减少重复", () => {
    const matches = [
      makeMatch({ chunkId: "A", text: "产品支持上传 PDF 文档", score: 0.9 }),
      makeMatch({ chunkId: "B", text: "产品支持上传 PDF 文档非常方便", score: 0.85 }),
      makeMatch({ chunkId: "C", text: "向量检索快速准确", documentId: "d2", score: 0.8 }),
    ];
    const r = runFilter(
      makeInput({
        methodId: "mmr-diversity",
        upstreamMatches: matches,
        params: { ...defaultParams, mmrLambda: 0.3, maxPerDocument: 5 },
      }),
    );
    // 第一个选高分 A，第二个应该选差异最大的 C（而非相似的 B）
    expect(r.output.filteredMatches[0].chunkId).toBe("A");
    expect(r.output.filteredMatches[1].chunkId).toBe("C");
  });

  it("λ=1：完全偏向相关性，等价于按 score 排序", () => {
    const matches = [
      makeMatch({ chunkId: "A", text: "内容一", score: 0.9 }),
      makeMatch({ chunkId: "B", text: "内容一一样", score: 0.85 }),
      makeMatch({ chunkId: "C", text: "完全不同", documentId: "d2", score: 0.5 }),
    ];
    const r = runFilter(
      makeInput({
        methodId: "mmr-diversity",
        upstreamMatches: matches,
        params: { ...defaultParams, mmrLambda: 1, maxPerDocument: 5 },
      }),
    );
    expect(r.output.filteredMatches[0].chunkId).toBe("A");
    expect(r.output.filteredMatches[1].chunkId).toBe("B");
  });

  it("maxPerDocument 在 MMR 中也生效", () => {
    const matches = [
      makeMatch({ chunkId: "A", documentId: "d1", score: 0.9 }),
      makeMatch({ chunkId: "B", documentId: "d1", score: 0.85 }),
      makeMatch({ chunkId: "C", documentId: "d1", score: 0.8 }),
    ];
    const r = runFilter(
      makeInput({
        methodId: "mmr-diversity",
        upstreamMatches: matches,
        params: { ...defaultParams, mmrLambda: 1, maxPerDocument: 2 },
      }),
    );
    expect(r.output.keptCount).toBe(2);
  });
});

describe("runFilter - pipeline-filter (组合)", () => {
  it("三步串联：metadata → score → MMR，trace 含每步剩余数", () => {
    const matches = [
      makeMatch({ chunkId: "A", sourceRef: "产品", text: "产品 A", score: 0.9 }),
      makeMatch({ chunkId: "B", sourceRef: "产品", text: "产品 B", documentId: "d2", score: 0.85 }),
      makeMatch({ chunkId: "C", sourceRef: "FAQ", text: "FAQ", score: 0.7 }), // metadata 移除
      makeMatch({ chunkId: "D", sourceRef: "产品", text: "产品 D", score: 0.3 }), // score 移除
    ];
    const r = runFilter(
      makeInput({
        methodId: "pipeline-filter",
        upstreamMatches: matches,
        params: {
          ...defaultParams,
          requiredSourceTypes: ["产品"],
          minScore: 0.5,
          finalTopK: 5,
          mmrLambda: 0.5,
          maxPerDocument: 3,
        },
      }),
    );
    expect(r.trace.pipelineSteps).toEqual({
      afterMetadata: 3, // A, B, D 通过；C 被移除
      afterScore: 2, // D 被分数过滤
      afterMMR: 2, // 都保留
    });
  });

  it("metadata 过滤后空 → warning", () => {
    const r = runFilter(
      makeInput({
        methodId: "pipeline-filter",
        upstreamMatches: [makeMatch({ sourceRef: "FAQ" })],
        params: { ...defaultParams, requiredSourceTypes: ["产品介绍"] },
      }),
    );
    expect(r.warnings.some((w) => w.includes("Metadata 过滤后无结果"))).toBe(true);
  });
});

describe("runFilter - warning 与上游透传", () => {
  it("过滤后全空：warning", () => {
    const r = runFilter(
      makeInput({
        upstreamMatches: [makeMatch({ score: 0.1 })],
        params: { ...defaultParams, minScore: 0.9 },
      }),
    );
    expect(r.warnings.some((w) => w.includes("过滤后无结果"))).toBe(true);
  });

  it("透传上游 warnings", () => {
    const r = runFilter(makeInput({ upstreamWarnings: ["上游警告"] }));
    expect(r.warnings).toContain("上游警告");
  });
});

describe("runFilter - trace", () => {
  it("trace 含 inputCount / keptCount / removedCount", () => {
    const matches = [makeMatch({ chunkId: "A" }), makeMatch({ chunkId: "B", score: 0.1 })];
    const r = runFilter(makeInput({ upstreamMatches: matches }));
    expect(r.trace.methodId).toBe("score-threshold");
    expect(r.trace.inputCount).toBe(2);
    expect(r.trace.keptCount).toBe(1);
    expect(r.trace.removedCount).toBe(1);
  });
});
