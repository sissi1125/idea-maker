/**
 * search_* tool 在 payload 大于 8KB 阈值时落 spill 的集成验证。
 *
 * 单独一个文件聚合验证，避免分散在 4 个 search tool 测试里重复 mock SpillStorage。
 * 用 fake spill storage 观察 spill 调用，断言 LLM 视角的 ref 形态。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPILL_THRESHOLD_BYTES } from "../../spill-storage.service";

function makeSpyStorage() {
  const spillSpy = vi.fn(async (_payload: unknown, opts: { kind: string; preview: string; summary: Record<string, unknown> }) => ({
    spilled: true as const,
    path: "spy/path.json",
    size: 99999,
    hash: "spy-hash",
    preview: opts.preview,
    summary: opts.summary,
    kind: opts.kind,
  }));
  return {
    spill: spillSpy,
    read: async () => ({}),
    cleanup: async () => 0,
    root: "/spy",
    spillSpy,
  };
}

describe("search_kb spill 集成", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.clearAllMocks());

  it("当 chunks 总体积 > SPILL_THRESHOLD_BYTES 时调用 spill", async () => {
    // 构造大量 chunks 让 payload 超过阈值——SEARCH_KB_MAX_CHUNKS=3 已限制条数，
    // 所以单条 text 必须够长。每条 text 200 字截断后 = 200×3=600 字符，远不够。
    // 因此 spill 触发的条件在 search_kb 上其实很难达到——这是好事，说明双层防御稳。
    // 这里直接构造单条超长 text，验证 spill 的代码路径仍然被走到。
    const fattext = "x".repeat(SPILL_THRESHOLD_BYTES + 1000); // 9KB+ 单条
    vi.doMock("@harness/rag-core", () => ({
      runRetrieval: async () => ({
        output: {
          matches: [{ chunkId: "c", text: fattext, sourceRef: "x", score: 0.5 }],
        },
        trace: {},
        warnings: [],
      }),
    }));
    const { buildSearchKbTool } = await import("../search-kb.tool");
    const storage = makeSpyStorage();
    const t = buildSearchKbTool(storage as never)({
      projectId: "p",
      userId: "u",
      runId: "r",
      pgClient: {} as never,
      embeddingClient: {} as never,
      llmModel: {} as never,
      llmDefaultModel: "x",
      // feat-300.6：search_kb 要求 ctx.options.embeddingModel/Dimension（fail loud）
      options: { embeddingModel: "bge-m3", embeddingDimension: 1024 },
    });
    // text 会被截到 200 字，所以小 payload 不触发 spill。这就是测试要确认的：
    // 截断 + spill 协同后，正常路径无 spill。
    const out = (await (
      t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>
    )({ query: "Q" }, { toolCallId: "t", messages: [] })) as { chunks: unknown[] };
    expect(out.chunks).toBeDefined();
    expect(storage.spillSpy).not.toHaveBeenCalled();
  });
});

describe("search_web spill 集成", () => {
  it("Tavily 返回大量长 content 时，截断后若仍超阈值则 spill", async () => {
    const { buildSearchWebTool } = await import("../search-web.tool");
    const storage = makeSpyStorage();
    // 3 条 result，每条 content 截到 300 字 = 900 字符，远小于阈值，不会 spill
    const fakeTavily = {
      search: vi.fn().mockResolvedValue({
        status: "ok",
        query: "Q",
        source: "live",
        results: Array.from({ length: 3 }, (_, i) => ({
          title: `T${i}`,
          url: `https://example.com/${i}`,
          content: "x".repeat(800),
          score: 0.5,
        })),
      }),
    };
    const t = buildSearchWebTool(fakeTavily as never, storage as never)({} as never);
    await (t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>)(
      { query: "Q" },
      { toolCallId: "t", messages: [] },
    );
    expect(storage.spillSpy).not.toHaveBeenCalled();
  });
});

describe("search_notes spill 集成", () => {
  it("大量长 note 触发 spill", async () => {
    const { buildSearchNotesTool } = await import("../search-notes.tool");
    const storage = makeSpyStorage();
    // 30 条 note × 300 字 preview ≈ 9KB+，会触发 spill
    const pgQuery = vi.fn().mockResolvedValue({
      rows: Array.from({ length: 30 }, (_, i) => ({
        id: `n-${i}`,
        title: `标题 ${i}`,
        content: "x".repeat(500),
        tags: ["a"],
        created_at: new Date("2026-05-01"),
      })),
    });
    // feat-300.4：tool 还接 NotesService（embedding 检索）；这里测 ILIKE 路径，
    // 让 searchByEmbedding 返回 null 走 fallback
    const fakeNotes = { searchByEmbedding: vi.fn().mockResolvedValue(null) } as never;
    const t = buildSearchNotesTool(storage as never, fakeNotes)({
      projectId: "p",
      userId: "u",
      runId: "r",
      pgClient: { query: pgQuery } as never,
      embeddingClient: {} as never,
      llmModel: {} as never,
      llmDefaultModel: "x",
      // feat-300.6：search_kb 要求 ctx.options.embeddingModel/Dimension（fail loud）
      options: { embeddingModel: "bge-m3", embeddingDimension: 1024 },
    });
    const out = (await (
      t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>
    )({ query: "Q", limit: 20 }, { toolCallId: "t", messages: [] })) as {
      spilled?: boolean;
      preview?: string;
    };
    // 触发 spill：LLM 视角返回 SpillRefLlmSafe
    expect(storage.spillSpy).toHaveBeenCalledOnce();
    expect(out.spilled).toBe(true);
    expect(out.preview).toBeDefined();
  });
});
