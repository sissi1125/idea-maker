/**
 * output-limits 单测 + search_kb / search_web 截断行为验证。
 */

import { describe, expect, it, vi } from "vitest";
import {
  SEARCH_KB_MAX_CHUNKS,
  SEARCH_KB_CHUNK_TEXT_CHARS,
  SEARCH_WEB_MAX_RESULTS,
  SEARCH_WEB_CONTENT_CHARS,
  truncateText,
} from "../util/output-limits";
import { makeFakeSpillStorage } from "./_test-utils";
import { makeTestGrounding } from "../../__tests__/grounding.fixture";

describe("truncateText", () => {
  it("短于阈值不截断", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("超过阈值截断 + 加'…（已截断）'", () => {
    const out = truncateText("a".repeat(50), 10);
    expect(out).toBe("aaaaaaaaaa…（已截断）");
  });
});

describe("常量数值合理性", () => {
  it("SEARCH_KB 系列保守 + 上界明确", () => {
    expect(SEARCH_KB_MAX_CHUNKS).toBeLessThanOrEqual(5);
    expect(SEARCH_KB_CHUNK_TEXT_CHARS).toBeLessThanOrEqual(500);
  });
  it("SEARCH_WEB 系列同理", () => {
    expect(SEARCH_WEB_MAX_RESULTS).toBeLessThanOrEqual(5);
    expect(SEARCH_WEB_CONTENT_CHARS).toBeLessThanOrEqual(500);
  });
});

// 集成验证：search_kb / search_web 真的应用了上限
describe("集成：search_kb 截断行为", () => {
  it("retrieval 返回 10 条时，最多返回 SEARCH_KB_MAX_CHUNKS 条", async () => {
    vi.resetModules();
    vi.doMock("@harness/rag-core", () => ({
      runRetrieval: async () => ({
        output: {
          matches: Array.from({ length: 10 }, (_, i) => ({
            chunkId: `c-${i}`,
            text: `text ${i}`,
            sourceRef: "x",
            score: 0.5,
          })),
        },
        trace: {},
        warnings: [],
      }),
    }));
    const { buildSearchKbTool } = await import("../search-kb.tool");
    const t = buildSearchKbTool(makeFakeSpillStorage())({
      projectId: "p",
      userId: "u",
      runId: "r",
      pgClient: {} as never,
      embeddingClient: {} as never,
      llmModel: {} as never,
      llmDefaultModel: "x",
      grounding: makeTestGrounding(),
      // feat-300.6：search_kb 现在要求显式注入 embeddingModel/Dimension（fail loud）
      options: { embeddingModel: "bge-m3", embeddingDimension: 1024 },
    });
    const out = (await (
      t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>
    )({ query: "Q", topK: 10 }, { toolCallId: "t", messages: [] })) as { chunks: unknown[] };
    expect(out.chunks).toHaveLength(SEARCH_KB_MAX_CHUNKS);
  });

  it("chunk 文本超过 SEARCH_KB_CHUNK_TEXT_CHARS 时截断 + 标记", async () => {
    vi.resetModules();
    const longText = "abc".repeat(200); // 600 字符
    vi.doMock("@harness/rag-core", () => ({
      runRetrieval: async () => ({
        output: {
          matches: [{ chunkId: "c", text: longText, sourceRef: "x", score: 0.5 }],
        },
        trace: {},
        warnings: [],
      }),
    }));
    const { buildSearchKbTool } = await import("../search-kb.tool");
    const t = buildSearchKbTool(makeFakeSpillStorage())({
      projectId: "p",
      userId: "u",
      runId: "r",
      pgClient: {} as never,
      embeddingClient: {} as never,
      llmModel: {} as never,
      llmDefaultModel: "x",
      grounding: makeTestGrounding(),
      // feat-300.6：search_kb 现在要求显式注入 embeddingModel/Dimension（fail loud）
      options: { embeddingModel: "bge-m3", embeddingDimension: 1024 },
    });
    const out = (await (
      t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>
    )({ query: "Q" }, { toolCallId: "t", messages: [] })) as {
      chunks: { text: string }[];
    };
    expect(out.chunks[0].text).toMatch(/…（已截断）$/);
    expect(out.chunks[0].text.length).toBeLessThan(longText.length);
  });
});

describe("集成：search_web 截断行为", () => {
  it("Tavily ok 时 content 被截断 + 数量受 SEARCH_WEB_MAX_RESULTS 控制", async () => {
    const { buildSearchWebTool } = await import("../search-web.tool");
    const fakeTavily = {
      search: vi.fn().mockResolvedValue({
        status: "ok",
        query: "Q",
        source: "live",
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `T${i}`,
          url: `u${i}`,
          content: "x".repeat(800),
          score: 0.5,
        })),
      }),
    };
    const factory = buildSearchWebTool(fakeTavily as never, makeFakeSpillStorage());
    const t = factory({} as never);
    const out = (await (
      t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>
    )({ query: "Q", maxResults: 8 }, { toolCallId: "t", messages: [] })) as {
      results: { content: string }[];
    };
    expect(out.results).toHaveLength(SEARCH_WEB_MAX_RESULTS);
    expect(out.results[0].content).toMatch(/…（已截断）$/);
  });

  it("Tavily unavailable 原样透传，不做截断处理", async () => {
    const { buildSearchWebTool } = await import("../search-web.tool");
    const fakeTavily = {
      search: vi.fn().mockResolvedValue({
        status: "unavailable",
        query: "Q",
        message: "no key",
      }),
    };
    const t = buildSearchWebTool(fakeTavily as never, makeFakeSpillStorage())({} as never);
    const out = (await (
      t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>
    )({ query: "Q" }, { toolCallId: "t", messages: [] })) as { status: string };
    expect(out.status).toBe("unavailable");
  });
});
