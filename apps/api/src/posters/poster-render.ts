/**
 * 海报 · 受限模板 DSL + 校验（纯函数）— feat-400.5
 *
 * 关键约束（面试考点）：
 *   - 模型/Agent 永远不产出任意 HTML/CSS。海报 = 固定 SVG 模板 + 纯文本槽，
 *     调用方只能选 templateId + 填文本/资产引用，不能塞标签（xmlEscape 兜底防注入）。
 *   - 只能用已批准的 Claim 和资产（校验层拦截）。
 *   - 出图前查：模板合法 / 标题非空 / 文字不溢出 / 颜色合法 / 前景背景对比度够。
 */

/** 校验用输入（不含已解析的 claimText/logoDataUri，那是渲染阶段填的） */
export interface PosterSpecInput {
  templateId: string;
  title: string;
  subtitle?: string;
  claimId?: string;
  logoAssetId?: string;
  /** 背景图资产（hero-image 模板）*/
  bgImageAssetId?: string;
  bgColor?: string;
  fgColor?: string;
}

/** 渲染槽（校验通过后由 service 解析填充） */
export interface PosterSlots {
  title: string;
  subtitle?: string;
  claimText?: string;
  logoDataUri?: string;
  /** 背景图（官网主图）data URI —— hero-image 模板用 */
  bgImageDataUri?: string;
  bgColor: string;
  fgColor: string;
}

export interface PosterTemplate {
  id: string;
  width: number;
  height: number;
  limits: { title: number; subtitle: number; claim: number };
  build(slots: PosterSlots): string;
}

export const DEFAULT_BG = "#4f46e5";
export const DEFAULT_FG = "#ffffff";
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** XML 转义：SVG 是 XML，槽文本必须转义，防注入 + 防坏字符破坏结构 */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function isValidHex(s: string | undefined): boolean {
  return !!s && HEX_RE.test(s);
}

/** 把 #rgb / #rrggbb 解析成 [r,g,b] 0-255 */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 对比度（1~21）。文字可读性检查用。 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relLuminance(hexToRgb(fg));
  const l2 = relLuminance(hexToRgb(bg));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
/** 海报字号偏大，取 WCAG 大文本 3:1 为门槛 */
export const MIN_CONTRAST = 3;

/** 简单按字符数折行成 tspan（SVG 不自动折行） */
function wrapTspans(text: string, maxChars: number, x: number, lineHeight: number): string {
  const words = text.split("");
  const lines: string[] = [];
  let cur = "";
  for (const ch of words) {
    if (cur.length >= maxChars) { lines.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) lines.push(cur);
  return lines
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${xmlEscape(l)}</tspan>`)
    .join("");
}

function logoTag(slots: PosterSlots, x: number, y: number, size: number): string {
  if (!slots.logoDataUri) return "";
  // 只接受 data: URI（service 已从已批准资产读出并 base64）；不引用外部 URL
  if (!slots.logoDataUri.startsWith("data:")) return "";
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${xmlEscape(slots.logoDataUri)}" preserveAspectRatio="xMidYMid meet"/>`;
}

/** 模板 A：简洁主张卡 —— logo + 标题 + 一句主张 */
const simpleQuote: PosterTemplate = {
  id: "simple-quote",
  width: 800,
  height: 800,
  limits: { title: 24, subtitle: 40, claim: 60 },
  build(s) {
    const claim = s.claimText ? `<text x="80" y="480" fill="${s.fgColor}" font-size="40" font-family="sans-serif" font-weight="600">${wrapTspans(s.claimText, 16, 80, 56)}</text>` : "";
    const sub = s.subtitle ? `<text x="80" y="620" fill="${s.fgColor}" font-size="26" font-family="sans-serif" opacity="0.85">${wrapTspans(s.subtitle, 22, 80, 36)}</text>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">
<rect width="${this.width}" height="${this.height}" fill="${s.bgColor}"/>
${logoTag(s, 80, 90, 96)}
<text x="80" y="300" fill="${s.fgColor}" font-size="64" font-family="sans-serif" font-weight="700">${wrapTspans(s.title, 12, 80, 74)}</text>
${claim}
${sub}
</svg>`;
  },
};

/** 模板 B：功能高亮条 —— 顶部标题带，中部主张 */
const featureCard: PosterTemplate = {
  id: "feature-card",
  width: 1080,
  height: 720,
  limits: { title: 20, subtitle: 50, claim: 80 },
  build(s) {
    const claim = s.claimText ? `<text x="72" y="380" fill="${s.fgColor}" font-size="44" font-family="sans-serif" font-weight="600">${wrapTspans(s.claimText, 22, 72, 60)}</text>` : "";
    const sub = s.subtitle ? `<text x="72" y="560" fill="${s.fgColor}" font-size="28" font-family="sans-serif" opacity="0.85">${wrapTspans(s.subtitle, 34, 72, 38)}</text>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">
<rect width="${this.width}" height="${this.height}" fill="${s.bgColor}"/>
<rect width="${this.width}" height="150" fill="${s.fgColor}" opacity="0.12"/>
${logoTag(s, 900, 40, 72)}
<text x="72" y="100" fill="${s.fgColor}" font-size="48" font-family="sans-serif" font-weight="700">${wrapTspans(s.title, 18, 72, 56)}</text>
${claim}
${sub}
</svg>`;
  },
};

/** 模板 C：官网图打底 —— 主图铺满 + 暗色遮罩 + 白字标题/主张（3.7 自动海报用） */
const heroImage: PosterTemplate = {
  id: "hero-image",
  width: 1080,
  height: 1080,
  limits: { title: 24, subtitle: 50, claim: 70 },
  build(s) {
    const bg = s.bgImageDataUri && s.bgImageDataUri.startsWith("data:")
      ? `<image x="0" y="0" width="${this.width}" height="${this.height}" href="${xmlEscape(s.bgImageDataUri)}" preserveAspectRatio="xMidYMid slice"/>
<rect width="${this.width}" height="${this.height}" fill="#000000" opacity="0.45"/>`
      : `<rect width="${this.width}" height="${this.height}" fill="${s.bgColor}"/>`;
    const claim = s.claimText ? `<text x="80" y="720" fill="#ffffff" font-size="46" font-family="sans-serif" font-weight="600">${wrapTspans(s.claimText, 20, 80, 62)}</text>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">
${bg}
${logoTag(s, 80, 90, 88)}
<text x="80" y="560" fill="#ffffff" font-size="72" font-family="sans-serif" font-weight="700">${wrapTspans(s.title, 12, 80, 84)}</text>
${claim}
</svg>`;
  },
};

export const POSTER_TEMPLATES: Record<string, PosterTemplate> = {
  [simpleQuote.id]: simpleQuote,
  [featureCard.id]: featureCard,
  [heroImage.id]: heroImage,
};
export const POSTER_TEMPLATE_IDS = Object.keys(POSTER_TEMPLATES);

export function buildPosterSvg(templateId: string, slots: PosterSlots): string {
  const t = POSTER_TEMPLATES[templateId];
  if (!t) throw new Error(`未知模板 ${templateId}`);
  return t.build(slots);
}

export interface PosterFailure {
  rule:
    | "unknown_template" | "missing_title" | "title_overflow" | "subtitle_overflow"
    | "claim_overflow" | "unapproved_claim" | "unapproved_asset" | "bad_color" | "low_contrast";
  detail: string;
}
export interface PosterValidateResult {
  passed: boolean;
  failures: PosterFailure[];
}

export interface PosterValidateContext {
  approvedClaimIds: Set<string>;
  approvedAssetIds: Set<string>;
  /** 若引用了 claim，其解析后的文本（用于 overflow 检查） */
  claimText?: string;
}

/**
 * 出图前的硬规则检查：模板/标题/溢出/资产合法/Claim 合法/颜色/对比度。
 * 任一失败即不出图（passed=false）。
 */
export function validatePosterSpec(input: PosterSpecInput, ctx: PosterValidateContext): PosterValidateResult {
  const failures: PosterFailure[] = [];
  const t = POSTER_TEMPLATES[input.templateId];
  if (!t) {
    return { passed: false, failures: [{ rule: "unknown_template", detail: `模板 ${input.templateId} 不存在` }] };
  }
  if (!input.title?.trim()) failures.push({ rule: "missing_title", detail: "标题不能为空" });
  if (input.title && input.title.length > t.limits.title)
    failures.push({ rule: "title_overflow", detail: `标题超过 ${t.limits.title} 字` });
  if (input.subtitle && input.subtitle.length > t.limits.subtitle)
    failures.push({ rule: "subtitle_overflow", detail: `副标题超过 ${t.limits.subtitle} 字` });
  if (ctx.claimText && ctx.claimText.length > t.limits.claim)
    failures.push({ rule: "claim_overflow", detail: `主张文字超过 ${t.limits.claim} 字` });

  if (input.claimId && !ctx.approvedClaimIds.has(input.claimId))
    failures.push({ rule: "unapproved_claim", detail: "引用了未批准的 Claim" });
  if (input.logoAssetId && !ctx.approvedAssetIds.has(input.logoAssetId))
    failures.push({ rule: "unapproved_asset", detail: "引用了未批准的视觉资产（logo）" });
  if (input.bgImageAssetId && !ctx.approvedAssetIds.has(input.bgImageAssetId))
    failures.push({ rule: "unapproved_asset", detail: "引用了未批准的视觉资产（背景图）" });

  const bg = input.bgColor ?? DEFAULT_BG;
  const fg = input.fgColor ?? DEFAULT_FG;
  if (!isValidHex(bg) || !isValidHex(fg)) {
    failures.push({ rule: "bad_color", detail: "颜色必须是 #rgb / #rrggbb" });
  } else if (contrastRatio(fg, bg) < MIN_CONTRAST) {
    failures.push({ rule: "low_contrast", detail: `前景/背景对比度不足（<${MIN_CONTRAST}:1），文字看不清` });
  }

  return { passed: failures.length === 0, failures };
}
