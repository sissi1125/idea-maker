/**
 * Platform Rules 注入 prompt：把项目的 platform_rules（已 enabled 的）拼成
 * 硬约束段落，注入 system prompt。
 *
 * 与 memory-injection 的区别：
 *   memory   = 软偏好，LLM 尽量遵守
 *   rules    = 硬约束，违反 = critic_review.safety 直接 0 分
 *   所以这段措辞要更"命令式"。
 *
 * platform_rules.config JSONB 字段（feat-200.8）：
 *   - maxLength
 *   - bannedKeywords[]
 *   - mandatoryTagPattern + mandatoryTagMin
 *   - styleHint
 *
 * 本 prompt 接收的是**已经被 controller / reader 翻译成自然语言的规则字符串数组**，
 * 不直接解析 JSONB——保持 prompt 层的"纯函数 + 无业务逻辑"。
 */

import { definePrompt } from "../types";

export interface PlatformRule {
  /** 平台名，如"小红书" / "公众号"；用于 prompt 中告知 LLM 多平台时怎么对应 */
  name: string;
  /** 已被翻译成自然语言的规则项列表 */
  constraints: string[];
}

export interface PlatformRulesInjectionInput {
  rules: PlatformRule[];
}

export const platformRulesInjectionPrompt = definePrompt<PlatformRulesInjectionInput>({
  id: "agent.platform-rules-injection",
  version: "v1",
  description: "把启用的 platform_rules 拼成硬约束段落，注入 system prompt",
  render: ({ rules }) => {
    if (!rules || rules.length === 0) return "";

    const sections = rules
      .filter((r) => r.constraints.length > 0)
      .map((r) => `【${r.name}】\n${r.constraints.map((c) => `- ${c}`).join("\n")}`);

    if (sections.length === 0) return "";

    // "硬约束" 字眼明确告诉 LLM 这是 0/1 不是连续值
    return `\n\n[平台硬约束 — 必须遵守，违反将被 critic_review 直接判 0 分]\n${sections.join(
      "\n\n",
    )}`;
  },
});
