import { describe, expect, it, vi } from "vitest";
import type {
  FilteredChunk,
  LLMChatClient,
  RerankInput,
  RerankParams,
} from "@harness/shared-types";
import { runRerank } from "../rerank";

const defaultParams: RerankParams = {
  rerankTopN: 5,
  boostPassN: 20,
  model: "gpt-4o-mini",
  criteria: "",
  apiKey: undefined,
  baseUrl: undefined,
  endpoint: undefined,
  query: "",
};

function makeMatch(over: Partial<FilteredChunk> = {}): FilteredChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    version: 1,
    chunkIndex: 0,
    text: "产品支持 PDF 上传",
    sourceRef: "产品介绍 > 核心功能",
    keywords: [],
    score: 0.8,
    retrievalMethod: "dense",
    filteredRank: 1,
    ...over,
  };
}

function makeInput(over: Partial<RerankInput> = {}): RerankInput {
  return {
    methodId: "score-only",
    params: defaultParams,
    upstreamMatches: [makeMatch()],
    ...over,
  };
}

describe("runRerank - score-only", () => {
  it("按 filter 分数排序，newRank 递增", async () => {
    const matches = [
      makeMatch({ chunkId: "A", score: 0.5, filteredRank: 1 }),
      makeMatch({ chunkId: "B", score: 0.9, filteredRank: 2 }),
    ];
    const r = await runRerank(makeInput({ upstreamMatches: matches }));
    // score-only 不重新排序，按 filteredRank 取前 topN
    expect(r.output.rankedMatches[0].chunkId).toBe("A");
    expect(r.output.rankedMatches[0].newRank).toBe(1);
    expect(r.output.rankedMatches[0].rerankScore).toBe(0.5);
  });

  it("rankChanges delta = originalRank - newRank", async () => {
    const matches = Array.from({ length: 3 }, (_, i) =>
      makeMatch({ chunkId: `c${i}`, filteredRank: i + 1 }),
    );
    const r = await runRerank(makeInput({ upstreamMatches: matches }));
    expect(r.output.rankChanges[0].delta).toBe(0);
  });
});

describe("runRerank - metadata-boost", () => {
  it("sourceRef 含 query 关键词 → 分数加权 + 升序前移", async () => {
    // boost = 0.2 * (hits/totalTokens)。max boost = 0.2。
    // 故初始 score gap 必须 < 0.2 才能被翻转。
    const matches = [
      makeMatch({ chunkId: "no_match", sourceRef: "FAQ", text: "FAQ", score: 0.65, filteredRank: 1 }),
      makeMatch({ chunkId: "matches", sourceRef: "核心功能", text: "PDF 上传", score: 0.55, filteredRank: 2 }),
    ];
    const r = await runRerank(
      makeInput({
        methodId: "metadata-boost",
        params: { ...defaultParams, query: "核心功能" },
        upstreamMatches: matches,
      }),
    );
    // matches 命中 "核心" "功能" → boost ~1.0 → score = 0.55 + 0.2 = 0.75，超过 no_match 的 0.65
    expect(r.output.rankedMatches[0].chunkId).toBe("matches");
  });

  it("空 query：tokens 为空，所有 chunk boost=0，按原 score 排", async () => {
    const matches = [
      makeMatch({ chunkId: "A", score: 0.5 }),
      makeMatch({ chunkId: "B", score: 0.9 }),
    ];
    const r = await runRerank(
      makeInput({
        methodId: "metadata-boost",
        upstreamMatches: matches,
      }),
    );
    expect(r.output.rankedMatches[0].chunkId).toBe("B");
  });
});

describe("runRerank - hf-tei-rerank (mock fetch)", () => {
  it("调 TEI /rerank endpoint，按返回 score 排序", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { index: 1, score: 0.95 },
        { index: 0, score: 0.4 },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const matches = [
        makeMatch({ chunkId: "A", filteredRank: 1 }),
        makeMatch({ chunkId: "B", filteredRank: 2 }),
      ];
      const r = await runRerank(
        makeInput({
          methodId: "hf-tei-rerank",
          params: { ...defaultParams, query: "测试" },
          upstreamMatches: matches,
          hfTeiEndpoint: "http://localhost:8080/",
        }),
      );
      expect(r.output.rankedMatches[0].chunkId).toBe("B");
      expect(r.output.rankedMatches[0].rerankScore).toBe(0.95);
      // endpoint 末尾 / 被剥离
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/rerank", expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("缺 endpoint：missing_endpoint", async () => {
    await expect(
      runRerank(
        makeInput({
          methodId: "hf-tei-rerank",
          params: { ...defaultParams, query: "测试" },
        }),
      ),
    ).rejects.toMatchObject({ code: "missing_endpoint" });
  });

  it("缺 query：missing_query", async () => {
    await expect(
      runRerank(
        makeInput({
          methodId: "hf-tei-rerank",
          hfTeiEndpoint: "http://x",
        }),
      ),
    ).rejects.toMatchObject({ code: "missing_query" });
  });

  it("TEI 500：provider_error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal",
      text: async () => "服务挂了",
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        runRerank(
          makeInput({
            methodId: "hf-tei-rerank",
            params: { ...defaultParams, query: "测试" },
            hfTeiEndpoint: "http://x",
          }),
        ),
      ).rejects.toMatchObject({ code: "provider_error" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("params.endpoint 优先于 Input.hfTeiEndpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ index: 0, score: 0.5 }],
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runRerank(
        makeInput({
          methodId: "hf-tei-rerank",
          params: { ...defaultParams, query: "测试", endpoint: "http://from-param" },
          hfTeiEndpoint: "http://from-env",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith("http://from-param/rerank", expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("runRerank - llm-relevance-rerank (mock client)", () => {
  it("每 chunk 单独调用 LLM 评分", async () => {
    const mockCreate = vi.fn().mockImplementation(({ messages }: { messages: Array<{ content: string }> }) => {
      // 给"高分"的 chunk 评 9，"低分"的评 3
      const userContent = messages[messages.length - 1].content;
      const score = userContent.includes("高分") ? 9 : 3;
      return Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score }) } }],
      });
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const matches = [
      makeMatch({ chunkId: "A", text: "低分内容", filteredRank: 1 }),
      makeMatch({ chunkId: "B", text: "高分内容", filteredRank: 2 }),
    ];
    const r = await runRerank(
      makeInput({
        methodId: "llm-relevance-rerank",
        params: { ...defaultParams, query: "测试" },
        upstreamMatches: matches,
        llmClient: client,
      }),
    );
    expect(r.output.rankedMatches[0].chunkId).toBe("B");
    expect(r.output.rankedMatches[0].rerankScore).toBe(0.9);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("per-chunk 失败：降级为原始分数 + 加入 warning（不中断）", async () => {
    let callCount = 0;
    const mockCreate = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("API timeout"));
      return Promise.resolve({
        choices: [{ message: { content: '{"score":8}' } }],
      });
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runRerank(
      makeInput({
        methodId: "llm-relevance-rerank",
        params: { ...defaultParams, query: "测试" },
        upstreamMatches: [
          makeMatch({ chunkId: "A", score: 0.5 }),
          makeMatch({ chunkId: "B", score: 0.6 }),
        ],
        llmClient: client,
      }),
    );
    // 两个都进入结果，A 用原始 score 0.5，B 用 0.8
    expect(r.output.rankedMatches).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes("失败，已降级"))).toBe(true);
  });

  it("缺 llmClient：missing_client", async () => {
    await expect(
      runRerank(
        makeInput({
          methodId: "llm-relevance-rerank",
          params: { ...defaultParams, query: "测试" },
        }),
      ),
    ).rejects.toMatchObject({ code: "missing_client" });
  });

  it("缺 query：missing_query", async () => {
    const client: LLMChatClient = {
      chat: { completions: { create: vi.fn() } },
    };
    await expect(
      runRerank(makeInput({ methodId: "llm-relevance-rerank", llmClient: client })),
    ).rejects.toMatchObject({ code: "missing_query" });
  });
});

describe("runRerank - pipeline-rerank (Boost → TEI)", () => {
  it("两步串联：Boost 排序后取 boostPassN 送 TEI", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ index: 0, score: 0.99 }],
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const matches = Array.from({ length: 30 }, (_, i) =>
        makeMatch({ chunkId: `c${i}`, score: 0.5, filteredRank: i + 1 }),
      );
      const r = await runRerank(
        makeInput({
          methodId: "pipeline-rerank",
          params: { ...defaultParams, query: "测试", boostPassN: 10 },
          upstreamMatches: matches,
          hfTeiEndpoint: "http://x",
        }),
      );
      expect(r.trace.pipelineSteps).toEqual({ afterBoost: 30, sentToTEI: 10 });
      expect(fetchMock.mock.calls[0][1].body).toMatch(/"texts"/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("runRerank - 错误路径", () => {
  it("空 upstreamMatches：empty_matches", async () => {
    await expect(runRerank(makeInput({ upstreamMatches: [] }))).rejects.toMatchObject({
      code: "empty_matches",
    });
  });
});

describe("runRerank - trace + originalQuery 透传", () => {
  it("trace 含 inputCount / outputCount / topN", async () => {
    const matches = [makeMatch({ chunkId: "A" }), makeMatch({ chunkId: "B" })];
    const r = await runRerank(
      makeInput({
        params: { ...defaultParams, rerankTopN: 1 },
        upstreamMatches: matches,
      }),
    );
    expect(r.trace.inputCount).toBe(2);
    expect(r.trace.outputCount).toBe(1);
    expect(r.trace.topN).toBe(1);
  });

  it("upstreamQuery 优先于 params.query", async () => {
    const r = await runRerank(
      makeInput({
        methodId: "metadata-boost",
        params: { ...defaultParams, query: "params query" },
        upstreamQuery: "upstream query",
      }),
    );
    expect(r.output.originalQuery).toBe("upstream query");
  });
});
