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
 *
 * ⚠️ 这是检索 query，不是给 LLM 的指令。embedding 命中的是与 query 语义相似的 chunk，
 * 所以模板必须描述"想要召回的内容维度"，而不是"想让 LLM 做什么"。
 * 指令式 query（如 "请生成产品介绍卡片"）会把召回方向带偏到元描述语料，
 * 命中不到真正的产品资料。生成阶段的指令在 prompt-build 的 systemPrompt 里。
 */
export const CARD_QUERY_TEMPLATES: Record<AutoGenCardType, string> = {
  intro: "产品定位 核心功能 目标用户 差异化优势 技术亮点 应用场景",
  compete: "竞品对比 市场格局 功能差异 价格策略 目标用户差异 差异化优势",
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
  /**
   * 按 [evidence-NNN] 1-based 顺序的 chunk 原文数组。
   * 前端把卡片里的 [evidence-001] 渲染成可点小按钮，点开/悬停弹层显示这里的 text。
   */
  evidence: Array<{ text: string; sourceRef?: string }>;
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
