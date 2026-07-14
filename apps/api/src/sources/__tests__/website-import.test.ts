/**
 * 受限官网导入 · 安全层单测 — feat-400.1 slice 4
 *
 * 这是连接器"不作恶"的核心保证，穷举各种绕过尝试：社交平台、私网 SSRF、
 * 跨域、非白名单路径、robots 禁止。
 */

import { describe, expect, it } from "vitest";
import {
  normalizeRootUrl,
  isSocialHost,
  isPrivateHost,
  sameRegistrableDomain,
  isAllowedPath,
  parseRobotsTxt,
  isAllowedByRobots,
  extractPageContent,
  extractImageUrls,
  chunkText,
  classifyPageType,
} from "../website-import";

describe("normalizeRootUrl", () => {
  it("补 https 前缀", () => {
    expect(normalizeRootUrl("example.com").toString()).toBe("https://example.com/");
  });
  it("去掉 fragment", () => {
    expect(normalizeRootUrl("https://a.com/x#frag").hash).toBe("");
  });
  it("空输入抛错", () => {
    expect(() => normalizeRootUrl("")).toThrow();
  });
  it("非 http(s) 协议抛错", () => {
    expect(() => normalizeRootUrl("ftp://a.com")).toThrow();
  });
});

describe("isSocialHost", () => {
  it.each([
    "weibo.com", "www.weibo.com", "x.com", "twitter.com", "xiaohongshu.com",
    "m.douyin.com", "zhihu.com", "youtube.com", "t.me",
  ])("拦截社交平台 %s", (h) => {
    expect(isSocialHost(h)).toBe(true);
  });
  it("普通企业域名放行", () => {
    expect(isSocialHost("acme.com")).toBe(false);
    expect(isSocialHost("notweibo.com")).toBe(false); // 不能被后缀误伤
  });
});

describe("isPrivateHost (SSRF 防护)", () => {
  it.each([
    "localhost", "app.localhost", "127.0.0.1", "0.0.0.0", "::1",
    "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", "svc.internal", "db.local",
  ])("拦截私网/本地 %s", (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });
  it.each(["8.8.8.8", "acme.com", "172.15.0.1", "172.32.0.1"])("公网放行 %s", (h) => {
    expect(isPrivateHost(h)).toBe(false);
  });
});

describe("sameRegistrableDomain", () => {
  it("同域 + 子域放行", () => {
    expect(sameRegistrableDomain("acme.com", "acme.com")).toBe(true);
    expect(sameRegistrableDomain("docs.acme.com", "acme.com")).toBe(true);
  });
  it("不同域拦截", () => {
    expect(sameRegistrableDomain("evil.com", "acme.com")).toBe(false);
    expect(sameRegistrableDomain("acme.com.evil.com", "acme.com")).toBe(false);
  });
});

describe("isAllowedPath", () => {
  it.each(["/", "/pricing", "/products/x", "/faq", "/help/getting-started", "/changelog", "/about"])(
    "白名单路径放行 %s",
    (p) => expect(isAllowedPath(p)).toBe(true),
  );
  it.each(["/login", "/admin", "/cart", "/user/settings", "/api/private"])(
    "非白名单路径拦截 %s",
    (p) => expect(isAllowedPath(p)).toBe(false),
  );
  // 真实本地化站点（如 bear.app/zh/）会带语言前缀，回归此 gap
  it.each(["/zh/", "/zh/pricing", "/en-us/features", "/zh/faq"])(
    "容忍语言前缀 %s",
    (p) => expect(isAllowedPath(p)).toBe(true),
  );
  it("语言前缀下的非白名单路径仍拦截", () => {
    expect(isAllowedPath("/zh/login")).toBe(false);
  });
});

describe("classifyPageType", () => {
  it.each([
    ["/", "home"],
    ["/pricing", "pricing"],
    ["/products/a", "product"],
    ["/faq", "faq"],
    ["/help/x", "help"],
    ["/changelog", "changelog"],
    ["/about", "about"],
    ["/zh/", "home"],
    ["/zh/pricing", "pricing"],
  ] as const)("%s → %s", (p, t) => {
    expect(classifyPageType(p)).toBe(t);
  });
});

describe("parseRobotsTxt + isAllowedByRobots", () => {
  it("* 组 Disallow 生效", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /admin\nDisallow: /private");
    expect(isAllowedByRobots("/pricing", rules)).toBe(true);
    expect(isAllowedByRobots("/admin/x", rules)).toBe(false);
    expect(isAllowedByRobots("/private", rules)).toBe(false);
  });
  it("Disallow: / 全站禁止", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /");
    expect(isAllowedByRobots("/anything", rules)).toBe(false);
  });
  it("专属 UA 组优先于 *", () => {
    const rules = parseRobotsTxt(
      "User-agent: *\nDisallow: /\n\nUser-agent: IdeaMakerBot\nDisallow: /secret",
    );
    // 命中专属组：只有 /secret 禁止，其它放行
    expect(isAllowedByRobots("/pricing", rules)).toBe(true);
    expect(isAllowedByRobots("/secret", rules)).toBe(false);
  });
  it("空 Disallow 视为放行", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow:");
    expect(isAllowedByRobots("/x", rules)).toBe(true);
  });
});

describe("extractPageContent", () => {
  const html = `
    <html><head>
      <title>Acme 定价</title>
      <meta name="description" content="Acme 的价格方案">
      <meta property="og:title" content="Acme Pricing">
      <script type="application/ld+json">{"@type":"Product"}</script>
      <style>.x{color:red}</style>
    </head><body>
      <script>var x=1;</script>
      <h1>专业版 每月 99 元</h1>
      <p>支持 Windows 与 macOS。</p>
      <a href="/faq">FAQ</a>
      <a href="https://acme.com/about">关于</a>
    </body></html>`;

  it("抽取 title/description/og/jsonLd", () => {
    const r = extractPageContent(html, "https://acme.com/pricing");
    expect(r.title).toBe("Acme 定价");
    expect(r.description).toBe("Acme 的价格方案");
    expect(r.ogTitle).toBe("Acme Pricing");
    expect(r.jsonLd).toContain("Product");
  });
  it("正文剥掉 script/style，保留可读文本", () => {
    const r = extractPageContent(html, "https://acme.com/pricing");
    expect(r.text).toContain("专业版 每月 99 元");
    expect(r.text).toContain("Windows");
    expect(r.text).not.toContain("var x=1");
    expect(r.text).not.toContain("color:red");
  });
  it("链接解析为绝对 URL", () => {
    const r = extractPageContent(html, "https://acme.com/pricing");
    expect(r.links).toContain("https://acme.com/faq");
    expect(r.links).toContain("https://acme.com/about");
  });
});

describe("extractImageUrls", () => {
  const html = `<html><head>
    <meta property="og:image" content="https://cdn.acme.com/hero.png">
    <meta name="twitter:image" content="/tw.jpg">
    <link rel="apple-touch-icon" href="/icon-180.png">
    <link rel="icon" href="https://acme.com/favicon.ico">
  </head><body><img src="/inline.png"></body></html>`;

  it("抽 og:image / twitter:image 作主图（解析成绝对 URL）", () => {
    const r = extractImageUrls(html, "https://acme.com/zh/");
    expect(r.images).toContain("https://cdn.acme.com/hero.png");
    expect(r.images).toContain("https://acme.com/tw.jpg");
  });
  it("抽 apple-touch-icon / rel=icon 作 logo", () => {
    const r = extractImageUrls(html, "https://acme.com/zh/");
    expect(r.logos).toContain("https://acme.com/icon-180.png");
    expect(r.logos).toContain("https://acme.com/favicon.ico");
  });
  it("不抓正文里的 <img>（噪音）", () => {
    const r = extractImageUrls(html, "https://acme.com/");
    expect([...r.images, ...r.logos]).not.toContain("https://acme.com/inline.png");
  });
  it("无图页返回空", () => {
    const r = extractImageUrls("<html><body>hi</body></html>", "https://acme.com/");
    expect(r.images).toEqual([]);
    expect(r.logos).toEqual([]);
  });
});

describe("chunkText", () => {
  it("短文本单片返回", () => {
    expect(chunkText("很短")).toEqual(["很短"]);
  });
  it("空文本返回空数组", () => {
    expect(chunkText("   ")).toEqual([]);
  });
  it("长文本按边界切多片", () => {
    const long = "句子。".repeat(500); // 1500 chars
    const chunks = chunkText(long, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 400)).toBe(true);
  });
});
