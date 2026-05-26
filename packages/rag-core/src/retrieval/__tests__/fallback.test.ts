import { describe, expect, it, vi } from "vitest";
import type {
  FallbackInput,
  FallbackParams,
  LLMChatClient,
  RankedChunk,
  RerankOutput,
} from "@harness/shared-types";
import { runFallback } from "../fallback";

const defaultParams: FallbackParams = {
  minMatchCount: 1,
  minScore: 0.3,
  message: "抱歉，我目前没有足够的信息来回答这个问题。",
  model: "gpt-4o-mini",
  apiKey: undefined,
  baseUrl: undefined,
};

function makeMatch(over: Partial<RankedChunk> = {}): RankedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    version: 1,
    chunkIndex: 0,
    text: "内容",
    sourceRef: "章节A",
    keywords: [],
    score: 0.8,
    retrievalMethod: "dense",
    filteredRank: 1,
    rerankScore: 0.7,
    originalRank: 1,
    newRank: 1,
    ...over,
  };
}

function makeUpstream(matches: RankedChunk[], query = "测试 query"): RerankOutput {
  return {
    originalQuery: query,
    rankedMatches: matches,
    rankChanges: [],
    method: "score-only",
    warnings: [],
  };
}

function makeInput(over: Partial<FallbackInput> = {}): FallbackInput {
  return {
    methodId: "reject-answer",
    params: defaultParams,
    upstream: makeUpstream([makeMatch()]),
    ...over,
  };
}

describe("runFallback - reject-answer", () => {
  it("质量达标：不触发，透传 matches", async () => {
    const r = await runFallback(makeInput());
    expect(r.output.triggered).toBe(false);
    expect(r.output.rankedMatches).toHaveLength(1);
  });

  it("matches < minMatchCount：触发拒答", async () => {
    const r = await runFallback(
      makeInput({
        upstream: makeUpstream([]),
        params: { ...defaultParams, minMatchCount: 1 },
      }),
    );
    expect(r.output.triggered).toBe(true);
    expect(r.output.fallbackResponse).toContain("抱歉");
    expect(r.output.triggerReason).toContain("数量");
  });

  it("topScore < minScore：触发拒答", async () => {
    const r = await runFallback(
      makeInput({
        upstream: makeUpstream([makeMatch({ rerankScore: 0.1 })]),
        params: { ...defaultParams, minScore: 0.5 },
      }),
    );
    expect(r.output.triggered).toBe(true);
    expect(r.output.triggerReason).toContain("最高分");
  });

  it("自定义 message", async () => {
    const r = await runFallback(
      makeInput({
        upstream: makeUpstream([]),
        params: { ...defaultParams, message: "我不知道。" },
      }),
    );
    expect(r.output.fallbackResponse).toBe("我不知道。");
  });

  it("触发时清空 rankedMatches + warning", async () => {
    const r = await runFallback(
      makeInput({
        upstream: makeUpstream([], "查询"),
      }),
    );
    expect(r.output.rankedMatches).toEqual([]);
    expect(r.warnings.some((w) => w.includes("Fallback 触发"))).toBe(true);
  });
});

describe("runFallback - generic-response (mock LLM)", () => {
  it("质量不足 + 有 llmClient：调用 LLM 生成回复", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "您可以查阅产品官网获取更多信息。" } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runFallback(
      makeInput({
        methodId: "generic-response",
        upstream: makeUpstream([]),
        llmClient: client,
      }),
    );
    expect(r.output.triggered).toBe(true);
    expect(r.output.fallbackResponse).toContain("产品官网");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("质量不足 + 无 llmClient：**优雅降级到拒答**（不抛错）", async () => {
    const r = await runFallback(
      makeInput({
        methodId: "generic-response",
        upstream: makeUpstream([]),
        // llmClient: undefined
      }),
    );
    expect(r.output.triggered).toBe(true);
    expect(r.output.fallbackResponse).toContain("查阅产品官方文档");
    expect(r.warnings.some((w) => w.includes("无 LLM 配置"))).toBe(true);
  });

  it("质量达标：即使有 client 也不触发 LLM 调用", async () => {
    const mockCreate = vi.fn();
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runFallback(
      makeInput({
        methodId: "generic-response",
        llmClient: client,
      }),
    );
    expect(r.output.triggered).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("LLM 返回空内容：fallbackResponse 用默认值", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: null } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runFallback(
      makeInput({
        methodId: "generic-response",
        upstream: makeUpstream([]),
        llmClient: client,
      }),
    );
    expect(r.output.fallbackResponse).toContain("抱歉");
  });
});

describe("runFallback - trace", () => {
  it("trace 字段完整", async () => {
    const r = await runFallback(
      makeInput({
        upstream: makeUpstream([makeMatch(), makeMatch({ chunkId: "c2" })]),
      }),
    );
    expect(r.trace.methodId).toBe("reject-answer");
    expect(r.trace.triggered).toBe(false);
    expect(r.trace.inputCount).toBe(2);
    expect(r.trace.triggerReason).toContain("质量达标");
  });
});
