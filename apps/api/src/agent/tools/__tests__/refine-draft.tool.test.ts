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
import { makeTestGrounding } from "../../__tests__/grounding.fixture";
import { emptyAgentGroundingContext } from "../../grounding/agent-grounding.types";

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    projectId: "p",
    userId: "u",
    runId: "r",
    pgClient: {} as never,
    embeddingClient: {} as never,
    llmModel: {} as never,
    llmDefaultModel: "x",
    grounding: makeTestGrounding(),
    ...overrides,
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

  it("默认 temperature=0.1（规则修订低温）+ intensity=moderate", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线 [evidence-1]\n===CHANGES===\n改了开头",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    await exec(t, { draft: "d", feedback: "f" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.temperature).toBe(0.1);
    expect(args.system).toMatch(/调整段落顺序/);
  });

  it("intensity=minor → 局部润色提示", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线 [evidence-1]",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    await exec(t, { draft: "d", feedback: "f", intensity: "minor" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.system).toMatch(/语言润色/);
  });

  it("正确切分 revisedDraft / changes", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线 [evidence-1]\n===CHANGES===\n开头加钩子",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    const out = (await exec(t, { draft: "d", feedback: "f" })) as {
      revisedDraft: string;
      changes: string | null;
    };
    expect(out.revisedDraft).toBe("Bloomnote 支持时间线 [evidence-1]");
    expect(out.changes).toBe("开头加钩子");
  });

  it("LLM 不带 ===CHANGES=== 时 changes=null，正文保全", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线 [evidence-1]",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildRefineDraftTool(makeCtx());
    const out = (await exec(t, { draft: "d", feedback: "f" })) as {
      revisedDraft: string;
      changes: string | null;
    };
    expect(out.changes).toBeNull();
    expect(out.revisedDraft).toBe("Bloomnote 支持时间线 [evidence-1]");
  });

  it("无 Confirmed Brief 时不调用 LLM", async () => {
    const t = buildRefineDraftTool(makeCtx({ grounding: emptyAgentGroundingContext() }));
    const out = (await exec(t, { draft: "d", feedback: "f" })) as { status: string };
    expect(out.status).toBe("insufficient_context");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("修订引入无依据规格时 blocked 且不返回正文", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 提供 16GB 空间 [evidence-1]\n===CHANGES===\n增加规格",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const out = (await exec(buildRefineDraftTool(makeCtx()), {
      draft: "Bloomnote [evidence-1]",
      feedback: "增加规格",
    })) as { status: string; revisedDraft?: string };
    expect(out.status).toBe("blocked");
    expect(out.revisedDraft).toBeUndefined();
  });
});
