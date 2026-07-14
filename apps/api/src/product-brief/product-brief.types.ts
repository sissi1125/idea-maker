/**
 * Product Brief 类型定义 — feat-400.1
 *
 * 对齐 docs/PRODUCT_BRIEF_ITERATION_PLAN.md §3.2 的 BriefField 结构。
 * 这里集中定义枚举常量 + 行类型，供 service / controller / 测试共享，
 * 避免字符串字面量散落各处（"改一个枚举要全局搜"的反模式）。
 */

/** 字段分组：产品身份 / 事实 / 受众 / 定位 / 表达 / 视觉 / 平台约束 */
export const BRIEF_FIELD_GROUPS = [
  "identity",
  "fact",
  "audience",
  "positioning",
  "style",
  "visual",
  "constraint",
] as const;
export type BriefFieldGroup = (typeof BRIEF_FIELD_GROUPS)[number];

/** 字段来源：文档 / 官网 / 用户 / 历史内容 / 模型推断 */
export const BRIEF_FIELD_SOURCES = [
  "document",
  "website",
  "user",
  "historical_content",
  "inferred",
] as const;
export type BriefFieldSource = (typeof BRIEF_FIELD_SOURCES)[number];

/** 字段状态：候选 / 已确认 / 已拒绝 / 已过期（官网/文档更新后待复核） */
export const BRIEF_FIELD_STATUSES = [
  "candidate",
  "confirmed",
  "rejected",
  "stale",
] as const;
export type BriefFieldStatus = (typeof BRIEF_FIELD_STATUSES)[number];

/**
 * 事实型分组：这些分组里的字段代表"产品客观事实"，受最严格的门禁约束。
 *
 * 为什么把 identity / fact / audience / positioning 都算事实型：
 *   它们会作为下游 Claim 的事实依据（产品叫什么、能干什么、给谁用、差异点），
 *   一旦错了就是"产品事实错误"。而 style / visual / constraint 是表达/渲染层，
 *   错了只影响"怎么说"，不构成事实错误，门禁较宽。
 */
export const FACTUAL_FIELD_GROUPS: readonly BriefFieldGroup[] = [
  "identity",
  "fact",
  "audience",
  "positioning",
];

/**
 * 提交 Product Brief v(N) 前必须"已确认"的关键字段（group/key）。
 *
 * 缺任意一条 → detectIssues 报 missingRequired，不允许确认整份 Brief。
 * 这是"事实完备性"的最低门槛，防止用一份残缺档案去生成内容。
 */
export const REQUIRED_FIELDS: ReadonlyArray<{ group: BriefFieldGroup; key: string }> = [
  { group: "identity", key: "name" },
  { group: "identity", key: "one_liner" },
  { group: "positioning", key: "core_value" },
];

/** product_briefs 表行 */
export interface ProductBriefRow {
  id: string;
  project_id: string;
  version: number;
  status: "draft" | "confirmed";
  created_at: Date;
  updated_at: Date;
}

/** product_brief_fields 表行 */
export interface BriefFieldRow {
  id: string;
  brief_id: string;
  field_group: BriefFieldGroup;
  field_key: string;
  value: unknown;
  source: BriefFieldSource;
  evidence_chunk_ids: string[];
  confidence: number;
  status: BriefFieldStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** detectIssues 输出：审核工作台顶部展示 */
export interface BriefIssues {
  /** 缺失的关键字段（没有 confirmed 值）*/
  missingRequired: Array<{ group: BriefFieldGroup; key: string }>;
  /**
   * "未经核实的事实"：事实型分组里，来源是模型推断/历史内容、又没有 evidence 的候选字段。
   * 这类字段绝不能自动成为事实，必须人工确认或补 evidence。
   */
  unverifiedFacts: Array<{ id: string; group: BriefFieldGroup; key: string; source: BriefFieldSource }>;
}
