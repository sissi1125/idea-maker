/**
 * PlatformRuleAdapter — feat-300.3 TODO a
 *
 * 把 PlatformRuleRow（含 JSONB config）翻译成 prompt 层的自然语言约束。
 * 是 DB row 和 prompt definition 之间的小适配层。
 *
 * 输入：`PlatformRuleRow[]`（已 filter enabled）
 * 输出：`{ name, constraints: string[] }[]`
 *
 * **为什么不让 prompt 直接读 JSONB**：prompt 是纯函数无业务知识，"maxLength=100"
 * 翻译成"整段最多 100 字"是业务决定（中文措辞、句式风格、是否带强调词），
 * 不应混入 prompt 层。同样 RuleValidator 校验时也用类似翻译——之后可以共享。
 *
 * **未使用的 enabled 已被外层过滤掉**：本函数假设传入的都是 enabled=true 的。
 */

import type {
  PlatformRuleConfig,
  PlatformRuleRow,
} from "../platform-rules/platform-rules.types";
import type { PlatformRule } from "./prompts/system/platform-rules-injection.prompt";

/**
 * 翻译一条规则的 config 到自然语言数组。
 * 顺序按"硬度"递减：maxLength → bannedKeywords → mandatoryTag → styleHint。
 */
export function translateRuleConfig(config: PlatformRuleConfig): string[] {
  const out: string[] = [];

  if (typeof config.maxLength === "number" && config.maxLength > 0) {
    out.push(`整段不超过 ${config.maxLength} 字`);
  }

  if (config.bannedKeywords && config.bannedKeywords.length > 0) {
    // 用引号包裹避免歧义，逗号分隔
    const list = config.bannedKeywords.map((k) => `「${k}」`).join("、");
    out.push(`严禁出现以下关键词：${list}`);
  }

  if (config.mandatoryTagPattern) {
    const min = config.mandatoryTagMin ?? 1;
    out.push(
      `必须包含至少 ${min} 个匹配正则 \`${config.mandatoryTagPattern}\` 的话题标签`,
    );
  }

  // styleHint 是软提示而非硬约束——放在硬约束段尾，措辞用"建议"
  if (config.styleHint && config.styleHint.trim()) {
    out.push(`风格建议：${config.styleHint.trim()}`);
  }

  return out;
}

/**
 * 主入口：PlatformRuleRow[] → prompt PlatformRule[]。
 * - 过滤 enabled=false
 * - 翻译后若 constraints 数组为空（规则未配置任何约束）则丢弃该 rule
 */
export function adaptPlatformRules(rows: PlatformRuleRow[]): PlatformRule[] {
  return rows
    .filter((r) => r.enabled)
    .map((r) => ({
      name: r.name,
      constraints: translateRuleConfig(r.config),
    }))
    .filter((r) => r.constraints.length > 0);
}
