/**
 * generate_draft tool 单测：
 *  - generateText 入参（system 含规范，prompt 含 task / evidence）
 *  - cited sources 抽取（[evidence-N] → source）
 *  - outer Agent 不传 evidence 时仍使用服务端 Grounding
 *  - 无 Brief、无引用、硬事实和平台违规全部 fail closed
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
import { makeTestGrounding } from "../../__tests__/grounding.fixture";
import { emptyAgentGroundingContext } from "../../grounding/agent-grounding.types";

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    projectId: "p",
    userId: "u",
    runId: "r",
    pgClient: {} as never,
    embeddingClient: {} as never,
    llmModel: { __mock: true } as never,
    llmDefaultModel: "x",
    grounding: makeTestGrounding(),
    ...overrides,
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

  it("默认 temperature=0.4、传入 ctx.llmModel", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线管理 [evidence-1]",
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    await exec(t, { task: "写一段文案", evidence: [] });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.temperature).toBe(0.4);
    expect(args.model).toEqual({ __mock: true });
    expect(args.system).toMatch(/evidence/);
  });

  it("抽取 [evidence-N] 引用到 source", async () => {
    generateTextMock.mockResolvedValue({
      text: "前半段 [evidence-1] 后半段 [evidence-2] 结尾",
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
    expect(out.citedSources).toEqual([
      "brief-field:field-name",
      "brief-field:field-feature",
    ]);
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

  it("outer Agent 不传 evidence 时仍注入服务端 Grounding", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线 [evidence-1]",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    await exec(t, { task: "T" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).toContain("brief-field:field-name");
    expect(args.system).toContain("Product Brief 事实");
    expect(args.prompt).toContain("输出前必须逐项自检");
  });

  it("constraints 拼到 prompt（硬约束）", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线 [evidence-1]",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const t = buildGenerateDraftTool(makeCtx());
    await exec(t, { task: "T", constraints: "不超过 80 字" });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).toMatch(/不超过 80 字/);
  });

  it("无 Confirmed Brief 时不调用 LLM", async () => {
    const t = buildGenerateDraftTool(makeCtx({ grounding: emptyAgentGroundingContext() }));
    const out = (await exec(t, { task: "写文案" })) as { status: string };
    expect(out.status).toBe("insufficient_context");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("无依据价格返回 blocked，且不暴露 draft", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 每月 99 元 [evidence-1]",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const out = (await exec(buildGenerateDraftTool(makeCtx()), { task: "写文案" })) as {
      status: string;
      draft?: string;
      unsupportedHardFacts: string[];
    };
    expect(out.status).toBe("blocked");
    expect(out.draft).toBeUndefined();
    expect(out.unsupportedHardFacts).toContain("99元");
  });

  it("仅平台规则失败时返回可供 refine 的 grounded candidate", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 支持时间线 [evidence-2]",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const grounding = makeTestGrounding({
      platformRules: [{
        id: "rule-xhs",
        projectId: "p",
        name: "小红书",
        config: { mandatoryTagPattern: "#\\S+", mandatoryTagMin: 3 },
        enabled: true,
        createdAt: "",
        updatedAt: "",
      }],
    });
    const out = (await exec(buildGenerateDraftTool(makeCtx({ grounding })), { task: "写文案" })) as {
      status: string;
      draft?: string;
      candidateDraft?: string;
    };
    expect(out.status).toBe("blocked");
    expect(out.draft).toBeUndefined();
    expect(out.candidateDraft).toContain("Bloomnote");
  });

  it("只有禁词失败时确定性删除后重新校验并返回 ok", async () => {
    generateTextMock.mockResolvedValue({
      text: "Bloomnote 最大亮点是时间线管理 [evidence-2] #笔记 #记录 #整理",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const grounding = makeTestGrounding({
      platformRules: [{
        id: "rule-xhs",
        projectId: "p",
        name: "小红书",
        config: { bannedKeywords: ["最"], mandatoryTagPattern: "#\\S+", mandatoryTagMin: 3 },
        enabled: true,
        createdAt: "",
        updatedAt: "",
      }],
    });
    const out = (await exec(buildGenerateDraftTool(makeCtx({ grounding })), { task: "写文案" })) as {
      status: string;
      draft: string;
      normalizations: { removedKeywords: string[] };
    };
    expect(out.status).toBe("ok");
    expect(out.draft).not.toContain("最");
    expect(out.normalizations.removedKeywords).toEqual(["最"]);
  });
});
