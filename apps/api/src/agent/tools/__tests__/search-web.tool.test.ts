/**
 * search_web tool 单测：验证它就是一层薄薄的 TavilyClient 转发。
 */

import { describe, expect, it, vi } from "vitest";
import { buildSearchWebTool } from "../search-web.tool";
import type { AgentToolContext } from "../types";
import type { TavilyClient } from "../../../llm/tavily.client";

function makeCtx(): AgentToolContext {
  return {
    projectId: "p",
    userId: "u",
    runId: "r",
    pgClient: {} as never,
    embeddingClient: {} as never,
    llmModel: {} as never,
    llmDefaultModel: "x",
  };
}

const exec = async (toolObj: ReturnType<ReturnType<typeof buildSearchWebTool>>, args: unknown) =>
  (
    toolObj.execute as (
      args: unknown,
      opts: { toolCallId: string; messages: [] },
    ) => Promise<unknown>
  )(args, { toolCallId: "t1", messages: [] });

describe("search_web tool", () => {
  it("原样转发参数到 TavilyClient.search", async () => {
    const searchMock = vi
      .fn()
      .mockResolvedValue({ status: "ok", query: "Q", results: [], source: "live" });
    const fakeClient = { search: searchMock } as unknown as TavilyClient;
    const factory = buildSearchWebTool(fakeClient);
    const t = factory(makeCtx());
    await exec(t, { query: "Q", maxResults: 7, searchDepth: "advanced" });
    expect(searchMock).toHaveBeenCalledWith({
      query: "Q",
      maxResults: 7,
      searchDepth: "advanced",
    });
  });

  it("透传 TavilyClient 的 unavailable 状态（不吞）", async () => {
    const fakeClient = {
      search: vi.fn().mockResolvedValue({
        status: "unavailable",
        query: "Q",
        message: "no key",
      }),
    } as unknown as TavilyClient;
    const t = buildSearchWebTool(fakeClient)(makeCtx());
    const out = (await exec(t, { query: "Q" })) as { status: string };
    expect(out.status).toBe("unavailable");
  });
});
