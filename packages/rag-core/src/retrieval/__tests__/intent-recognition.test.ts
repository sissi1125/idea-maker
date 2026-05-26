import { describe, expect, it, vi } from "vitest";
import type {
  IntentRecognitionInput,
  IntentRecognitionParams,
  LLMChatClient,
} from "@harness/shared-types";
import { runIntentRecognition } from "../intent-recognition";

const defaultParams: IntentRecognitionParams = {
  query: "",
  intents: undefined,
  model: "gpt-4o-mini",
  apiKey: undefined,
  baseUrl: undefined,
};

function makeInput(over: Partial<IntentRecognitionInput> = {}): IntentRecognitionInput {
  return {
    methodId: "rule-based",
    params: defaultParams,
    ...over,
  };
}

describe("runIntentRecognition - rule-based", () => {
  it("营销类查询：marketing-strategy", async () => {
    const r = await runIntentRecognition(
      makeInput({ params: { ...defaultParams, query: "怎么写小红书营销文案" } }),
    );
    expect(r.output.intent).toBe("marketing-strategy");
    expect(r.output.routingDecision).toBe("continue");
  });

  it("闲聊：chitchat + skip-retrieval + warning", async () => {
    const r = await runIntentRecognition(
      makeInput({ params: { ...defaultParams, query: "你好" } }),
    );
    expect(r.output.intent).toBe("chitchat");
    expect(r.output.routingDecision).toBe("skip-retrieval");
    expect(r.warnings.some((w) => w.includes("建议跳过"))).toBe(true);
  });

  it("超范围（股票）：out-of-scope + skip-retrieval", async () => {
    const r = await runIntentRecognition(
      makeInput({ params: { ...defaultParams, query: "最近股票行情怎么样" } }),
    );
    expect(r.output.intent).toBe("out-of-scope");
    expect(r.output.routingDecision).toBe("skip-retrieval");
  });

  it("默认（无规则命中）：knowledge-qa", async () => {
    const r = await runIntentRecognition(
      makeInput({ params: { ...defaultParams, query: "产品支持哪些文件格式" } }),
    );
    expect(r.output.intent).toBe("knowledge-qa");
    expect(r.output.routingDecision).toBe("continue");
  });

  it("upstreamQuery 优先于 params.query", async () => {
    const r = await runIntentRecognition(
      makeInput({
        params: { ...defaultParams, query: "营销文案怎么写" },
        upstreamQuery: "你好",
      }),
    );
    // upstreamQuery 是"你好" → chitchat
    expect(r.output.intent).toBe("chitchat");
    expect(r.output.query).toBe("你好");
  });
});

describe("runIntentRecognition - llm-router (mock)", () => {
  it("正常分类：返回 LLM 给出的 intent", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        { message: { content: '{"intent":"marketing-strategy","confidence":0.92,"reason":"营销文案需求"}' } },
      ],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runIntentRecognition(
      makeInput({
        methodId: "llm-router",
        params: { ...defaultParams, query: "帮我写个产品 slogan" },
        llmClient: client,
      }),
    );
    expect(r.output.intent).toBe("marketing-strategy");
    expect(r.output.confidence).toBe(0.92);
    expect(r.output.routingReason).toContain("营销文案");
  });

  it("LLM 返回未知 intent：回退 knowledge-qa", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"intent":"非法值","confidence":0.5}' } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runIntentRecognition(
      makeInput({
        methodId: "llm-router",
        params: { ...defaultParams, query: "test" },
        llmClient: client,
      }),
    );
    expect(r.output.intent).toBe("knowledge-qa");
  });

  it("LLM 返回非 JSON：parse 失败仍回退 knowledge-qa", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "I don't know" } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runIntentRecognition(
      makeInput({
        methodId: "llm-router",
        params: { ...defaultParams, query: "test" },
        llmClient: client,
      }),
    );
    expect(r.output.intent).toBe("knowledge-qa");
  });

  it("confidence 被 clamp 到 [0, 1]", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"intent":"chitchat","confidence":2.5}' } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runIntentRecognition(
      makeInput({
        methodId: "llm-router",
        params: { ...defaultParams, query: "test" },
        llmClient: client,
      }),
    );
    expect(r.output.confidence).toBe(1);
  });

  it("缺 llmClient：抛 missing_client", async () => {
    await expect(
      runIntentRecognition(
        makeInput({
          methodId: "llm-router",
          params: { ...defaultParams, query: "test" },
        }),
      ),
    ).rejects.toMatchObject({ code: "missing_client" });
  });
});

describe("runIntentRecognition - 错误路径", () => {
  it("空 query 且无 upstreamQuery：抛 empty_query", async () => {
    await expect(runIntentRecognition(makeInput())).rejects.toMatchObject({
      code: "empty_query",
    });
  });
});
