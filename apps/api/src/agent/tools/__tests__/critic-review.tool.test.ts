/**
 * critic_review tool 单测：
 *  - pass 阈值默认 3.5 + safety 0 直接 fail
 *  - platformRules / memoryPreferences 注入到 system prompt
 *  - temperature=0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateObject: (args: unknown) => generateObjectMock(args) };
});

import { buildCriticReviewTool, type CriticCriteria } from "../critic-review.tool";
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
const exec = async (tool: ReturnType<ReturnType<typeof buildCriticReviewTool>>, args: unknown) =>
  (
    tool.execute as (
      a: unknown,
      o: { toolCallId: string; messages: [] },
    ) => Promise<unknown>
  )(args, { toolCallId: "t", messages: [] });

const SAMPLE_ARGS = { draft: "d", task: "t" };

describe("critic_review tool", () => {
  beforeEach(() => generateObjectMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  function makeOk(scores: { faithfulness: number; completeness: number; style: number; safety: number }, opts: { violations?: string[]; suggestions?: string[] } = {}) {
    generateObjectMock.mockResolvedValue({
      object: {
        ...scores,
        violations: opts.violations ?? [],
        suggestions: opts.suggestions ?? [],
      },
      usage: { promptTokens: 100, completionTokens: 30 },
    });
  }

  it("temperature=0 + 入参带 schema", async () => {
    makeOk({ faithfulness: 5, completeness: 5, style: 5, safety: 5 });
    const t = buildCriticReviewTool({ platformRules: [], memoryPreferences: [] })(makeCtx());
    await exec(t, SAMPLE_ARGS);
    const args = generateObjectMock.mock.calls[0][0];
    expect(args.temperature).toBe(0);
    expect(args.schema).toBeDefined();
  });

  it("全部维度 >= 3.5 → passed=true", async () => {
    makeOk({ faithfulness: 4, completeness: 3.5, style: 5, safety: 4 });
    const t = buildCriticReviewTool({ platformRules: [], memoryPreferences: [] })(makeCtx());
    const out = (await exec(t, SAMPLE_ARGS)) as { passed: boolean };
    expect(out.passed).toBe(true);
  });

  it("任一维度 < 3.5 → passed=false", async () => {
    makeOk({ faithfulness: 3, completeness: 4, style: 4, safety: 4 });
    const t = buildCriticReviewTool({ platformRules: [], memoryPreferences: [] })(makeCtx());
    const out = (await exec(t, SAMPLE_ARGS)) as { passed: boolean };
    expect(out.passed).toBe(false);
  });

  it("safety=0 即使其他 5 分也 passed=false（硬约束优先）", async () => {
    makeOk({ faithfulness: 5, completeness: 5, style: 5, safety: 0 }, {
      violations: ["含禁词 XX"],
    });
    const t = buildCriticReviewTool({ platformRules: [], memoryPreferences: [] })(makeCtx());
    const out = (await exec(t, SAMPLE_ARGS)) as {
      passed: boolean;
      violations: string[];
    };
    expect(out.passed).toBe(false);
    expect(out.violations).toContain("含禁词 XX");
  });

  it("criteria 注入到 system prompt", async () => {
    makeOk({ faithfulness: 5, completeness: 5, style: 5, safety: 5 });
    const criteria: CriticCriteria = {
      platformRules: ["不超过 100 字", "必须含 #标签"],
      memoryPreferences: ["语气活泼", "面向 25-30 岁女性"],
    };
    const t = buildCriticReviewTool(criteria)(makeCtx());
    await exec(t, SAMPLE_ARGS);
    const args = generateObjectMock.mock.calls[0][0];
    expect(args.system).toMatch(/不超过 100 字/);
    expect(args.system).toMatch(/语气活泼/);
  });

  it("自定义 passThreshold=4.0", async () => {
    makeOk({ faithfulness: 3.6, completeness: 4, style: 4, safety: 4 });
    const t = buildCriticReviewTool({
      platformRules: [],
      memoryPreferences: [],
      passThreshold: 4.0,
    })(makeCtx());
    const out = (await exec(t, SAMPLE_ARGS)) as { passed: boolean };
    expect(out.passed).toBe(false); // 3.6 < 4.0
  });
});
