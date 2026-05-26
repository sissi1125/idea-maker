import { describe, expect, it, vi } from "vitest";
import type {
  LLMChatClient,
  QueryRewriteInput,
  QueryRewriteParams,
} from "@harness/shared-types";
import { runQueryRewrite } from "../query-rewrite";
import { PipelineError } from "../../errors";

const defaultParams: QueryRewriteParams = {
  query: "产品的核心功能是什么",
  maxQueries: 3,
  targetAudience: "",
  rewriteGoal: "",
  model: "gpt-4o-mini",
  temperature: 0.7,
  apiKey: undefined,
  baseUrl: undefined,
};

function makeInput(over: Partial<QueryRewriteInput> = {}): QueryRewriteInput {
  return {
    methodId: "none",
    params: defaultParams,
    ...over,
  };
}

describe("runQueryRewrite - none", () => {
  it("透传：rewrittenQueries 只含原 query", async () => {
    const r = await runQueryRewrite(makeInput());
    expect(r.output.rewrittenQueries).toEqual([defaultParams.query]);
    expect(r.output.method).toBe("none");
    expect(r.trace.queryCount).toBe(1);
  });
});

describe("runQueryRewrite - rule-keyword-expansion", () => {
  it("中文 query：生成多个变体，包含原 query", async () => {
    const r = await runQueryRewrite(
      makeInput({ methodId: "rule-keyword-expansion" }),
    );
    expect(r.output.rewrittenQueries.length).toBeGreaterThan(1);
    expect(r.output.rewrittenQueries[0]).toBe(defaultParams.query);
    expect(r.output.method).toBe("rule-keyword-expansion");
  });

  it("targetAudience 注入：生成受众视角变体", async () => {
    const r = await runQueryRewrite(
      makeInput({
        methodId: "rule-keyword-expansion",
        params: { ...defaultParams, targetAudience: "产品经理", maxQueries: 4 },
      }),
    );
    expect(
      r.output.rewrittenQueries.some((q) => q.includes("产品经理")),
    ).toBe(true);
  });

  it("maxQueries 限制最大数量", async () => {
    const r = await runQueryRewrite(
      makeInput({
        methodId: "rule-keyword-expansion",
        params: { ...defaultParams, maxQueries: 2 },
      }),
    );
    expect(r.output.rewrittenQueries.length).toBeLessThanOrEqual(2);
  });

  it("全停用词 query：警告 + 返回原 query", async () => {
    const r = await runQueryRewrite(
      makeInput({
        methodId: "rule-keyword-expansion",
        params: { ...defaultParams, query: "的 和 是" },
      }),
    );
    expect(r.warnings.some((w) => w.includes("未提取到"))).toBe(true);
    expect(r.output.rewrittenQueries).toEqual(["的 和 是"]);
  });

  it("英文 query：token 用空格连接", async () => {
    const r = await runQueryRewrite(
      makeInput({
        methodId: "rule-keyword-expansion",
        params: { ...defaultParams, query: "machine learning fundamentals" },
      }),
    );
    expect(r.output.rewrittenQueries.length).toBeGreaterThan(1);
  });
});

describe("runQueryRewrite - llm-marketing-rewrite (mock client)", () => {
  it("正常调用：解析 LLM 返回的 JSON 数组", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '["产品的核心功能是什么", "产品有哪些主要能力", "核心特性介绍"]' } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runQueryRewrite(
      makeInput({ methodId: "llm-marketing-rewrite", llmClient: client }),
    );
    expect(r.output.rewrittenQueries).toHaveLength(3);
    expect(r.output.rewrittenQueries[0]).toContain("产品");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("LLM 返回非 JSON：回退到原 query", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "对不起，我无法生成。" } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runQueryRewrite(
      makeInput({ methodId: "llm-marketing-rewrite", llmClient: client }),
    );
    expect(r.output.rewrittenQueries).toEqual([defaultParams.query]);
  });

  it("LLM 返回的查询不含原 query：自动插入到首位", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '["完全无关的query A", "另一个 query B"]' } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runQueryRewrite(
      makeInput({ methodId: "llm-marketing-rewrite", llmClient: client }),
    );
    expect(r.output.rewrittenQueries[0]).toBe(defaultParams.query);
    expect(r.output.rewrittenQueries).toContain("完全无关的query A");
  });

  it("rewriteGoal + targetAudience 注入 system prompt", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '["q1"]' } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    await runQueryRewrite(
      makeInput({
        methodId: "llm-marketing-rewrite",
        params: { ...defaultParams, rewriteGoal: "找性能数据", targetAudience: "技术决策者" },
        llmClient: client,
      }),
    );

    const callArg = mockCreate.mock.calls[0][0];
    const systemMsg = callArg.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMsg.content).toContain("找性能数据");
    expect(systemMsg.content).toContain("技术决策者");
  });

  it("缺 llmClient：抛 missing_client", async () => {
    await expect(
      runQueryRewrite(makeInput({ methodId: "llm-marketing-rewrite" })),
    ).rejects.toMatchObject({ code: "missing_client" });
  });
});

describe("runQueryRewrite - 错误路径", () => {
  it("空 query 经 zod 校验已挡，但 rag-core 内 trim 后空也抛 empty_query", async () => {
    await expect(
      runQueryRewrite(makeInput({ params: { ...defaultParams, query: "   " } })),
    ).rejects.toThrowError(PipelineError);
  });
});
