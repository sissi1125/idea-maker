import { describe, expect, it, vi } from "vitest";
import type {
  EmbeddingInput,
  EmbeddingInputChunk,
  EmbeddingParams,
  OpenAICompatibleClient,
} from "@harness/shared-types";
import { runEmbedding } from "../embedding";
import { PipelineError } from "../../errors";

const defaultParams: EmbeddingParams = {
  model: "",
  dimension: 4,
  batchSize: 10,
  apiKey: undefined,
  baseUrl: undefined,
  endpoint: undefined,
};

function makeChunk(over: Partial<EmbeddingInputChunk> = {}): EmbeddingInputChunk {
  return {
    index: 0,
    text: "测试文本",
    charStart: 0,
    charEnd: 4,
    charCount: 4,
    tokenEstimate: 2,
    sourceRef: "章节A",
    ...over,
  };
}

function makeInput(over: Partial<EmbeddingInput> = {}): EmbeddingInput {
  return {
    methodId: "debug-deterministic",
    params: defaultParams,
    upstreamChunks: [makeChunk()],
    ...over,
  };
}

describe("runEmbedding - debug-deterministic", () => {
  it("同一文本两次调用 → 确定性相同向量", async () => {
    const r1 = await runEmbedding(makeInput());
    const r2 = await runEmbedding(makeInput());
    expect(r1.output.chunks[0].embedding).toEqual(r2.output.chunks[0].embedding);
  });

  it("不同文本 → 不同向量", async () => {
    const r1 = await runEmbedding(makeInput({ upstreamChunks: [makeChunk({ text: "A" })] }));
    const r2 = await runEmbedding(makeInput({ upstreamChunks: [makeChunk({ text: "B" })] }));
    expect(r1.output.chunks[0].embedding).not.toEqual(r2.output.chunks[0].embedding);
  });

  it("向量已归一化为单位向量（L2 模 ≈ 1）", async () => {
    const r = await runEmbedding(makeInput({ params: { ...defaultParams, dimension: 16 } }));
    const v = r.output.chunks[0].embedding;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it("dimension 参数控制向量长度", async () => {
    const r = await runEmbedding(makeInput({ params: { ...defaultParams, dimension: 8 } }));
    expect(r.output.chunks[0].embedding).toHaveLength(8);
    expect(r.output.dimension).toBe(8);
  });

  it("provider=debug-deterministic + warning 提示生产慎用", async () => {
    const r = await runEmbedding(makeInput());
    expect(r.output.provider).toBe("debug-deterministic");
    expect(r.warnings.some((w) => w.includes("不携带语义"))).toBe(true);
  });

  it("优先使用 enhancedText（transform 增强后），fallback 到 text", async () => {
    const c1 = makeChunk({ text: "原文", enhancedText: "增强后" });
    const c2 = makeChunk({ text: "原文" });
    const r1 = await runEmbedding(makeInput({ upstreamChunks: [c1] }));
    const r2 = await runEmbedding(makeInput({ upstreamChunks: [c2] }));
    // 用了不同输入应得到不同向量
    expect(r1.output.chunks[0].embedding).not.toEqual(r2.output.chunks[0].embedding);
  });
});

describe("runEmbedding - openai-3-small (mock client)", () => {
  it("正常调用：用注入的 client，正确返回 batchCount / costEstimate", async () => {
    const mockEmbedCreate = vi.fn().mockResolvedValue({
      data: [
        { embedding: [0.1, 0.2, 0.3, 0.4], index: 0 },
        { embedding: [0.5, 0.6, 0.7, 0.8], index: 1 },
      ],
    });
    const client: OpenAICompatibleClient = {
      embeddings: { create: mockEmbedCreate },
    };
    const r = await runEmbedding(
      makeInput({
        methodId: "openai-3-small",
        upstreamChunks: [makeChunk({ index: 0, text: "a" }), makeChunk({ index: 1, text: "b" })],
        openaiClient: client,
      }),
    );
    expect(r.output.chunkCount).toBe(2);
    expect(r.output.batchCount).toBe(1);
    expect(r.output.costEstimate).toContain("tokens");
    expect(mockEmbedCreate).toHaveBeenCalledOnce();
  });

  it("缺 openaiClient：抛 PipelineError(missing_client)", async () => {
    await expect(
      runEmbedding(makeInput({ methodId: "openai-3-small" })),
    ).rejects.toThrowError(PipelineError);
    await expect(
      runEmbedding(makeInput({ methodId: "openai-3-small" })),
    ).rejects.toMatchObject({ code: "missing_client" });
  });

  it("OpenAI 返回顺序混乱：按 index 重排，与输入对齐", async () => {
    // 故意把 index=1 放在前面
    const mockEmbedCreate = vi.fn().mockResolvedValue({
      data: [
        { embedding: [9, 9, 9, 9], index: 1 },
        { embedding: [1, 1, 1, 1], index: 0 },
      ],
    });
    const client: OpenAICompatibleClient = {
      embeddings: { create: mockEmbedCreate },
    };
    const r = await runEmbedding(
      makeInput({
        methodId: "openai-3-small",
        upstreamChunks: [makeChunk({ index: 0, text: "a" }), makeChunk({ index: 1, text: "b" })],
        openaiClient: client,
      }),
    );
    expect(r.output.chunks[0].embedding).toEqual([1, 1, 1, 1]);
    expect(r.output.chunks[1].embedding).toEqual([9, 9, 9, 9]);
  });

  it("batchSize=1：N 个 chunk 触发 N 次 API 调用", async () => {
    const mockEmbedCreate = vi.fn().mockImplementation(() =>
      Promise.resolve({ data: [{ embedding: [0, 0, 0, 0], index: 0 }] }),
    );
    const client: OpenAICompatibleClient = {
      embeddings: { create: mockEmbedCreate },
    };
    await runEmbedding(
      makeInput({
        methodId: "openai-3-small",
        params: { ...defaultParams, batchSize: 1 },
        upstreamChunks: [
          makeChunk({ index: 0, text: "a" }),
          makeChunk({ index: 1, text: "b" }),
          makeChunk({ index: 2, text: "c" }),
        ],
        openaiClient: client,
      }),
    );
    expect(mockEmbedCreate).toHaveBeenCalledTimes(3);
  });
});

describe("runEmbedding - hf-tei-embedding (mock fetch)", () => {
  it("缺 endpoint：抛 PipelineError(missing_endpoint)", async () => {
    await expect(
      runEmbedding(makeInput({ methodId: "hf-tei-embedding" })),
    ).rejects.toMatchObject({ code: "missing_endpoint" });
  });

  it("params.endpoint 优先于 Input.hfTeiEndpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[0.1, 0.2]],
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runEmbedding(
        makeInput({
          methodId: "hf-tei-embedding",
          params: { ...defaultParams, endpoint: "http://from-param" },
          hfTeiEndpoint: "http://from-env",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "http://from-param/embed",
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("TEI 返回非 200：抛 provider_error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Error",
      text: async () => "服务挂了",
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        runEmbedding(
          makeInput({ methodId: "hf-tei-embedding", hfTeiEndpoint: "http://x" }),
        ),
      ).rejects.toMatchObject({ code: "provider_error" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("runEmbedding - 通用错误路径", () => {
  it("空 upstreamChunks：抛 empty_chunks", async () => {
    await expect(
      runEmbedding(makeInput({ upstreamChunks: [] })),
    ).rejects.toMatchObject({ code: "empty_chunks" });
  });
});

describe("runEmbedding - trace", () => {
  it("trace 字段：method / chunkCount / dimension / batchCount / totalTokens", async () => {
    const r = await runEmbedding(
      makeInput({
        upstreamChunks: [
          makeChunk({ tokenEstimate: 10 }),
          makeChunk({ tokenEstimate: 20 }),
        ],
      }),
    );
    expect(r.trace.methodId).toBe("debug-deterministic");
    expect(r.trace.chunkCount).toBe(2);
    expect(r.trace.dimension).toBe(4);
    expect(r.trace.totalTokensEstimated).toBe(30);
  });
});
