/**
 * AgentRunnerService 单测：覆盖四条收尾路径（done / budget / abort / error）。
 *
 * 策略：mock generateText 直接发 onStepFinish 回调来模拟 ReAct 循环。
 * mock 所有注入的依赖（不依赖真实 DB、不真实调 LLM）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock("ai", () => ({
  generateText: generateTextMock,
  // 留住 tool / 其他 export 兼容（仅写出 AgentRunner 用到的）
  tool: <T>(x: T) => x,
}));

import { AgentRunnerService } from "../agent-runner.service";
import type { AgentRunInput } from "../agent.types";

// 构造一个完整的 service + mocks
function makeRunner() {
  const projects = {
    get: vi.fn().mockResolvedValue({ id: "p", name: "测试项目" }),
    getSettings: vi.fn().mockResolvedValue({
      provider: "openai",
      encryptedApiKey: "key",
      model: "gpt-4o-mini",
    }),
  };
  const llm = {
    create: vi.fn().mockReturnValue({ __mockModel: true }),
  };
  const providers = {
    createEmbeddingClient: vi.fn().mockReturnValue({
      client: { __mockEmbed: true },
      defaultModel: "text-embedding-v4",
      defaultDimension: 1024,
    }),
  };
  const memory = {
    load: vi.fn().mockResolvedValue([]),
  };
  const tools = {
    build: vi.fn().mockReturnValue({}),
  };
  const contextManager = {
    shouldCompress: vi.fn().mockReturnValue(false),
    compress: vi.fn(),
  };
  const repo = {
    createRun: vi.fn().mockResolvedValue("run-1"),
    appendStep: vi.fn().mockResolvedValue("step-id"),
    updateProgress: vi.fn(),
    finalize: vi.fn(),
    getSteps: vi.fn().mockResolvedValue([]),
  };
  const sse = {
    emitStep: vi.fn(),
    emitCost: vi.fn(),
    emitFinish: vi.fn(),
    emitError: vi.fn(),
  };
  const spillStorage = {};
  const costs = {
    recordGeneration: vi.fn().mockResolvedValue(undefined),
  };
  const platformRulesService = {
    list: vi.fn().mockResolvedValue([]),
  };

  const runner = new AgentRunnerService(
    projects as never,
    llm as never,
    providers as never,
    memory as never,
    tools as never,
    contextManager as never,
    repo as never,
    sse as never,
    spillStorage as never,
    costs as never,
    platformRulesService as never,
  );
  return {
    runner,
    projects,
    llm,
    providers,
    memory,
    tools,
    contextManager,
    repo,
    sse,
    costs,
    platformRulesService,
  };
}

const sampleInput: AgentRunInput = {
  projectId: "p",
  userId: "u",
  messages: [{ role: "user", content: "写一段护肤文案" }],
};

function makePg() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe("AgentRunnerService 成功路径", () => {
  beforeEach(() => generateTextMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("LLM 自主收尾 → finishReason='done' + status='succeeded'", async () => {
    const { runner, repo, sse } = makeRunner();
    const pg = makePg();
    generateTextMock.mockImplementationOnce(async ({ onStepFinish }) => {
      // 模拟 1 步 reasoning
      await onStepFinish({
        text: "已分析需求",
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 100, completionTokens: 30 },
      });
      return {
        text: "最终文案输出",
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 30 },
      };
    });

    const out = await runner.run(pg as never, sampleInput);
    expect(out.finishReason).toBe("done");
    expect(out.text).toBe("最终文案输出");
    expect(repo.finalize).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ status: "succeeded", finishReason: "done" }),
    );
    expect(sse.emitFinish).toHaveBeenCalled();
  });

  it("system prompt 注入项目真实 name（来自 projects.get）", async () => {
    const { runner, projects } = makeRunner();
    projects.get.mockResolvedValue({ id: "p", name: "护肤项目" });
    const pg = makePg();
    let capturedSystem: string | undefined;
    generateTextMock.mockImplementationOnce(async ({ system }) => {
      capturedSystem = system;
      return {
        text: "ok",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 },
      };
    });

    await runner.run(pg as never, sampleInput);
    expect(capturedSystem).toContain("护肤项目");
    expect(capturedSystem).not.toContain("「p」"); // 不应回落到 projectId
  });

  it("成功收尾后调 costs.recordGeneration 写入 cost_summary", async () => {
    const { runner, costs } = makeRunner();
    const pg = makePg();
    generateTextMock.mockImplementationOnce(async ({ onStepFinish }) => {
      await onStepFinish({
        text: "x",
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 100, completionTokens: 30 },
      });
      return {
        text: "ok",
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 30 },
      };
    });

    await runner.run(pg as never, sampleInput);
    expect(costs.recordGeneration).toHaveBeenCalledWith(
      expect.anything(),
      "p", // projectId
      expect.objectContaining({ costUsd: expect.any(Number) }),
    );
  });

  it("启用的 platform_rules 注入 system prompt + critic 评判标准", async () => {
    const { runner, platformRulesService, tools } = makeRunner();
    platformRulesService.list.mockResolvedValue([
      {
        id: "1",
        projectId: "p",
        name: "小红书",
        config: { maxLength: 100, bannedKeywords: ["秒杀"] },
        enabled: true,
        createdAt: "2026-05-30T00:00:00Z",
        updatedAt: "2026-05-30T00:00:00Z",
      },
      {
        id: "2",
        projectId: "p",
        name: "已禁用",
        config: { maxLength: 200 },
        enabled: false,
      },
    ]);
    const pg = makePg();
    let capturedSystem: string | undefined;
    generateTextMock.mockImplementationOnce(async ({ system }) => {
      capturedSystem = system;
      return {
        text: "ok",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 },
      };
    });

    await runner.run(pg as never, sampleInput);
    // 启用的小红书规则注入 system prompt
    expect(capturedSystem).toContain("小红书");
    expect(capturedSystem).toContain("整段不超过 100 字");
    expect(capturedSystem).toContain("秒杀");
    // 禁用规则不出现
    expect(capturedSystem).not.toContain("已禁用");
    // criticCriteria 也带上展平后的约束
    const buildOpts = tools.build.mock.calls[0][1];
    expect(buildOpts.criticCriteria.platformRules).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/100 字/),
        expect.stringMatching(/秒杀/),
      ]),
    );
  });

  it("project.name 为空时回落到 projectId", async () => {
    const { runner, projects } = makeRunner();
    projects.get.mockResolvedValue({ id: "p", name: "   " }); // 全空白
    const pg = makePg();
    let capturedSystem: string | undefined;
    generateTextMock.mockImplementationOnce(async ({ system }) => {
      capturedSystem = system;
      return {
        text: "ok",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 },
      };
    });

    await runner.run(pg as never, sampleInput);
    expect(capturedSystem).toContain("「p」"); // 回落到 projectId
  });
});

describe("AgentRunnerService budget 路径", () => {
  beforeEach(() => generateTextMock.mockReset());

  it("累计成本超 budget → finishReason='budget' + fallback 拼 chunks", async () => {
    const { runner, repo, sse } = makeRunner();
    const pg = makePg();
    // 把 getSteps 返回一个有 chunks 的 tool_result，让 fallback 拼出内容
    repo.getSteps.mockResolvedValue([
      {
        stepType: "tool_result",
        toolName: "search_kb",
        output: {
          result: {
            chunks: [{ text: "护肤要点 1", source: "doc-a" }],
          },
        },
      },
    ]);
    generateTextMock.mockImplementationOnce(async ({ onStepFinish }) => {
      // 一步消耗大量 token 触发 budget
      await onStepFinish({
        text: "thinking",
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10_000_000, completionTokens: 10_000_000 },
      });
      // 不会走到 return，因为 onStepFinish 已 throw
      return { text: "", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } };
    });

    const out = await runner.run(pg as never, {
      ...sampleInput,
      budgetUsd: 0.0001, // 极小预算，必然触发
    });
    expect(out.finishReason).toBe("budget");
    expect(out.text).toMatch(/已搜集到的资料/);
    expect(out.text).toContain("护肤要点 1");
    expect(repo.finalize).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ finishReason: "budget" }),
    );
    expect(sse.emitFinish).toHaveBeenCalled();
  });

  it("budget 路径也调 recordGeneration（钱花了就要算账）", async () => {
    const { runner, costs } = makeRunner();
    const pg = makePg();
    generateTextMock.mockImplementationOnce(async ({ onStepFinish }) => {
      await onStepFinish({
        text: "x",
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10_000_000, completionTokens: 10_000_000 },
      });
      return { text: "", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } };
    });
    await runner.run(pg as never, { ...sampleInput, budgetUsd: 0.0001 });
    expect(costs.recordGeneration).toHaveBeenCalled();
  });

  it("budget 路径但无 chunks → 返回兜底文案不抛错", async () => {
    const { runner } = makeRunner();
    const pg = makePg();
    generateTextMock.mockImplementationOnce(async ({ onStepFinish }) => {
      await onStepFinish({
        text: "x",
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10_000_000, completionTokens: 10_000_000 },
      });
      return { text: "", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } };
    });
    const out = await runner.run(pg as never, { ...sampleInput, budgetUsd: 0.0001 });
    expect(out.text).toMatch(/未收集到足够材料/);
  });
});

describe("AgentRunnerService abort 路径", () => {
  beforeEach(() => generateTextMock.mockReset());

  it("AbortError 被识别 → finishReason='aborted'", async () => {
    const { runner, repo } = makeRunner();
    const pg = makePg();
    generateTextMock.mockImplementationOnce(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });

    const out = await runner.run(pg as never, sampleInput);
    expect(out.finishReason).toBe("aborted");
    expect(repo.finalize).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ finishReason: "aborted" }),
    );
  });

  it("abort(runId) 在 registry 找到对应 controller", async () => {
    const { runner } = makeRunner();
    const pg = makePg();
    // 启动 run 并让它"挂着"等 abort
    let abortSignal: AbortSignal | undefined;
    generateTextMock.mockImplementationOnce(async ({ abortSignal: sig }) => {
      abortSignal = sig as AbortSignal;
      // 主动等到 abort 触发
      await new Promise<void>((resolve, reject) => {
        sig.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
        // 不主动 resolve
      });
      return { text: "", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } };
    });

    const runP = runner.run(pg as never, sampleInput);

    // 等所有 await（getSettings/createGen/createRun 等）完成 + AbortController 注册
    // 用 setImmediate 让事件循环把 microtask 队列完全清空
    await new Promise((resolve) => setImmediate(resolve));

    const aborted = runner.abort("run-1");
    expect(aborted).toBe(true);
    expect(abortSignal?.aborted).toBe(true);

    const out = await runP;
    expect(out.finishReason).toBe("aborted");
  });

  it("abort 未找到 run 返 false", () => {
    const { runner } = makeRunner();
    expect(runner.abort("不存在")).toBe(false);
  });
});

describe("AgentRunnerService 系统异常路径", () => {
  beforeEach(() => generateTextMock.mockReset());

  it("系统异常路径 NOT 调 recordGeneration（系统错算不清账，不污染 cost_summary）", async () => {
    const { runner, costs } = makeRunner();
    const pg = makePg();
    generateTextMock.mockRejectedValueOnce(new Error("DB 故障"));
    await expect(runner.run(pg as never, sampleInput)).rejects.toThrow(/Internal error/);
    expect(costs.recordGeneration).not.toHaveBeenCalled();
  });

  it("非预期错误 → 脱敏 'Internal error: xxx' + status='failed' + emit error", async () => {
    const { runner, repo, sse } = makeRunner();
    const pg = makePg();
    generateTextMock.mockRejectedValueOnce(new Error("数据库连接断了密码 abc123"));

    await expect(runner.run(pg as never, sampleInput)).rejects.toThrow(/Internal error/);
    // 入库的 error 也是脱敏后
    const finalizeArgs = repo.finalize.mock.calls[0][2];
    expect(finalizeArgs.error).toMatch(/Internal error: [a-f0-9]{8}/);
    expect(finalizeArgs.error).not.toMatch(/abc123/); // 原始信息不泄露
    expect(sse.emitError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "internal", message: expect.stringMatching(/Internal error/) }),
    );
  });
});

describe("AgentRunnerService context compression", () => {
  beforeEach(() => generateTextMock.mockReset());

  it("shouldCompress=true → 调 compress + 记 context_compress step", async () => {
    const { runner, contextManager, repo } = makeRunner();
    const pg = makePg();
    contextManager.shouldCompress.mockReturnValue(true);
    contextManager.compress.mockResolvedValue({
      summary: "用户问了 A",
      trimmedMessages: [{ role: "user", content: "x" }],
      usage: { promptTokens: 100, completionTokens: 30 },
      compressedTurnCount: 4,
    });
    generateTextMock.mockImplementationOnce(async () => ({
      text: "done",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
    }));

    await runner.run(pg as never, sampleInput);

    expect(contextManager.compress).toHaveBeenCalled();
    // context_compress step 入库
    expect(repo.appendStep).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ stepType: "context_compress" }),
    );
  });
});

describe("AgentRunnerService max_steps 路径", () => {
  beforeEach(() => generateTextMock.mockReset());

  it("ai-sdk finishReason='tool-calls' 映射为 max_steps", async () => {
    const { runner, repo } = makeRunner();
    const pg = makePg();
    repo.getSteps.mockResolvedValue([]);
    generateTextMock.mockImplementationOnce(async () => ({
      text: "中途结束",
      finishReason: "tool-calls",
      usage: { promptTokens: 1, completionTokens: 1 },
    }));

    const out = await runner.run(pg as never, sampleInput);
    expect(out.finishReason).toBe("max_steps");
    // max_steps 时 text 也走 fallback
    expect(out.text).toMatch(/未收集到足够材料|已搜集到的资料/);
  });
});
