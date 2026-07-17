/**
 * RuleValidator — feat-200.8 Week 8
 *
 * 纯函数：给一组规则 + 一段生成结果文本，跑出违规列表。
 * 不调任何 IO；orchestrator 在 generation 完成后调一次。
 *
 * 校验项：
 *   1. maxLength：[...text].length > maxLength → 报违规
 *      （用 spread 取 array.length 是正确处理 emoji / 中文 / 代理对的方式；
 *       text.length 对 emoji 会算成 2，对中文 1，跨平台不一致）
 *   2. bannedKeywords：任一关键词命中（不区分大小写） → 报违规
 *   3. mandatoryTagPattern：regex 匹配次数 < mandatoryTagMin → 报违规
 *
 * 设计选择：
 *   - regex 用 'gi'：忽略大小写、全局匹配，省去 LLM 写中英文混杂时的边界 case
 *   - banned 命中报每条规则一条违规（不展开成 N 条），detail 里给命中关键词
 *   - 没有规则 → 返回空数组，不抛错
 */

import type { PlatformRuleRow, RuleViolation } from "./platform-rules.types";

export function validateAgainstRules(
  text: string,
  rules: PlatformRuleRow[],
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue; // 防御性：理论上 listEnabledByIds 已过滤，这里二次保险
    const cfg = rule.config ?? {};

    // 1. maxLength
    if (typeof cfg.maxLength === "number" && cfg.maxLength > 0) {
      const codePoints = [...text].length;
      if (codePoints > cfg.maxLength) {
        violations.push({
          type: "max_length",
          ruleId: rule.id,
          ruleName: rule.name,
          message: `内容长度 ${codePoints} 字符超过 ${rule.name} 限制（${cfg.maxLength}），需精简 ${codePoints - cfg.maxLength} 字符`,
          detail: { actual: codePoints, limit: cfg.maxLength },
        });
      }
    }

    // 2. bannedKeywords：不区分大小写命中
    if (Array.isArray(cfg.bannedKeywords) && cfg.bannedKeywords.length > 0) {
      const lower = text.toLowerCase();
      const hits = cfg.bannedKeywords.filter(
        (kw) => kw.trim().length > 0 && lower.includes(kw.toLowerCase()),
      );
      if (hits.length > 0) {
        violations.push({
          type: "banned_keyword",
          ruleId: rule.id,
          ruleName: rule.name,
          message: `命中 ${rule.name} 的违禁词：${hits.join("、")}`,
          detail: { hits },
        });
      }
    }

    // 3. mandatoryTagPattern：必须出现的 regex 模式
    if (typeof cfg.mandatoryTagPattern === "string" && cfg.mandatoryTagPattern.trim()) {
      const min = cfg.mandatoryTagMin ?? 1;
      let count = 0;
      try {
        // 用户自填的 pattern——用 try/catch 防止恶意正则崩进程
        const regex = new RegExp(cfg.mandatoryTagPattern, "gi");
        const matches = text.match(regex);
        count = matches ? matches.length : 0;
      } catch {
        // pattern 不合法时跳过该项校验，避免假阳性
        continue;
      }
      if (count < min) {
        violations.push({
          type: "missing_tag",
          ruleId: rule.id,
          ruleName: rule.name,
          message: `${rule.name} 要求至少 ${min} 处匹配模式 /${cfg.mandatoryTagPattern}/，实际只有 ${count} 处`,
          detail: { pattern: cfg.mandatoryTagPattern, min, actual: count },
        });
      }
    }
  }

  return violations;
}

/**
 * 把规则列表压成一段可注入 prompt 的中文指令。
 * 由 PipelineOrchestratorService 在 prompt-build 之前拼到 systemPrompt 之后。
 *
 * 仅注入"软提示"（maxLength / bannedKeywords / mandatoryTag / styleHint）的中文描述，
 * 让 LLM 尽量遵守；硬校验仍在 RuleValidator 跑。
 */
export function buildRuleSystemPrompt(rules: PlatformRuleRow[]): string {
  if (rules.length === 0) return "";
  const lines: string[] = ["", "# 平台合规约束（必须遵守）"];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const cfg = rule.config ?? {};
    const items: string[] = [];
    if (typeof cfg.maxLength === "number" && cfg.maxLength > 0) {
      items.push(`整体不超过 ${cfg.maxLength} 字符`);
    }
    if (Array.isArray(cfg.bannedKeywords) && cfg.bannedKeywords.length > 0) {
      items.push(
        `不得出现（按子串检查，包含在其他词中也算违规）：${cfg.bannedKeywords.join("、")}`,
      );
    }
    if (typeof cfg.mandatoryTagPattern === "string" && cfg.mandatoryTagPattern.trim()) {
      const min = cfg.mandatoryTagMin ?? 1;
      items.push(`必须包含至少 ${min} 处匹配 /${cfg.mandatoryTagPattern}/ 的元素（如话题标签）`);
    }
    if (typeof cfg.styleHint === "string" && cfg.styleHint.trim()) {
      items.push(`风格：${cfg.styleHint.trim()}`);
    }
    if (items.length === 0) continue;
    lines.push(`- **${rule.name}**`);
    for (const it of items) lines.push(`  - ${it}`);
  }
  return lines.join("\n");
}
