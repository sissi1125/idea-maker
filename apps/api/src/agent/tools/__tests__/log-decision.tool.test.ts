/**
 * log_decision tool 单测：SQL 入参 + 返回 stepId。
 */

import { describe, expect, it, vi } from "vitest";
import { buildLogDecisionTool } from "../log-decision.tool";
import type { AgentToolContext } from "../types";

function makeCtx(pgQuery: ReturnType<typeof vi.fn>): AgentToolContext {
  return {
    projectId: "p",
    userId: "u",
    runId: "run-xyz",
    pgClient: { query: pgQuery } as never,
    embeddingClient: {} as never,
    llmModel: {} as never,
    llmDefaultModel: "x",
  };
}
const exec = async (t: ReturnType<typeof buildLogDecisionTool>, args: unknown) =>
  (
    t.execute as (a: unknown, o: { toolCallId: string; messages: [] }) => Promise<unknown>
  )(args, { toolCallId: "tc", messages: [] });

describe("log_decision tool", () => {
  it("写入 agent_steps，input/output 是 JSON string，runId 注入", async () => {
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [{ id: "step-1", created_at: new Date("2026-05-30T00:00:00Z") }],
    });
    const t = buildLogDecisionTool(makeCtx(pgQuery));
    const out = (await exec(t, {
      choice: "用 search_kb",
      reasoning: "本地已有数据",
    })) as { status: string; stepId: string };

    expect(out.status).toBe("ok");
    expect(out.stepId).toBe("step-1");
    const [, params] = pgQuery.mock.calls[0];
    // params: [stepId, runId, inputJson, outputJson]
    expect(params[1]).toBe("run-xyz");
    expect(JSON.parse(params[2])).toEqual({ choice: "用 search_kb" });
    expect(JSON.parse(params[3])).toEqual({ reasoning: "本地已有数据" });
  });
});
