/**
 * 编辑差异分类 + 偏好更新映射 — feat-400.3（纯函数）
 *
 * 用户把 AI 文案改成什么样，信息量比打分大得多。先把编辑归入有限类别，
 * 再聚合多次同类编辑，给出「偏好更新建议」。
 *
 * 红线：所有建议只落到"表达约束"（group=style/constraint），永不改产品事实。
 */

/** 有限的编辑归类（对齐 PRODUCT_BRIEF_ITERATION_PLAN §6.2） */
export const EDIT_CATEGORIES = [
  "tone_exaggerated", // 语气太夸张
  "too_technical", // 太技术化
  "too_verbose", // 太冗长
  "missing_scenario", // 缺少具体场景
  "cta_unnatural", // CTA 不自然
  "claim_inaccurate", // 主张不准确
  "platform_tone_off", // 平台语感不对
  "other",
] as const;
export type EditCategory = (typeof EDIT_CATEGORIES)[number];

/** 夸张表达词表 */
const EXAGGERATION_WORDS = [
  "最", "极致", "秒杀", "爆款", "无敌", "最强", "绝了", "神器", "一键搞定",
  "史上", "全网最", "独家", "震撼", "超值", "王炸", "封神", "碾压",
];
/** 技术术语标志（粗略） */
const TECH_WORDS = ["算法", "架构", "接口", "协议", "底层", "内核", "向量", "并发", "分布式", "SDK", "API"];

function countHits(text: string, words: string[]): number {
  return words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
}

/**
 * 基于编辑前后文本自动归类（best-effort）。用户也可显式指定 category 覆盖它。
 * 返回 null 表示识别不出（调用方可落 'other' 或用用户显式类别）。
 */
export function classifyEditDiff(original: string, edited: string): EditCategory | null {
  const o = original ?? "";
  const e = edited ?? "";
  if (!o && !e) return null;

  // 删夸张词：原文夸张词命中数明显多于改后
  const exOrig = countHits(o, EXAGGERATION_WORDS);
  const exEdited = countHits(e, EXAGGERATION_WORDS);
  if (exOrig - exEdited >= 1) return "tone_exaggerated";

  // 去术语：术语命中减少
  if (countHits(o, TECH_WORDS) - countHits(e, TECH_WORDS) >= 1) return "too_technical";

  // 大幅精简：改后长度不到原来的 60%
  if (o.length > 0 && e.length > 0 && e.length < o.length * 0.6) return "too_verbose";

  return null;
}

/** 一条"类别 → Brief 表达约束"的映射（聚合达阈值时生成建议） */
export interface SuggestionTemplate {
  targetGroup: "style" | "constraint";
  targetKey: string;
  targetValue: string;
  /** 生成建议文案，n = 触发的反馈条数 */
  render: (n: number) => string;
}

/**
 * 类别 → 更新模板。注意所有 targetGroup 都是 style/constraint —— 表达层，
 * 绝不出现 fact/identity/audience/positioning。claim_inaccurate 也只落"复核提醒"约束，
 * 不改事实本身（红线）。
 */
export const CATEGORY_TEMPLATES: Partial<Record<EditCategory, SuggestionTemplate>> = {
  tone_exaggerated: {
    targetGroup: "constraint", targetKey: "banned_expressions",
    targetValue: '避免夸张词（如"最""秒杀""神器"）',
    render: (n) => `最近 ${n} 次编辑都在删夸张表达，建议新增"禁用夸张词"约束`,
  },
  too_verbose: {
    targetGroup: "style", targetKey: "length_preference",
    targetValue: "简洁优先，避免冗长",
    render: (n) => `最近 ${n} 次编辑都在精简，建议表达约束加"简洁优先"`,
  },
  too_technical: {
    targetGroup: "style", targetKey: "tone",
    targetValue: "口语化，少用术语",
    render: (n) => `最近 ${n} 次编辑都在去术语，建议文风偏口语`,
  },
  missing_scenario: {
    targetGroup: "style", targetKey: "scenario_preference",
    targetValue: "多讲具体使用场景",
    render: (n) => `最近 ${n} 次编辑都在补场景，建议默认多讲具体场景`,
  },
  cta_unnatural: {
    targetGroup: "style", targetKey: "cta_style",
    targetValue: "CTA 自然、不硬推",
    render: (n) => `最近 ${n} 次编辑都在改 CTA，建议约定 CTA 风格`,
  },
  platform_tone_off: {
    targetGroup: "style", targetKey: "platform_tone",
    targetValue: "贴合目标平台语感",
    render: (n) => `最近 ${n} 次编辑都在调平台语感，建议记录平台语感偏好`,
  },
  claim_inaccurate: {
    // 主张不准确本质是事实问题，但红线是"不自动改事实"——只给复核提醒（表达层约束）
    targetGroup: "constraint", targetKey: "claim_review_note",
    targetValue: "多条内容被判主张不准，请人工核对卖点与证据",
    render: (n) => `最近 ${n} 次反馈指向主张不准，建议人工复核相关卖点（不会自动改事实）`,
  },
};

/** 聚合达标阈值：同类反馈累计到这个数就生成一条建议 */
export const SUGGESTION_THRESHOLD = 3;

export interface AggregatedSuggestion {
  category: EditCategory;
  count: number;
  sourceFeedbackIds: string[];
  template: SuggestionTemplate;
  text: string;
}

/**
 * 聚合反馈 → 建议。输入是（category, feedbackId）列表；同类累计 ≥ 阈值且有模板则出一条。
 */
export function aggregateSuggestions(
  feedbacks: Array<{ id: string; category: EditCategory }>,
): AggregatedSuggestion[] {
  const byCat = new Map<EditCategory, string[]>();
  for (const f of feedbacks) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category)!.push(f.id);
  }
  const out: AggregatedSuggestion[] = [];
  for (const [category, ids] of byCat) {
    const template = CATEGORY_TEMPLATES[category];
    if (!template || ids.length < SUGGESTION_THRESHOLD) continue;
    out.push({ category, count: ids.length, sourceFeedbackIds: ids, template, text: template.render(ids.length) });
  }
  return out;
}
