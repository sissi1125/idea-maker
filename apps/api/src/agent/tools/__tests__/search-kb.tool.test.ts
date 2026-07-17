/**
 * search_kb tool 单测
 *
 * 验证：参数默认值 / 委托 runRetrieval / empty 状态 / category 过滤。
 * mock 掉 @harness/rag-core 的 runRetrieval，断言入参 + 返回结构。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runRetrievalMock = vi.fn();

vi.mock("@harness/rag-core", () => ({
  runRetrieval: (args: unknown) => runRetrievalMock(args),
}));

import { buildSearchKbTool } from "../search-kb.tool";
import type { AgentToolContext } from "../types";
import { makeFakeSpillStorage } from "./_test-utils";
import { makeTestGrounding } from "../../__tests__/grounding.fixture";

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    projectId: "proj-1",
    userId: "user-1",
    runId: "run-1",
    pgClient: {} as never,
    embeddingClient: {} as never,
    llmModel: {} as never,
    llmDefaultModel: "gpt-4o-mini",
    grounding: makeTestGrounding(),
    // feat-300.6：search_kb 现在要求显式注入 embeddingModel/Dimension，否则 fail loud
    // 测试默认值用 bge-m3（与 ollama 本地路径一致）；覆盖时用 overrides.options 传别的
    options: {
      embeddingModel: "bge-m3",
      embeddingDimension: 1024,
    },
    ...overrides,
  };
}

const exec = async (toolObj: ReturnType<ReturnType<typeof buildSearchKbTool>>, args: unknown) => {
  // ai-sdk Tool type 的 execute 是可选的；这里我们的实现保证存在
  return (
    toolObj.execute as (
      args: unknown,
      opts: { toolCallId: string; messages: [] },
    ) => Promise<unknown>
  )(args, { toolCallId: "t1", messages: [] });
};

describe("search_kb tool", () => {
  beforeEach(() => {
    runRetrievalMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("入参默认值：受 SEARCH_KB_MAX_CHUNKS 上限约束（300.3 任务 0.5）", async () => {
    runRetrievalMock.mockResolvedValue({ output: { matches: [] }, trace: {}, warnings: [] });
    const t = buildSearchKbTool(makeFakeSpillStorage())(makeCtx());
    await exec(t, { query: "护肤功效" });

    // 引入 SEARCH_KB_MAX_CHUNKS=3 后，默认 topK 受硬上限约束
    expect(runRetrievalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        methodId: "hybrid-bm25-rrf",
        params: expect.objectContaining({ topK: 3 }),
        queries: ["护肤功效"],
        projectId: "proj-1",
      }),
    );
  });

  it("retrieval 返回 0 条 → status=empty", async () => {
    runRetrievalMock.mockResolvedValue({ output: { matches: [] }, trace: {}, warnings: [] });
    const t = buildSearchKbTool(makeFakeSpillStorage())(makeCtx());
    const out = (await exec(t, { query: "Q" })) as { status: string };
    expect(out.status).toBe("empty");
  });

  it("返回 chunks 时按 topK 截断 + 分数保留 4 位小数", async () => {
    runRetrievalMock.mockResolvedValue({
      output: {
        matches: Array.from({ length: 10 }, (_, i) => ({
          chunkId: `c-${i}`,
          text: `t-${i}`,
          sourceRef: "product/doc.pdf",
          score: 0.12345 + i * 0.01,
        })),
      },
      trace: {},
      warnings: [],
    });
    const t = buildSearchKbTool(makeFakeSpillStorage())(makeCtx());
    const out = (await exec(t, { query: "Q", topK: 3 })) as {
      status: string;
      chunks: { score: number }[];
    };
    expect(out.status).toBe("ok");
    expect(out.chunks).toHaveLength(3);
    expect(out.chunks[0].score.toString()).toMatch(/^\d+\.\d{1,4}$/);
  });

  it("category=product 过滤掉非 product 的 chunk", async () => {
    runRetrievalMock.mockResolvedValue({
      output: {
        matches: [
          { chunkId: "1", text: "a", sourceRef: "product/x.pdf", score: 0.9 },
          { chunkId: "2", text: "b", sourceRef: "compete/y.pdf", score: 0.8 },
        ],
      },
      trace: {},
      warnings: [],
    });
    const t = buildSearchKbTool(makeFakeSpillStorage())(makeCtx());
    const out = (await exec(t, { query: "Q", category: "product" })) as {
      chunks: { chunkId: string }[];
    };
    expect(out.chunks).toHaveLength(1);
    expect(out.chunks[0].chunkId).toBe("1");
  });

  it("ctx.options.retrievalTopK 仍受 SEARCH_KB_MAX_CHUNKS 上限约束（截 3）", async () => {
    runRetrievalMock.mockResolvedValue({ output: { matches: [] }, trace: {}, warnings: [] });
    // 注意：overrides.options 整体替换默认 options，故必须把 embeddingModel/Dimension 也带上
    const t = buildSearchKbTool(makeFakeSpillStorage())(
      makeCtx({ options: { retrievalTopK: 12, embeddingModel: "bge-m3", embeddingDimension: 1024 } }),
    );
    await exec(t, { query: "Q" });
    // 即使 options 要求 12，硬上限会压回 3——保护 messages 不爆是不可绕过的
    expect(runRetrievalMock).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ topK: 3 }) }),
    );
  });
});
