/**
 * Prompt definition 单测：每个 prompt 验证 id/version + 关键片段是否按入参出现。
 *
 * 思路：不做完整快照（会让 prompt 微调测试一片红），只断言"该出现的关键字必须在"。
 * 关键字断言 = 把 prompt 当 API 测：换台词没事，但角色/规范/分类标记不能丢。
 */

import { describe, expect, it } from "vitest";
import {
  // types
  toPromptTraceTag,
  // system
  agentBaseSystemPrompt,
  memoryInjectionPrompt,
  platformRulesInjectionPrompt,
  agentSystemPrompt,
  // tools
  generateDraftSystemPrompt,
  generateDraftUserPrompt,
  refineDraftSystemPrompt,
  refineDraftUserPrompt,
  criticReviewSystemPrompt,
  criticReviewUserPrompt,
  // context
  compressSummarySystemPrompt,
  compressSummaryUserPrompt,
} from "../index";

describe("PromptDefinition meta", () => {
  it("toPromptTraceTag 抽取 id + version 两字段", () => {
    expect(toPromptTraceTag(agentBaseSystemPrompt)).toEqual({
      promptId: "agent.base",
      promptVersion: "v1",
    });
  });
});

describe("agentBaseSystemPrompt", () => {
  it("项目名注入 + 含 ReAct 工作流偏好关键词", () => {
    const out = agentBaseSystemPrompt.render({ projectName: "护肤项目" });
    expect(out).toContain("护肤项目");
    expect(out).toMatch(/工作流偏好/);
    expect(out).toMatch(/引用规范/);
    expect(out).toMatch(/evidence-N/);
    expect(out).toMatch(/何时停止/);
  });
});

describe("memoryInjectionPrompt", () => {
  it("空 memory 返回空字符串（compose 会过滤掉）", () => {
    expect(memoryInjectionPrompt.render({ memory: [] })).toBe("");
  });

  it("4 类按 taboo→audience→style→preference 顺序拼接", () => {
    const out = memoryInjectionPrompt.render({
      memory: [
        { kind: "preference", content: "多用数据" },
        { kind: "style", content: "口语化" },
        { kind: "taboo", content: "不提竞品 X" },
        { kind: "audience", content: "25-30 岁女性" },
      ],
    });
    const tabooIdx = out.indexOf("禁忌");
    const audIdx = out.indexOf("受众");
    const styleIdx = out.indexOf("风格习惯");
    const prefIdx = out.indexOf("通用偏好");
    expect(tabooIdx).toBeLessThan(audIdx);
    expect(audIdx).toBeLessThan(styleIdx);
    expect(styleIdx).toBeLessThan(prefIdx);
  });

  it("只有 1 类时只渲染该类", () => {
    const out = memoryInjectionPrompt.render({
      memory: [{ kind: "taboo", content: "不提竞品" }],
    });
    expect(out).toMatch(/绝对禁忌/);
    expect(out).not.toMatch(/受众/);
    expect(out).not.toMatch(/风格习惯/);
  });
});

describe("platformRulesInjectionPrompt", () => {
  it("空规则返回空字符串", () => {
    expect(platformRulesInjectionPrompt.render({ rules: [] })).toBe("");
    expect(
      platformRulesInjectionPrompt.render({ rules: [{ name: "小红书", constraints: [] }] }),
    ).toBe("");
  });

  it("含'必须遵守'强语气 + 多平台分段", () => {
    const out = platformRulesInjectionPrompt.render({
      rules: [
        { name: "小红书", constraints: ["不超 200 字", "必带 #标签"] },
        { name: "公众号", constraints: ["标题不带数字"] },
      ],
    });
    expect(out).toMatch(/必须遵守/);
    expect(out).toContain("小红书");
    expect(out).toContain("公众号");
    expect(out).toContain("不超 200 字");
  });
});

describe("agentSystemPrompt (composer)", () => {
  it("无 memory + 无 rules + 无 summary：只有 base", () => {
    const out = agentSystemPrompt.render({
      projectName: "P",
      memory: [],
      platformRules: [],
    });
    expect(out).toMatch(/P/);
    expect(out).not.toMatch(/用户画像/);
    expect(out).not.toMatch(/平台硬约束/);
    expect(out).not.toMatch(/早期对话摘要/);
  });

  it("齐全四段按顺序：base → memory → rules → summary", () => {
    const out = agentSystemPrompt.render({
      projectName: "X",
      memory: [{ kind: "style", content: "活泼" }],
      platformRules: [{ name: "微博", constraints: ["140 字内"] }],
      contextSummary: "用户问了 A，agent 回答了 B",
    });
    const baseIdx = out.indexOf("X");
    const memIdx = out.indexOf("用户画像");
    const ruleIdx = out.indexOf("平台硬约束");
    const sumIdx = out.indexOf("早期对话摘要");
    expect(baseIdx).toBeLessThan(memIdx);
    expect(memIdx).toBeLessThan(ruleIdx);
    expect(ruleIdx).toBeLessThan(sumIdx);
  });

  it("空摘要不渲染对应段", () => {
    const out = agentSystemPrompt.render({
      projectName: "X",
      memory: [],
      platformRules: [],
      contextSummary: "   ", // whitespace
    });
    expect(out).not.toMatch(/早期对话摘要/);
  });
});

describe("generateDraftSystemPrompt / UserPrompt", () => {
  it("system 含引用规范 + 不带 evidence 标记", () => {
    const sys = generateDraftSystemPrompt.render({});
    expect(sys).toMatch(/evidence-N/);
    expect(sys).toMatch(/无足够依据/);
  });

  it("user 无 evidence 时显示'基于通用知识'", () => {
    const out = generateDraftUserPrompt.render({ task: "T" });
    expect(out).toMatch(/无具体 evidence/);
  });

  it("user 含 constraints 时拼到 task 下", () => {
    const out = generateDraftUserPrompt.render({
      task: "T",
      constraints: "80 字内",
    });
    expect(out).toMatch(/硬约束（必须满足）：80 字内/);
  });

  it("evidence 以 [evidence-N, source:xxx] 编号", () => {
    const out = generateDraftUserPrompt.render({
      task: "T",
      evidence: [
        { source: "chunk-a", text: "片段 A" },
        { source: "chunk-b", text: "片段 B" },
      ],
    });
    expect(out).toMatch(/\[evidence-1, source:chunk-a\]/);
    expect(out).toMatch(/\[evidence-2, source:chunk-b\]/);
  });
});

describe("refineDraftSystemPrompt", () => {
  it.each([
    ["minor", "语言润色"],
    ["moderate", "调整段落顺序"],
    ["rewrite", "大幅重写"],
  ] as const)("intensity=%s 映射到 %s", (intensity, expected) => {
    const out = refineDraftSystemPrompt.render({ intensity });
    expect(out).toContain(expected);
  });

  it("含 ===CHANGES=== 输出格式约定", () => {
    const out = refineDraftSystemPrompt.render({ intensity: "moderate" });
    expect(out).toContain("===CHANGES===");
  });
});

describe("criticReviewSystemPrompt", () => {
  it("含 4 维评分名 + safety 直接 0 分语义", () => {
    const out = criticReviewSystemPrompt.render({
      platformRules: [],
      memoryPreferences: [],
    });
    expect(out).toMatch(/faithfulness/);
    expect(out).toMatch(/completeness/);
    expect(out).toMatch(/style/);
    expect(out).toMatch(/safety/);
    expect(out).toMatch(/违反任一硬约束直接 0 分/);
  });

  it("注入规则 + 偏好", () => {
    const out = criticReviewSystemPrompt.render({
      platformRules: ["不超 100 字"],
      memoryPreferences: ["语气活泼"],
    });
    expect(out).toContain("不超 100 字");
    expect(out).toContain("语气活泼");
  });

  it("空时显示占位说明（不留空段）", () => {
    const out = criticReviewSystemPrompt.render({
      platformRules: [],
      memoryPreferences: [],
    });
    expect(out).toMatch(/无显式硬约束/);
    expect(out).toMatch(/无显式偏好/);
  });
});

describe("compressSummary prompts", () => {
  it("system 强调第三人称 + 保留 evidence ID + 200-400 字", () => {
    const sys = compressSummarySystemPrompt.render({});
    expect(sys).toMatch(/第三人称/);
    expect(sys).toMatch(/\[evidence-N\]/);
    expect(sys).toMatch(/200-400 字/);
  });

  it("user 带 turnCount 与轮次内容", () => {
    const out = compressSummaryUserPrompt.render({
      earlyTurns: "user: hi\nassistant: hello",
      turnCount: 3,
    });
    expect(out).toMatch(/早期 3 轮/);
    expect(out).toContain("user: hi");
  });
});
