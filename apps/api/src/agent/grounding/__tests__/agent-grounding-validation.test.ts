import { describe, expect, it } from "vitest";
import { makeTestGrounding } from "../../__tests__/grounding.fixture";
import {
  removeConfiguredBannedKeywords,
  validateGroundedDraft,
} from "../agent-grounding-validation";
import {
  buildServerGroundingEvidence,
  formatAgentGroundingContext,
} from "../agent-grounding-format";

describe("validateGroundedDraft", () => {
  it("有效服务端引用且无硬事实冲突时通过", () => {
    const result = validateGroundedDraft(
      "Bloomnote 支持时间线与标签管理 [evidence-2]",
      makeTestGrounding(),
    );
    expect(result.passed).toBe(true);
    expect(result.citedSources).toEqual(["brief-field:field-feature"]);
  });

  it("伪造或越界 citation 不算依据", () => {
    const result = validateGroundedDraft("环保材料 [evidence-99]", makeTestGrounding());
    expect(result.passed).toBe(false);
    expect(result.citationMissing).toBe(true);
  });

  it("接受 prompt 示例的完整标签，但忽略模型填写的 source 文本", () => {
    const result = validateGroundedDraft(
      "Bloomnote 支持时间线 [evidence-2, source:模型伪造的-id]",
      makeTestGrounding(),
    );
    expect(result.passed).toBe(true);
    expect(result.citedSources).toEqual(["brief-field:field-feature"]);
  });

  it("只允许 Grounding 中存在的价格与规格", () => {
    const result = validateGroundedDraft(
      "提供 16GB 空间 [evidence-1]",
      makeTestGrounding(),
    );
    expect(result.passed).toBe(false);
    expect(result.unsupportedHardFacts).toEqual(["16gb"]);
  });

  it("平台规则以代码结果为准", () => {
    const grounding = makeTestGrounding({
      platformRules: [{
        id: "r1",
        projectId: "p",
        name: "小红书",
        config: { bannedKeywords: ["最佳"], mandatoryTagPattern: "#\\S+", mandatoryTagMin: 1 },
        enabled: true,
        createdAt: "",
        updatedAt: "",
      }],
    });
    const result = validateGroundedDraft("最佳笔记体验 [evidence-1]", grounding);
    expect(result.passed).toBe(false);
    expect(result.ruleViolations.map((item) => item.type)).toEqual([
      "banned_keyword",
      "missing_tag",
    ]);
  });

  it("禁词归一化按长词优先删除并记录，不引入替代事实", () => {
    const grounding = makeTestGrounding({
      platformRules: [{
        id: "r1",
        projectId: "p",
        name: "小红书",
        config: { bannedKeywords: ["最", "最佳"] },
        enabled: true,
        createdAt: "",
        updatedAt: "",
      }],
    });
    const result = removeConfiguredBannedKeywords("最佳选择，最大亮点", grounding);
    expect(result.text).toBe("选择，大亮点");
    expect(result.removedKeywords).toEqual(["最佳", "最"]);
  });

  it("raw chunk 原文不进入模型 evidence，防止同段 candidate 事实绕过 Brief", () => {
    const grounding = makeTestGrounding({
      evidenceChunks: [{ id: "chunk-mixed", text: "已确认 iPhone；未确认 iCloud 与 Mac" }],
    });
    const serverEvidence = buildServerGroundingEvidence(grounding);
    const formatted = formatAgentGroundingContext(grounding);
    expect(serverEvidence.every((item) => !item.source.startsWith("chunk:"))).toBe(true);
    expect(serverEvidence.map((item) => item.text).join(" ")).not.toContain("iCloud");
    expect(formatted).not.toContain("未确认 iCloud");
    expect(formatted).toContain("原文不注入生成模型");
  });
});
