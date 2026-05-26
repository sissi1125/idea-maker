import { describe, expect, it, vi } from "vitest";
import type {
  ContextManagementInput,
  ContextManagementParams,
  ConversationTurn,
  LLMChatClient,
} from "@harness/shared-types";
import { runContextManagement } from "../context-management";

const defaultParams: ContextManagementParams = {
  currentMessage: "它的定价怎么样",
  history: [],
  model: "gpt-4o-mini",
  apiKey: undefined,
  baseUrl: undefined,
};

function makeInput(over: Partial<ContextManagementInput> = {}): ContextManagementInput {
  return {
    methodId: "session-history",
    params: defaultParams,
    ...over,
  };
}

describe("runContextManagement - session-history", () => {
  it("无历史：原样返回，wasDisambiguated=false", async () => {
    const r = await runContextManagement(makeInput());
    expect(r.output.wasDisambiguated).toBe(false);
    expect(r.output.query).toBe(defaultParams.currentMessage);
    expect(r.output.sessionHistory).toHaveLength(1);
  });

  it("代词消解：'它'被上轮 user 末尾名词替换", async () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "请介绍下你们的笔记产品" },
      { role: "assistant", content: "这是 XXX 笔记..." },
    ];
    const r = await runContextManagement(
      makeInput({ params: { ...defaultParams, history } }),
    );
    expect(r.output.wasDisambiguated).toBe(true);
    expect(r.output.query).not.toBe(defaultParams.currentMessage);
  });

  it("无代词时：warning 提示", async () => {
    const r = await runContextManagement(
      makeInput({
        params: {
          ...defaultParams,
          currentMessage: "你们产品支持哪些功能",
          history: [{ role: "user", content: "你好" }],
        },
      }),
    );
    expect(r.warnings.some((w) => w.includes("未检测到明显代词"))).toBe(true);
  });

  it("sessionHistory 追加当前消息", async () => {
    const history: ConversationTurn[] = [{ role: "user", content: "之前的问题" }];
    const r = await runContextManagement(
      makeInput({ params: { ...defaultParams, history } }),
    );
    expect(r.output.sessionHistory).toHaveLength(2);
    expect(r.output.sessionHistory[1].content).toBe(defaultParams.currentMessage);
  });
});

describe("runContextManagement - llm-disambiguate (mock)", () => {
  it("LLM 返回改写后的 query", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "笔记产品的定价是多少" } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runContextManagement(
      makeInput({
        methodId: "llm-disambiguate",
        params: {
          ...defaultParams,
          history: [{ role: "user", content: "介绍下笔记产品" }],
        },
        llmClient: client,
      }),
    );
    expect(r.output.query).toBe("笔记产品的定价是多少");
    expect(r.output.wasDisambiguated).toBe(true);
  });

  it("LLM 返回与原消息相同：wasDisambiguated=false", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: defaultParams.currentMessage } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runContextManagement(
      makeInput({ methodId: "llm-disambiguate", llmClient: client }),
    );
    expect(r.output.wasDisambiguated).toBe(false);
  });

  it("缺 llmClient：missing_client", async () => {
    await expect(
      runContextManagement(makeInput({ methodId: "llm-disambiguate" })),
    ).rejects.toMatchObject({ code: "missing_client" });
  });
});

describe("runContextManagement - 错误路径 + trace", () => {
  it("空 currentMessage：empty_message", async () => {
    await expect(
      runContextManagement(makeInput({ params: { ...defaultParams, currentMessage: "  " } })),
    ).rejects.toMatchObject({ code: "empty_message" });
  });

  it("trace 字段完整", async () => {
    const r = await runContextManagement(
      makeInput({
        params: {
          ...defaultParams,
          history: [
            { role: "user", content: "q1" },
            { role: "assistant", content: "a1" },
          ],
        },
      }),
    );
    expect(r.trace.methodId).toBe("session-history");
    expect(r.trace.historyTurns).toBe(2);
  });
});
