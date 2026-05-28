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

/**
 * 项目级"最新成功"自动卡片摘要——AutoGenerationsService.getLatestByProject 返回元素。
 *
 * 与 AutoGenerationRow 的区别：这一条是 JOIN 后的"可直接渲染"形态，包含真实摘要正文
 * （result_notes）。Chat 页 ProjectInfoCards 直接渲染它。
 */
export interface ProjectAutoGenLatest {
  cardType: AutoGenCardType;
  autoGenId: string;
  documentId: string;
  generationId: string;
  /** LLM 生成的卡片正文（Markdown） */
  resultNotes: string | null;
  durationMs: number | null;
  /** generations.cost_breakdown 原样透传，前端按需取 */
  costBreakdown: unknown;
  /** generation 真正完成的时间 */
  generatedAt: string;
  /** auto_generations 行的创建时间（ingestion 完成那一刻） */
  triggeredAt: string;
}

/**
 * 项目级"进行中或刚失败"的自动卡片——Chat 页 ProjectInfoCards 用来显示
 * "LLM 生成中…"或"上次失败"的状态横幅，与已成功的 ProjectAutoGenLatest 并列展示。
 *
 * status:
 *   - queued：auto_generations 行已 insert，setImmediate 还没把 runner 拉起来
 *   - running：generate 正在跑
 *   - failed：上次 generate 失败（最近一次），用户能看到 error 字符串
 */
export interface ProjectAutoGenInFlight {
  cardType: AutoGenCardType;
  autoGenId: string;
  documentId: string;
  status: "queued" | "running" | "failed";
  triggeredAt: string;
  error: string | null;
}
