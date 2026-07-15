/**
 * 受限官网导入 —— 纯函数安全层（feat-400.1 slice 4）
 *
 * 这些是整个连接器"受限、不作恶"的核心保证，全部做成纯函数便于穷举单测：
 *   - 禁社交平台、禁私网地址（防 SSRF）
 *   - 同域白名单、路径白名单
 *   - robots.txt 遵守
 *   - HTML 结构化抽取（title / meta / OG / JSON-LD / 正文 / 同域链接）
 *
 * 明确不做：不登录、不绕权限、不抓私有页、不做通用网络爬虫、不抓社交平台。
 */

/** 爬虫 UA，robots 匹配用 */
export const IMPORT_USER_AGENT = "IdeaMakerBot";

/** 社交平台黑名单：这些域名一律拒绝（历史社交内容只接受用户粘贴/导出） */
const SOCIAL_HOSTS = [
  "weibo.com", "x.com", "twitter.com", "facebook.com", "fb.com", "instagram.com",
  "tiktok.com", "douyin.com", "xiaohongshu.com", "xhslink.com", "zhihu.com",
  "linkedin.com", "youtube.com", "youtu.be", "bilibili.com", "reddit.com",
  "pinterest.com", "t.me", "telegram.org", "wa.me", "whatsapp.com", "discord.com",
  "threads.net", "mastodon.social", "weixin.qq.com",
];

/** 允许抓取的路径白名单（正则）：首页 + 产品/定价/FAQ/帮助/文档/更新日志/关于 */
const ALLOWED_PATH_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/(index|home)(\.html?)?$/i,
  /^\/(products?|features?|solutions?)(\/|$)/i,
  /^\/(pricing|price|plans?|cost)(\/|$)/i,
  /^\/(faqs?|help|support|docs?|documentation|guide|manual)(\/|$)/i,
  /^\/(about|company|product)(\/|$)/i,
  /^\/(changelog|releases?|release-notes|updates?|whats-?new|news)(\/|$)/i,
];

/** 页面类型分类（用于 source_pages.page_type） */
export type PageType = "home" | "product" | "pricing" | "faq" | "help" | "changelog" | "about" | "other";

/** 语言前缀（/zh/、/en-us/…）：真实站点常见，匹配路径前先剥掉 */
const LOCALE_PREFIX_RE = /^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i;
function stripLocale(pathname: string): string {
  const s = pathname.replace(LOCALE_PREFIX_RE, "");
  return s === "" ? "/" : s;
}

export function classifyPageType(pathname: string): PageType {
  const p = stripLocale(pathname).toLowerCase();
  if (/^\/(index|home)?(\.html?)?\/?$/.test(p) || p === "/") return "home";
  if (/(pricing|price|plans?|cost)/.test(p)) return "pricing";
  if (/(products?|features?|solutions?)/.test(p)) return "product";
  if (/(faqs?)/.test(p)) return "faq";
  if (/(help|support|docs?|documentation|guide|manual)/.test(p)) return "help";
  if (/(changelog|releases?|release-notes|updates?|whats-?new|news)/.test(p)) return "changelog";
  if (/(about|company)/.test(p)) return "about";
  return "other";
}

/** 归一化用户提交的根 URL：补 https、去 fragment。非法则抛错 */
export function normalizeRootUrl(input: string): URL {
  const trimmed = (input ?? "").trim();
  if (!trimmed) throw new Error("请输入官网域名");
  // 若已带 scheme 且不是 http(s)（如 ftp:// / file:// / javascript:），直接拒绝，
  // 不能被"补 https 前缀"绕过成 https://ftp://... 这种畸形 URL。
  const isHttp = /^https?:\/\//i.test(trimmed);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !isHttp) {
    throw new Error("只支持 http/https");
  }
  const withProto = isHttp ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new Error("域名格式不合法");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只支持 http/https");
  }
  url.hash = "";
  return url;
}

/** 是否社交平台（host 精确或子域匹配黑名单） */
export function isSocialHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}

/** 是否私网 / 本地地址（防 SSRF 的 URL 字面量第一层检查）。 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  // IPv4 私网 / 回环 / link-local
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** DNS 解析后的地址也必须检查，避免公网域名在解析时指向内网（DNS rebinding）。 */
export function isPrivateIpAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped IPv6（::ffff:127.0.0.1）按原 IPv4 规则处理。
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateHost(mapped[1]);
  if (value.includes(":")) {
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
  }
  return isPrivateHost(value);
}

/** 同一可注册域：host 相等，或是根域的子域（简化版，按最后两段比较） */
export function sameRegistrableDomain(host: string, rootHost: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\.$/, "");
  const h = norm(host);
  const r = norm(rootHost);
  if (h === r) return true;
  return h.endsWith(`.${r}`);
}

/** 路径是否在白名单内（容忍 /zh/ 这类语言前缀） */
export function isAllowedPath(pathname: string): boolean {
  const p = stripLocale(pathname);
  return ALLOWED_PATH_PATTERNS.some((re) => re.test(p));
}

/** robots.txt 解析：取出对我们 UA（或 *）生效的 Disallow 前缀 */
export function parseRobotsTxt(txt: string, userAgent = IMPORT_USER_AGENT): { disallow: string[] } {
  const lines = txt.split(/\r?\n/);
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  let cur: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "disallow" && cur) {
      cur.disallow.push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const ua = userAgent.toLowerCase();
  const applicable = groups.filter((g) => g.agents.includes(ua) || g.agents.includes("*"));
  // 精确 UA 组优先；否则用 * 组
  const exact = applicable.filter((g) => g.agents.includes(ua));
  const chosen = exact.length ? exact : applicable;
  const disallow = chosen.flatMap((g) => g.disallow).filter((d) => d !== "");
  return { disallow };
}

/** 按 robots 规则判断路径是否允许（Disallow 前缀匹配即禁止） */
export function isAllowedByRobots(pathname: string, rules: { disallow: string[] }): boolean {
  return !rules.disallow.some((d) => d === "/" || pathname.startsWith(d));
}

export interface ExtractedPage {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  jsonLd: string | null;
  text: string;
  links: string[];
}

/** 从 HTML 抽取结构化字段 + 正文 + 同域链接（正则版，零依赖；restricted 官方页足够） */
export function extractPageContent(html: string, pageUrl: string): ExtractedPage {
  const pick = (re: RegExp): string | null => {
    const m = html.match(re);
    return m ? decodeEntities(m[1].trim()) : null;
  };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
    pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  const jsonLd = pick(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);

  // 正文：去 script/style/noscript/nav/footer，再剥标签、压空白
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body).replace(/\s+/g, " ").trim();

  // 同域链接：收集 href
  const links: string[] = [];
  const linkRe = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) !== null) {
    try {
      links.push(new URL(lm[1], pageUrl).toString());
    } catch {
      /* 忽略非法 href */
    }
  }
  return { title, description, ogTitle, jsonLd, text, links };
}

export interface ExtractedImages {
  /** logo 类：apple-touch-icon / rel=icon */
  logos: string[];
  /** 主图类：og:image / twitter:image */
  images: string[];
}

/**
 * 从 HTML 抽取品牌图片 URL（logo + 主图），解析成绝对地址、去重。
 * 只取可靠的品牌资产标记（og:image / icon），不抓正文里一堆 <img>（噪音大）。
 * 图片常在 CDN 上（跨域），所以不限同域——但下载时会查 content-type/大小/私网。
 */
export function extractImageUrls(html: string, pageUrl: string): ExtractedImages {
  const abs = (u: string): string | null => {
    try { return new URL(u.trim(), pageUrl).toString(); } catch { return null; }
  };
  const all = (re: RegExp): string[] => {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, "gi");
    while ((m = r.exec(html)) !== null) {
      const u = abs(decodeEntities(m[1]));
      if (u) out.push(u);
    }
    return out;
  };
  const uniq = (a: string[]) => [...new Set(a)];

  const images = uniq([
    ...all(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/),
    ...all(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/),
    ...all(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/),
  ]);
  const logos = uniq([
    ...all(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/),
    ...all(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/),
    ...all(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/),
  ]);
  return { logos, images };
}

/** 把正文切成不超过 maxLen 的片段（按句号/换行边界近似切） */
export function chunkText(text: string, maxLen = 1000): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const out: string[] = [];
  let buf = "";
  for (const seg of clean.split(/(?<=[。！？.!?])\s*/)) {
    if ((buf + seg).length > maxLen && buf) {
      out.push(buf.trim());
      buf = "";
    }
    buf += seg;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
