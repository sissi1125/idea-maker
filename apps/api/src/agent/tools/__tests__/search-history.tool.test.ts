/**
 * search_history tool 单测：默认 status=succeeded、source 透传、空结果。
 */

import { describe, expect, it, vi } from "vitest";
import { buildSearchHistoryTool } from "../search-history.tool";
import type { AgentToolContext } from "../types";

function makeCtx(pgQuery: ReturnType<typeof vi.fn>): AgentToolContext {
  return {
    projectId: "proj-1",
    userId: "user-1",
    runId: "run-1",
    pgClient: { query: pgQuery } as never,
    embeddingClient: {} as never,
    llmModel: {} as never,
    llmDefaultModel: "gpt-4o-mini",
  };
}

const exec = async (toolObj: ReturnType<typeof buildSearchHistoryTool>, args: unknown) =>
  (
    toolObj.execute as (
      args: unknown,
      opts: { toolCallId: string; messages: [] },
    ) => Promise<unknown>
  )(args, { toolCallId: "t1", messages: [] });

describe("search_history tool", () => {
  it("默认 status=succeeded、source=null、limit=5", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const t = buildSearchHistoryTool(makeCtx(pgQuery));
    await exec(t, { query: "Q" });
    const [, params] = pgQuery.mock.calls[0];
    expect(params).toEqual(["proj-1", "succeeded", null, "Q", 5]);
  });

  it("status='failed' 透传给 SQL", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const t = buildSearchHistoryTool(makeCtx(pgQuery));
    await exec(t, { query: "Q", status: "failed", source: "auto", limit: 3 });
    const [, params] = pgQuery.mock.calls[0];
    expect(params).toEqual(["proj-1", "failed", "auto", "Q", 3]);
  });

  it("返回结果含 resultPreview（截 300 字）", async () => {
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "g-1",
          query: "Q1",
          status: "succeeded",
          source: "manual",
          result_notes: "y".repeat(500),
          created_at: new Date("2026-05-01"),
        },
      ],
    });
    const t = buildSearchHistoryTool(makeCtx(pgQuery));
    const out = (await exec(t, { query: "Q" })) as {
      generations: { resultPreview: string }[];
    };
    expect(out.generations[0].resultPreview).toHaveLength(300);
  });

  it("result_notes 为 null 时 resultPreview=null（不抛错）", async () => {
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "g-1",
          query: "Q1",
          status: "succeeded",
          source: "manual",
          result_notes: null,
          created_at: new Date("2026-05-01"),
        },
      ],
    });
    const t = buildSearchHistoryTool(makeCtx(pgQuery));
    const out = (await exec(t, { query: "Q" })) as {
      generations: { resultPreview: string | null }[];
    };
    expect(out.generations[0].resultPreview).toBeNull();
  });
});
