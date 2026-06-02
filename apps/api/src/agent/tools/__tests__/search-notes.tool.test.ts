/**
 * search_notes tool 单测：验证 SQL 入参 + tags=null 边界 + empty 状态。
 */

import { describe, expect, it, vi } from "vitest";
import { buildSearchNotesTool } from "../search-notes.tool";
import type { AgentToolContext } from "../types";
import { makeFakeSpillStorage } from "./_test-utils";
import type { NotesService } from "../../../notes/notes.service";

// feat-300.4：tool 现在还接 NotesService（pgvector 检索）。
// 这些用例聚焦 ILIKE fallback 路径——让 embedding 检索返回 null 即可走 fallback。
function makeFakeNotesService(): NotesService {
  return { searchByEmbedding: vi.fn().mockResolvedValue(null) } as unknown as NotesService;
}

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

const exec = async (toolObj: ReturnType<ReturnType<typeof buildSearchNotesTool>>, args: unknown) =>
  (
    toolObj.execute as (
      args: unknown,
      opts: { toolCallId: string; messages: [] },
    ) => Promise<unknown>
  )(args, { toolCallId: "t1", messages: [] });

describe("search_notes tool", () => {
  it("tags 为空时传 null 入参（避免 @> '{}'::text[] 永真）", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const t = buildSearchNotesTool(makeFakeSpillStorage(), makeFakeNotesService())(makeCtx(pgQuery));
    await exec(t, { query: "护肤" });
    const [, params] = pgQuery.mock.calls[0];
    expect(params[0]).toBe("proj-1");
    expect(params[1]).toBe("护肤");
    expect(params[2]).toBeNull();
    expect(params[3]).toBe(5); // default limit
  });

  it("tags 非空时传数组", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const t = buildSearchNotesTool(makeFakeSpillStorage(), makeFakeNotesService())(makeCtx(pgQuery));
    await exec(t, { query: "Q", tags: ["spring", "skincare"] });
    const [, params] = pgQuery.mock.calls[0];
    expect(params[2]).toEqual(["spring", "skincare"]);
  });

  it("空结果 → status=empty + 建议改用其他 tool", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const t = buildSearchNotesTool(makeFakeSpillStorage(), makeFakeNotesService())(makeCtx(pgQuery));
    const out = (await exec(t, { query: "Q" })) as { status: string; message: string };
    expect(out.status).toBe("empty");
    expect(out.message).toMatch(/search_kb|search_history/);
  });

  it("有结果时返回前 300 字 preview", async () => {
    const long = "x".repeat(500);
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "n-1",
          title: "标题",
          content: long,
          tags: ["a"],
          created_at: new Date("2026-05-01"),
        },
      ],
    });
    const t = buildSearchNotesTool(makeFakeSpillStorage(), makeFakeNotesService())(makeCtx(pgQuery));
    const out = (await exec(t, { query: "Q" })) as {
      notes: { contentPreview: string }[];
    };
    expect(out.notes[0].contentPreview).toHaveLength(300);
  });
});
