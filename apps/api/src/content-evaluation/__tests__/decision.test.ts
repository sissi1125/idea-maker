/**
 * 决策器单测 — feat-400.2
 *
 * 验证四态决策规则，尤其"门禁失败一票否决"和"无评测默认转人工"。
 */

import { describe, expect, it } from "vitest";
import { decide, type ContentScores } from "../decision";
import type { GateResult } from "../deterministic-gate";

const pass: GateResult = { passed: true, failures: [] };
const fail: GateResult = { passed: false, failures: [{ rule: "unknown_claim", detail: "x" }] };

function scores(over: Partial<ContentScores>): ContentScores {
  return {
    factualFaithfulness: 5, audienceFit: 4, platformFit: 4, clarity: 4,
    differentiation: 4, styleFit: 4, issues: [], ...over,
  };
}

describe("decide", () => {
  it("门禁失败 → blocked（哪怕评分很高也救不回来）", () => {
    expect(decide(fail, scores({ factualFaithfulness: 5 }))).toBe("blocked");
  });

  it("门禁过但无评测 → human_review（不自动放行）", () => {
    expect(decide(pass, null)).toBe("human_review");
  });

  it("评测有 blocker issue → revise", () => {
    expect(decide(pass, scores({ issues: [{ severity: "blocker", category: "fact", recommendation: "改" }] }))).toBe("revise");
  });

  it("关键维度低分 → human_review", () => {
    expect(decide(pass, scores({ factualFaithfulness: 3 }))).toBe("human_review");
    expect(decide(pass, scores({ platformFit: 2 }))).toBe("human_review");
  });

  it("全部关键维度达标且无 blocker → publish_candidate", () => {
    expect(decide(pass, scores({}))).toBe("publish_candidate");
  });

  it("有 warning 但关键维度达标 → 仍 publish_candidate", () => {
    expect(decide(pass, scores({ issues: [{ severity: "warning", category: "style", recommendation: "微调" }] }))).toBe("publish_candidate");
  });
});
