/** Agent 草稿的确定性事实门禁：模型评分不能覆盖这里的失败。 */
import { extractHardFacts } from "../../content-evaluation/deterministic-gate";
import { validateAgainstRules } from "../../platform-rules/rule-validator";
import type { RuleViolation } from "../../platform-rules/platform-rules.types";
import { buildServerGroundingEvidence } from "./agent-grounding-format";
import type { AgentGroundingContext } from "./agent-grounding.types";

export interface GroundedDraftValidation {
  passed: boolean;
  citedSources: string[];
  citationMissing: boolean;
  unsupportedHardFacts: string[];
  ruleViolations: RuleViolation[];
}

/**
 * 用服务端 Grounding 校验草稿，而不是信任 tool 参数或 LLM 自评。
 * 当前对可确定性识别的价格、比例和规格数字做逐项比对；语义忠实度仍交给 critic。
 */
export function validateGroundedDraft(
  draft: string,
  grounding: AgentGroundingContext,
): GroundedDraftValidation {
  const evidence = buildServerGroundingEvidence(grounding);
  const citedSources = extractGroundingCitations(draft, evidence);
  const supportedHardFacts = new Set<string>();
  for (const item of evidence) {
    for (const fact of extractHardFacts(item.text)) supportedHardFacts.add(fact);
  }
  const unsupportedHardFacts = [...extractHardFacts(draft)].filter(
    (fact) => !supportedHardFacts.has(fact),
  );
  const ruleViolations = validateAgainstRules(draft, grounding.platformRules);
  const citationMissing = citedSources.length === 0;

  return {
    passed: !citationMissing && unsupportedHardFacts.length === 0 && ruleViolations.length === 0,
    citedSources,
    citationMissing,
    unsupportedHardFacts,
    ruleViolations,
  };
}

/**
 * 解析有效的 [evidence-N] 或 prompt 示例中的 [evidence-N, source:xxx]。
 * source 文本本身不可信，始终按 N 映射服务端 evidence，越界引用不算依据。
 */
export function extractGroundingCitations(
  draft: string,
  evidence: Array<{ source: string; text: string }>,
): string[] {
  const indices = new Set<number>();
  for (const match of draft.matchAll(/\[evidence-(\d+)(?:,\s*source:[^\]]+)?\]/g)) {
    indices.add(Number.parseInt(match[1], 10));
  }
  return [...indices]
    .filter((index) => index >= 1 && index <= evidence.length)
    .map((index) => evidence[index - 1].source);
}

/** 把门禁失败压成结构化原因，避免把未通过草稿回传给 outer Agent。 */
export function groundingBlockReasons(validation: GroundedDraftValidation): string[] {
  const reasons: string[] = [];
  if (validation.citationMissing) reasons.push("草稿没有有效的 Grounding 引用");
  if (validation.unsupportedHardFacts.length > 0) {
    reasons.push(`存在无依据硬事实：${validation.unsupportedHardFacts.join("、")}`);
  }
  reasons.push(...validation.ruleViolations.map((violation) => violation.message));
  return reasons;
}

/**
 * 只做可证明不会引入新事实的禁词删除，并返回删除清单写入 trace。
 * 调用方必须在删除前后都跑完整门禁；这里不处理长度、标签或其他违规。
 */
export function removeConfiguredBannedKeywords(
  text: string,
  grounding: AgentGroundingContext,
): { text: string; removedKeywords: string[] } {
  const keywords = grounding.platformRules
    .filter((rule) => rule.enabled)
    .flatMap((rule) => rule.config.bannedKeywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let normalized = text;
  const removedKeywords: string[] = [];
  for (const keyword of [...new Set(keywords)]) {
    if (!normalized.toLowerCase().includes(keyword.toLowerCase())) continue;
    // 与 validator 一致按不区分大小写子串处理；split regex 只用于替换固定转义文本。
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(new RegExp(escaped, "gi"), "");
    removedKeywords.push(keyword);
  }
  return { text: normalized, removedKeywords };
}
