/**
 * AutoGenerations 类型 — feat-200.4 Week 4
 */

export type AutoGenCardType = "intro" | "compete";
export type AutoGenStatus = "queued" | "running" | "succeeded" | "failed";

export interface AutoGenerationRow {
  id: string;
  projectId: string;
  documentId: string;
  cardType: AutoGenCardType;
  generationId: string | null;
  status: AutoGenStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * category → 触发哪几个 card 的映射。
 *   product → intro 卡片（产品介绍）
 *   compete → compete 卡片（竞品对比）
 *   history（默认）→ 不触发，作为知识沉淀
 */
export const CATEGORY_AUTO_CARDS: Record<string, AutoGenCardType[]> = {
  product: ["intro"],
  compete: ["compete"],
};

/**
 * card_type → 默认 query 模板。
 *   - 故意写死中文，Phase 4 学习系统接入后再做个性化
 *   - 文案与原型 PresetGrid 的"产品介绍/竞品对比"按钮一致
 */
export const CARD_QUERY_TEMPLATES: Record<AutoGenCardType, string> = {
  intro: "请根据已上传的产品资料，生成一段简洁的产品介绍卡片。",
  compete: "请基于已上传的竞品资料，生成一段竞品对比卡片，突出我方差异化优势。",
};
