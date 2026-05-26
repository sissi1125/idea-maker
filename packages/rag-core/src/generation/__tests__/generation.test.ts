import { describe, expect, it, vi } from "vitest";
import type {
  GenerationInput,
  GenerationParams,
  LLMChatClient,
  PromptBuildOutput,
} from "@harness/shared-types";
import { runGeneration } from "../generation";

const defaultParams: GenerationParams = {
  model: "",
  apiKey: undefined,
  baseUrl: undefined,
  temperature: 0.7,
  includeEvidence: true,
  ideaCount: 5,
  targetAudience: "",
};

function makeUpstream(over: Partial<PromptBuildOutput> = {}): PromptBuildOutput {
  return {
    systemPrompt: "你是助手",
    userPrompt: "参考资料：[evidence-001] xxx\n用户问题：产品功能",
    fullPrompt: "...",
    tokenEstimate: 100,
    originalQuery: "产品功能",
    warnings: [],
    ...over,
  };
}

function makeMockClient(content: string, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
    usage,
  });
  const client: LLMChatClient = { chat: { completions: { create } } };
  return { client, create };
}

function makeInput(over: Partial<GenerationInput> = {}): GenerationInput {
  const { client } = makeMockClient("默认输出");
  return {
    methodId: "marketing-ideas",
    params: defaultParams,
    upstream: makeUpstream(),
    llmClient: client,
    defaultModel: "gpt-4o-mini",
    ...over,
  };
}

describe("runGeneration - marketing-ideas", () => {
  it("LLM 返回内容 + 提取 [evidence-NNN] 引用", async () => {
    const { client } = makeMockClient(
      "基于 [evidence-001] 我们认为...再看 [evidence-002] 的支撑",
    );
    const r = await runGeneration(makeInput({ llmClient: client }));
    if ("generatedContent" in r.output) {
      expect(r.output.generatedContent).toContain("evidence-001");
      expect(r.output.citedEvidenceIds).toEqual(
        expect.arrayContaining(["[evidence-001]", "[evidence-002]"]),
      );
    }
    expect(r.trace.citedCount).toBe(2);
  });

  it("空内容：warning + citedCount=0", async () => {
    const { client } = makeMockClient("");
    const r = await runGeneration(makeInput({ llmClient: client }));
    expect(r.warnings.some((w) => w.includes("空内容"))).toBe(true);
  });

  it("有 LLM 内容但无 evidence 引用 + includeEvidence=true：warning", async () => {
    const { client } = makeMockClient("没有引用的输出");
    const r = await runGeneration(makeInput({ llmClient: client }));
    expect(r.warnings.some((w) => w.includes("未检测到 evidence 引用"))).toBe(true);
  });

  it("匹配数字引用 [1] [2] 格式", async () => {
    const { client } = makeMockClient("根据 [1] 和 [2] 资料");
    const r = await runGeneration(makeInput({ llmClient: client }));
    if ("citedEvidenceIds" in r.output) {
      expect(r.output.citedEvidenceIds).toContain("[1]");
      expect(r.output.citedEvidenceIds).toContain("[2]");
    }
  });
});

describe("runGeneration - product-persona (JSON mode)", () => {
  it("解析 LLM 返回的 JSON", async () => {
    const { client } = makeMockClient(
      JSON.stringify({
        targetSegment: "产品经理",
        painPoints: ["痛点 A", "痛点 B"],
        coreNeeds: ["需求 1"],
        summary: "总结",
        citedEvidenceIds: ["[1]"],
      }),
    );
    const r = await runGeneration(
      makeInput({ methodId: "product-persona", llmClient: client }),
    );
    if ("targetSegment" in r.output) {
      expect(r.output.targetSegment).toBe("产品经理");
      expect(r.output.painPoints).toHaveLength(2);
      expect(r.output.citedEvidenceIds).toEqual(["[1]"]);
    }
  });

  it("非 JSON 返回：warning + 各字段默认值", async () => {
    const { client } = makeMockClient("not json");
    const r = await runGeneration(
      makeInput({ methodId: "product-persona", llmClient: client }),
    );
    expect(r.warnings.some((w) => w.includes("无法解析为 JSON"))).toBe(true);
    if ("painPoints" in r.output) {
      expect(r.output.painPoints).toEqual([]);
    }
  });
});

describe("runGeneration - selling-points", () => {
  it("从 sellingPoints[].evidenceIds 兜底汇总 citedEvidenceIds", async () => {
    const { client } = makeMockClient(
      JSON.stringify({
        sellingPoints: [
          { title: "卖点1", description: "x", evidenceIds: ["[1]"] },
          { title: "卖点2", description: "y", evidenceIds: ["[2]", "[3]"] },
        ],
        differentiators: ["差异化 A"],
        summary: "总结",
        // 故意不给 citedEvidenceIds 顶层字段
      }),
    );
    const r = await runGeneration(
      makeInput({ methodId: "selling-points", llmClient: client }),
    );
    if ("sellingPoints" in r.output) {
      expect(r.output.citedEvidenceIds).toEqual(
        expect.arrayContaining(["[1]", "[2]", "[3]"]),
      );
    }
  });
});

describe("runGeneration - content-ideas", () => {
  it("生成 ideaCount 提示注入 system prompt", async () => {
    const { client, create } = makeMockClient(
      JSON.stringify({
        ideas: [
          { title: "标题1", angle: "角度1", format: "短视频", evidenceIds: ["[1]"] },
        ],
        summary: "x",
        citedEvidenceIds: ["[1]"],
      }),
    );
    await runGeneration(
      makeInput({
        methodId: "content-ideas",
        params: { ...defaultParams, ideaCount: 8 },
        llmClient: client,
      }),
    );
    const systemArg = create.mock.calls[0][0].messages[0].content;
    expect(systemArg).toContain("生成 8 条 idea");
  });
});

describe("runGeneration - 注入校验 + 错误路径", () => {
  it("空 userPrompt：empty_prompt", async () => {
    await expect(
      runGeneration(
        makeInput({ upstream: makeUpstream({ userPrompt: "  " }) }),
      ),
    ).rejects.toMatchObject({ code: "empty_prompt" });
  });

  it("LLM 抛 401：api_auth_failed", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Incorrect API key (401)"));
    const client: LLMChatClient = { chat: { completions: { create } } };
    await expect(
      runGeneration(makeInput({ llmClient: client })),
    ).rejects.toMatchObject({ code: "api_auth_failed" });
  });

  it("LLM 抛 429：rate_limited", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Rate limit hit 429"));
    const client: LLMChatClient = { chat: { completions: { create } } };
    await expect(
      runGeneration(makeInput({ llmClient: client })),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("runGeneration - trace + evidence 透传", () => {
  it("trace 含 inputTokens / outputTokens / citedCount / model", async () => {
    const { client } = makeMockClient("[evidence-001] 内容", {
      prompt_tokens: 200,
      completion_tokens: 80,
    });
    const r = await runGeneration(makeInput({ llmClient: client }));
    expect(r.trace.inputTokens).toBe(200);
    expect(r.trace.outputTokens).toBe(80);
    expect(r.trace.citedCount).toBeGreaterThan(0);
    expect(r.trace.model).toBe("gpt-4o-mini"); // defaultModel
  });

  it("自定义 params.model 覆盖 defaultModel", async () => {
    const { client } = makeMockClient("[1]");
    const r = await runGeneration(
      makeInput({
        params: { ...defaultParams, model: "claude-3-haiku" },
        llmClient: client,
      }),
    );
    expect(r.trace.model).toBe("claude-3-haiku");
  });

  it("evidencePack 从 upstream 透传到 output", async () => {
    const { client } = makeMockClient("");
    const r = await runGeneration(
      makeInput({
        upstream: makeUpstream({
          evidencePack: [
            {
              evidenceId: "a",
              text: "x",
              sourceRef: "X",
              documentId: "d",
              version: 1,
              chunkIndex: 0,
              pageNumber: null,
              score: 0.9,
            },
          ],
        }),
        llmClient: client,
      }),
    );
    expect(r.output.evidencePack).toBeDefined();
    expect(r.output.evidencePack).toHaveLength(1);
  });
});
