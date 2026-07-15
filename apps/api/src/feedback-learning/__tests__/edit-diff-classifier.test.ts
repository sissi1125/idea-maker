/**
 * 编辑差异分类 + 聚合 单测 — feat-400.3
 */

import { describe, expect, it } from "vitest";
import {
  classifyEditDiff,
  aggregateSuggestions,
  SUGGESTION_THRESHOLD,
  CATEGORY_TEMPLATES,
} from "../edit-diff-classifier";

describe("classifyEditDiff", () => {
  it("删夸张词 → tone_exaggerated", () => {
    expect(classifyEditDiff("全网最强神器，秒杀一切！", "好用的工具")).toBe("tone_exaggerated");
  });
  it("去术语 → too_technical", () => {
    expect(classifyEditDiff("基于分布式架构与向量算法", "帮你更快找到答案")).toBe("too_technical");
  });
  it("大幅精简 → too_verbose", () => {
    const long = "这是一段很长很长的文案".repeat(5);
    expect(classifyEditDiff(long, "简短版")).toBe("too_verbose");
  });
  it("识别不出 → null", () => {
    expect(classifyEditDiff("普通文案", "另一段普通文案内容")).toBeNull();
  });
  it("空输入 → null", () => {
    expect(classifyEditDiff("", "")).toBeNull();
  });
});

describe("aggregateSuggestions", () => {
  it("同类未达阈值 → 不出建议", () => {
    const fb = Array.from({ length: SUGGESTION_THRESHOLD - 1 }, (_, i) => ({ id: `f${i}`, category: "too_verbose" as const }));
    expect(aggregateSuggestions(fb)).toHaveLength(0);
  });
  it("同类达阈值 → 出一条建议，携带全部来源 id", () => {
    const fb = Array.from({ length: SUGGESTION_THRESHOLD }, (_, i) => ({ id: `f${i}`, category: "tone_exaggerated" as const }));
    const s = aggregateSuggestions(fb);
    expect(s).toHaveLength(1);
    expect(s[0].category).toBe("tone_exaggerated");
    expect(s[0].sourceFeedbackIds).toHaveLength(SUGGESTION_THRESHOLD);
    expect(s[0].text).toContain(String(SUGGESTION_THRESHOLD));
  });
  it("所有建议目标分组都是表达层（style/constraint），绝不碰事实", () => {
    for (const t of Object.values(CATEGORY_TEMPLATES)) {
      expect(["style", "constraint"]).toContain(t!.targetGroup);
    }
  });
  it("'other' 无模板 → 不出建议", () => {
    const fb = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, category: "other" as const }));
    expect(aggregateSuggestions(fb)).toHaveLength(0);
  });
});
