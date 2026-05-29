/**
 * refine_draft tool 单测：
 *  - intensity 映射到 system prompt 指令
 *  - 输出按 ===CHANGES=== 切分
 *  - 没有 ===CHANGES=== 时 changes=null 不抛错
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: (args: unknown) => generateTextMock(args) };
});

import { buildRefineDraftTool } from "../refine-draft.tool";
import type { AgentToolContext } from "../types";

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
const exec = async (toolObj: ReturnType<typeof buildRefineDraftTool>, args: unknown) =>
  (
    toolObj.execute as (
      a: unknown,
      o: { toolCallId: string; messages: [] },
    ) => Promise<unknown>
  )(args, { toolCallId: "t", messages: [] });

describe("refine_draft tool", () => {
  beforeEach(() => generateTextMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("默认 temperature=0.4（比 generate 低）+ intensity=moderate", async () => {
    generateTextMock.mockResolvedValue({
      text: "newbody\n===CHANGES===\n改了开头",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    await exec(t, { draft: "d", feedback: "f" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.temperature).toBe(0.4);
    expect(args.system).toMatch(/调整段落顺序/);
  });

  it("intensity=minor → 局部润色提示", async () => {
    generateTextMock.mockResolvedValue({
      text: "x",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    await exec(t, { draft: "d", feedback: "f", intensity: "minor" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.system).toMatch(/语言润色/);
  });

  it("正确切分 revisedDraft / changes", async () => {
    generateTextMock.mockResolvedValue({
      text: "正文 v2\n===CHANGES===\n开头加钩子",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    const out = (await exec(t, { draft: "d", feedback: "f" })) as {
      revisedDraft: string;
      changes: string | null;
    };
    expect(out.revisedDraft).toBe("正文 v2");
    expect(out.changes).toBe("开头加钩子");
  });

  it("LLM 不带 ===CHANGES=== 时 changes=null，正文保全", async () => {
    generateTextMock.mockResolvedValue({
      text: "整段正文没分隔符",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    const out = (await exec(t, { draft: "d", feedback: "f" })) as {
      revisedDraft: string;
      changes: string | null;
    };
    expect(out.changes).toBeNull();
    expect(out.revisedDraft).toBe("整段正文没分隔符");
  });
});
