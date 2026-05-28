/**
 * Platform Rules 类型 — feat-200.8 Week 8
 *
 * 一条规则描述一个目标发布平台（小红书 / 微博 / 抖音 / 公众号 / 自定义）的
 * 产出约束。前后端共享同一份 PlatformRuleConfig schema。
 */

/**
 * 规则配置——全部字段可选，至少有一项才有校验意义。
 *
 * - maxLength：整体字符上限（按 [...string] 数组长度计，正确处理 emoji 和中文）
 * - bannedKeywords：命中任一即报违规（不区分大小写、不区分中英文）
 * - mandatoryTagPattern：必须出现的 regex pattern（如 "#\\S+" 表示至少一个话题标签）
 * - mandatoryTagMin：mandatoryTagPattern 至少匹配的次数（默认 1）
 * - styleHint：注入到 prompt 的额外风格指导（自由文本）
 */
export interface PlatformRuleConfig {
  maxLength?: number;
  bannedKeywords?: string[];
  mandatoryTagPattern?: string;
  mandatoryTagMin?: number;
  styleHint?: string;
}

export interface PlatformRuleRow {
  id: string;
  projectId: string;
  name: string;
  config: PlatformRuleConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformRuleInput {
  name: string;
  config?: PlatformRuleConfig;
  enabled?: boolean;
}

export interface UpdatePlatformRuleInput {
  name?: string;
  config?: PlatformRuleConfig;
  enabled?: boolean;
}

/**
 * 校验违规——RuleValidator 跑完一次生成产出一条或多条。
 *
 * - type：违规类型，前端可按 type 分色（warn/error 视严重程度，目前都是 warn）
 * - ruleId / ruleName：哪条规则触发的
 * - message：人类可读的违规说明（中文）
 * - detail：可选的附加信息（命中的关键词位置 / 当前字符数 / 缺失次数等）
 */
export type ViolationType =
  | "max_length"
  | "banned_keyword"
  | "missing_tag";

export interface RuleViolation {
  type: ViolationType;
  ruleId: string;
  ruleName: string;
  message: string;
  detail?: Record<string, unknown>;
}
