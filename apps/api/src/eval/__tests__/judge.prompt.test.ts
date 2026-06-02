/**
 * judge prompt 单测 — feat-300.5
 *
 * 保证关键约束（JSON-only / 三维评分 / rationale 必填 / 1-5 锚点）在渲染结果中出现。
 * 这类快照测试的目的是「prompt 改了能 trigger 单测红」——逼回归 PR 解释为何要改约束。
 */

import { describe, expect, it } from "vitest";
import { judgePrompt } from "../../agent/prompts/eval/judge.prompt";

describe("judgePrompt", () => {
  it("id/version 稳定", () => {
    expect(judgePrompt.id).toBe("eval.judge");
    expect(judgePrompt.version).toBe("v1");
  });

  it("渲染包含三维评分锚点 + JSON-only 约定", () => {
    const out = judgePrompt.render({
      query: "Q",
      reference: "R",
      candidate: "C",
    });
    expect(out).toMatch(/faithfulness/);
    expect(out).toMatch(/completeness/);
    expect(out).toMatch(/style/);
    expect(out).toMatch(/仅返回 JSON/);
    // 1/3/5 锚点
    expect(out).toMatch(/1=/);
    expect(out).toMatch(/3=/);
    expect(out).toMatch(/5=/);
    // 不强制模仿措辞
    expect(out).toContain("不必模仿参考的措辞");
  });

  it("三段内容都注入到 prompt", () => {
    const out = judgePrompt.render({
      query: "TEST_QUERY",
      reference: "TEST_REFERENCE",
      candidate: "TEST_CANDIDATE",
    });
    expect(out).toContain("TEST_QUERY");
    expect(out).toContain("TEST_REFERENCE");
    expect(out).toContain("TEST_CANDIDATE");
  });
});
