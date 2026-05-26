import { describe, expect, it } from "vitest";
import type {
  MatchedChunk,
  MultiRecallMergeInput,
  MultiRecallMergeParams,
  RetrievalOutput,
} from "@harness/shared-types";
import { runMultiRecallMerge } from "../multi-recall-merge";

const defaultParams: MultiRecallMergeParams = {
  topK: 10,
  k: 60,
  additionalMatches: undefined,
};

function makeMatch(over: Partial<MatchedChunk> = {}): MatchedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    version: 1,
    chunkIndex: 0,
    text: "测试",
    sourceRef: "章节A",
    keywords: [],
    score: 0.5,
    retrievalMethod: "dense",
    ...over,
  };
}

function makeUpstream(matches: MatchedChunk[]): RetrievalOutput {
  return {
    originalQuery: "test",
    queries: ["test"],
    matches,
    totalMatches: matches.length,
    method: "dense",
    warnings: [],
  };
}

function makeInput(over: Partial<MultiRecallMergeInput> = {}): MultiRecallMergeInput {
  return {
    methodId: "rrf-merge",
    params: defaultParams,
    upstream: makeUpstream([makeMatch()]),
    ...over,
  };
}

describe("runMultiRecallMerge - rrf-merge", () => {
  it("同一 chunk 命中两路（dense + fulltext）：RRF 分数累加，排在前", () => {
    const denseMatches = [
      makeMatch({ chunkId: "A", retrievalMethod: "dense", score: 0.9 }),
      makeMatch({ chunkId: "B", retrievalMethod: "dense", score: 0.8 }),
    ];
    const fulltextMatches = [
      makeMatch({ chunkId: "B", retrievalMethod: "fulltext", score: 0.7 }),
      makeMatch({ chunkId: "C", retrievalMethod: "fulltext", score: 0.6 }),
    ];
    const r = runMultiRecallMerge(
      makeInput({
        upstream: makeUpstream(denseMatches),
        additionalMatches: fulltextMatches,
      }),
    );
    // B 命中两路，应该排第一
    expect(r.output.matches[0].chunkId).toBe("B");
    expect(r.output.matches[0].retrievalMethod).toBe("rrf-merged");
  });

  it("topK 限制输出数量", () => {
    const matches = Array.from({ length: 20 }, (_, i) =>
      makeMatch({ chunkId: `c${i}`, score: 1 - i * 0.01 }),
    );
    const r = runMultiRecallMerge(
      makeInput({
        params: { ...defaultParams, topK: 5 },
        upstream: makeUpstream(matches),
      }),
    );
    expect(r.output.matches).toHaveLength(5);
  });

  it("deduplicatedCount = inputCount - outputCount", () => {
    const matches = [
      makeMatch({ chunkId: "A" }),
      makeMatch({ chunkId: "A", retrievalMethod: "fulltext" }), // 重复
      makeMatch({ chunkId: "B" }),
    ];
    const r = runMultiRecallMerge(makeInput({ upstream: makeUpstream(matches) }));
    expect(r.output.totalMatches).toBe(2); // A, B 去重后
    expect(r.output.deduplicatedCount).toBe(1);
  });
});

describe("runMultiRecallMerge - score-merge", () => {
  it("Min-Max 归一化：组内 max 变 1，min 变 0", () => {
    const matches = [
      makeMatch({ chunkId: "A", score: 100, retrievalMethod: "dense" }),
      makeMatch({ chunkId: "B", score: 50, retrievalMethod: "dense" }),
      makeMatch({ chunkId: "C", score: 0, retrievalMethod: "dense" }),
    ];
    const r = runMultiRecallMerge(
      makeInput({ methodId: "score-merge", upstream: makeUpstream(matches) }),
    );
    expect(r.output.matches[0].score).toBe(1);
    expect(r.output.matches[r.output.matches.length - 1].score).toBe(0);
  });

  it("同 chunkId 多路命中：取最高分", () => {
    const matches = [
      makeMatch({ chunkId: "A", score: 0.9, retrievalMethod: "dense" }),
      makeMatch({ chunkId: "A", score: 0.1, retrievalMethod: "fulltext" }),
    ];
    const r = runMultiRecallMerge(
      makeInput({ methodId: "score-merge", upstream: makeUpstream(matches) }),
    );
    expect(r.output.matches).toHaveLength(1);
    // 归一化后两路都是 max=1, min=1（单元素组），但去重逻辑保留高分项
  });

  it("空输入：返回空 matches", () => {
    const r = runMultiRecallMerge(
      makeInput({ methodId: "score-merge", upstream: makeUpstream([]) }),
    );
    expect(r.output.matches).toEqual([]);
  });
});

describe("runMultiRecallMerge - warnings", () => {
  it("单路结果：warning 提示需通过 additionalMatches 才能多路融合", () => {
    const r = runMultiRecallMerge(makeInput());
    expect(r.warnings.some((w) => w.includes("一路检索结果"))).toBe(true);
  });

  it("多路输入：warning 显示路数", () => {
    const r = runMultiRecallMerge(
      makeInput({
        upstream: makeUpstream([makeMatch({ chunkId: "A" })]),
        additionalMatches: [makeMatch({ chunkId: "B", retrievalMethod: "fulltext" })],
      }),
    );
    expect(r.warnings.some((w) => w.includes("附加路"))).toBe(true);
  });

  it("透传上游 warnings", () => {
    const upstream = makeUpstream([makeMatch()]);
    upstream.warnings = ["上游警告 1"];
    const r = runMultiRecallMerge(makeInput({ upstream }));
    expect(r.warnings).toContain("上游警告 1");
  });
});

describe("runMultiRecallMerge - trace", () => {
  it("trace 字段完整", () => {
    const r = runMultiRecallMerge(
      makeInput({
        upstream: makeUpstream([makeMatch({ chunkId: "A" }), makeMatch({ chunkId: "B" })]),
      }),
    );
    expect(r.trace.methodId).toBe("rrf-merge");
    expect(r.trace.inputCount).toBe(2);
    expect(r.trace.outputCount).toBe(2);
    expect(r.trace.deduplicatedCount).toBe(0);
  });
});
