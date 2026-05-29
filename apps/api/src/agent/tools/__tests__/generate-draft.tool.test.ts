/**
 * generate_draft tool 单测：
 *  - generateText 入参（system 含规范，prompt 含 task / evidence）
 *  - cited sources 抽取（[evidence-N] → source）
 *  - 无 evidence 时 prompt 走"无具体 evidence"分支
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: (args: unknown) => generateTextMock(args),
  };
});

import { buildGenerateDraftTool } from "../generate-draft.tool";
import type { AgentToolContext } from "../types";

function makeCtx(): AgentToolContext {
  return {
    projectId: "p",
    userId: "u",
    runId: "r",
    pgClient: {} as never,
    embeddingClient: {} as never,
    llmModel: { __mock: true } as never,
    llmDefaultModel: "x",
  };
}

const exec = async (toolObj: ReturnType<typeof buildGenerateDraftTool>, args: unknown) =>
  (
    toolObj.execute as (
      args: unknown,
      opts: { toolCallId: string; messages: [] },
    ) => Promise<unknown>
  )(args, { toolCallId: "t1", messages: [] });

describe("generate_draft tool", () => {
  beforeEach(() => generateTextMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("默认 temperature=0.7、传入 ctx.llmModel", async () => {
    generateTextMock.mockResolvedValue({
      text: "draft body",
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    await exec(t, { task: "写一段文案", evidence: [] });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.temperature).toBe(0.7);
    expect(args.model).toEqual({ __mock: true });
    expect(args.system).toMatch(/evidence/);
  });

  it("抽取 [evidence-N] 引用到 source", async () => {
    generateTextMock.mockResolvedValue({
      text: "前半段 [evidence-1] 后半段 [evidence-3] 结尾",
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    const out = (await exec(t, {
      task: "T",
      evidence: [
        { source: "chunk-a", text: "a" },
        { source: "chunk-b", text: "b" },
        { source: "chunk-c", text: "c" },
      ],
    })) as { citedSources: string[] };
    expect(out.citedSources).toEqual(["chunk-a", "chunk-c"]);
  });

  it("超界的 [evidence-N] 被丢弃（不抛错）", async () => {
    generateTextMock.mockResolvedValue({
      text: "用了 [evidence-99] 不存在的",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    const out = (await exec(t, {
      task: "T",
      evidence: [{ source: "x", text: "y" }],
    })) as { citedSources: string[] };
    expect(out.citedSources).toEqual([]);
  });

  it("无 evidence 时 prompt 提示'基于通用知识'", async () => {
    generateTextMock.mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    await exec(t, { task: "T" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).toMatch(/无具体 evidence/);
  });

  it("constraints 拼到 prompt（硬约束）", async () => {
    generateTextMock.mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    await exec(t, { task: "T", constraints: "不超过 80 字" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).toMatch(/不超过 80 字/);
  });
});
