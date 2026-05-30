/**
 * PlatformRuleAdapter 单测：翻译 4 类 config 字段 + filter enabled + 丢弃空规则。
 */

import { describe, expect, it } from "vitest";
import {
  translateRuleConfig,
  adaptPlatformRules,
} from "../platform-rules-adapter";
import type { PlatformRuleRow } from "../../platform-rules/platform-rules.types";

describe("translateRuleConfig", () => {
  it("空 config 返回空数组", () => {
    expect(translateRuleConfig({})).toEqual([]);
  });

  it("maxLength 翻译成'不超过 N 字'", () => {
    expect(translateRuleConfig({ maxLength: 100 })).toEqual([
      "整段不超过 100 字",
    ]);
  });

  it("maxLength <= 0 不翻译（避免负数/0 产生误导提示）", () => {
    expect(translateRuleConfig({ maxLength: 0 })).toEqual([]);
    expect(translateRuleConfig({ maxLength: -1 })).toEqual([]);
  });

  it("bannedKeywords 用「」包裹 + 顿号分隔", () => {
    const out = translateRuleConfig({ bannedKeywords: ["速效", "保证"] });
    expect(out[0]).toBe("严禁出现以下关键词：「速效」、「保证」");
  });

  it("bannedKeywords 空数组不翻译", () => {
    expect(translateRuleConfig({ bannedKeywords: [] })).toEqual([]);
  });

  it("mandatoryTagPattern 含默认 min=1", () => {
    const out = translateRuleConfig({ mandatoryTagPattern: "#\\S+" });
    expect(out[0]).toMatch(/至少 1 个匹配正则 `#\\S\+`/);
  });

  it("mandatoryTagPattern + mandatoryTagMin", () => {
    const out = translateRuleConfig({
      mandatoryTagPattern: "#\\w+",
      mandatoryTagMin: 3,
    });
    expect(out[0]).toMatch(/至少 3 个/);
  });

  it("styleHint 加前缀'风格建议：'", () => {
    expect(translateRuleConfig({ styleHint: "口语化亲切" })).toEqual([
      "风格建议：口语化亲切",
    ]);
  });

  it("styleHint 仅空白字符不翻译", () => {
    expect(translateRuleConfig({ styleHint: "  " })).toEqual([]);
  });

  it("多字段按硬度递减顺序：maxLength → banned → tag → style", () => {
    const out = translateRuleConfig({
      styleHint: "活泼",
      maxLength: 100,
      bannedKeywords: ["x"],
      mandatoryTagPattern: "#\\S+",
    });
    expect(out).toEqual([
      "整段不超过 100 字",
      "严禁出现以下关键词：「x」",
      "必须包含至少 1 个匹配正则 `#\\S+` 的话题标签",
      "风格建议：活泼",
    ]);
  });
});

describe("adaptPlatformRules", () => {
  const baseRow: Omit<PlatformRuleRow, "id" | "name" | "config" | "enabled"> = {
    projectId: "p",
    createdAt: "2026-05-30T00:00:00Z",
    updatedAt: "2026-05-30T00:00:00Z",
  };

  it("过滤 enabled=false 的规则", () => {
    const out = adaptPlatformRules([
      { ...baseRow, id: "1", name: "小红书", config: { maxLength: 100 }, enabled: true },
      { ...baseRow, id: "2", name: "已禁用", config: { maxLength: 200 }, enabled: false },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("小红书");
  });

  it("丢弃 constraints 为空的规则（config 全空）", () => {
    const out = adaptPlatformRules([
      { ...baseRow, id: "1", name: "空规则", config: {}, enabled: true },
      { ...baseRow, id: "2", name: "小红书", config: { maxLength: 100 }, enabled: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("小红书");
  });

  it("多 enabled 规则按顺序保留", () => {
    const out = adaptPlatformRules([
      { ...baseRow, id: "1", name: "小红书", config: { maxLength: 100 }, enabled: true },
      { ...baseRow, id: "2", name: "公众号", config: { bannedKeywords: ["秒杀"] }, enabled: true },
    ]);
    expect(out.map((r) => r.name)).toEqual(["小红书", "公众号"]);
    expect(out[0].constraints).toContain("整段不超过 100 字");
    expect(out[1].constraints[0]).toContain("秒杀");
  });
});
