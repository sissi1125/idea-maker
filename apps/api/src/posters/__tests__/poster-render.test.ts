/**
 * 海报 · 受限模板 + 校验单测 — feat-400.5（纯函数）
 */

import { describe, expect, it } from "vitest";
import {
  buildPosterSvg, validatePosterSpec, contrastRatio, xmlEscape, isValidHex,
  POSTER_TEMPLATE_IDS, type PosterSpecInput,
} from "../poster-render";

describe("xmlEscape（防注入）", () => {
  it("转义尖括号/引号 —— 槽文本塞不进标签", () => {
    expect(xmlEscape('</text><script>x</script>')).toBe("&lt;/text&gt;&lt;script&gt;x&lt;/script&gt;");
  });
});

describe("contrastRatio", () => {
  it("黑白对比约 21", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
  });
  it("相近色对比低", () => {
    expect(contrastRatio("#4f46e5", "#5b52ea")).toBeLessThan(3);
  });
  it("白字靛蓝底对比够（>3）", () => {
    expect(contrastRatio("#ffffff", "#4f46e5")).toBeGreaterThan(3);
  });
});

describe("isValidHex", () => {
  it.each(["#fff", "#4f46e5", "#ABCDEF"])("合法 %s", (h) => expect(isValidHex(h)).toBe(true));
  it.each(["fff", "#12", "#gggggg", "", undefined])("非法 %s", (h) => expect(isValidHex(h as string)).toBe(false));
});

describe("buildPosterSvg", () => {
  it("填入标题且转义，返回合法 svg", () => {
    const svg = buildPosterSvg("simple-quote", { title: "熊掌记<b>", bgColor: "#4f46e5", fgColor: "#ffffff" });
    expect(svg).toContain("<svg");
    expect(svg).toContain("熊掌记&lt;b&gt;"); // 转义
    expect(svg).not.toContain("熊掌记<b>");
  });
  it("未知模板抛错", () => {
    expect(() => buildPosterSvg("nope", { title: "x", bgColor: "#000", fgColor: "#fff" })).toThrow();
  });
  it("非 data: 的 logo 被丢弃（不引用外链）", () => {
    const svg = buildPosterSvg("simple-quote", { title: "x", bgColor: "#000000", fgColor: "#ffffff", logoDataUri: "http://evil/x.png" });
    expect(svg).not.toContain("evil");
  });
});

describe("validatePosterSpec", () => {
  const ctx = (over = {}) => ({ approvedClaimIds: new Set(["c1"]), approvedAssetIds: new Set(["a1"]), ...over });
  const base: PosterSpecInput = { templateId: "simple-quote", title: "熊掌记" };

  it("干净 → 通过", () => {
    expect(validatePosterSpec(base, ctx()).passed).toBe(true);
  });
  it("未知模板 → 拦下", () => {
    const r = validatePosterSpec({ ...base, templateId: "nope" }, ctx());
    expect(r.passed).toBe(false);
    expect(r.failures[0].rule).toBe("unknown_template");
  });
  it("空标题 → missing_title", () => {
    const r = validatePosterSpec({ ...base, title: "  " }, ctx());
    expect(r.failures.some((f) => f.rule === "missing_title")).toBe(true);
  });
  it("标题超长 → title_overflow", () => {
    const r = validatePosterSpec({ ...base, title: "字".repeat(40) }, ctx());
    expect(r.failures.some((f) => f.rule === "title_overflow")).toBe(true);
  });
  it("引用未批准 Claim → unapproved_claim", () => {
    const r = validatePosterSpec({ ...base, claimId: "ghost" }, ctx());
    expect(r.failures.some((f) => f.rule === "unapproved_claim")).toBe(true);
  });
  it("引用未批准资产 → unapproved_asset", () => {
    const r = validatePosterSpec({ ...base, logoAssetId: "ghost" }, ctx());
    expect(r.failures.some((f) => f.rule === "unapproved_asset")).toBe(true);
  });
  it("对比度不足 → low_contrast", () => {
    const r = validatePosterSpec({ ...base, bgColor: "#4f46e5", fgColor: "#5b52ea" }, ctx());
    expect(r.failures.some((f) => f.rule === "low_contrast")).toBe(true);
  });
  it("非法颜色 → bad_color", () => {
    const r = validatePosterSpec({ ...base, bgColor: "red" }, ctx());
    expect(r.failures.some((f) => f.rule === "bad_color")).toBe(true);
  });
  it("主张文字超长 → claim_overflow", () => {
    const r = validatePosterSpec({ ...base, claimId: "c1" }, ctx({ claimText: "字".repeat(61) }));
    expect(r.failures.some((f) => f.rule === "claim_overflow")).toBe(true);
  });
});

describe("模板注册", () => {
  it("至少 2 个模板", () => expect(POSTER_TEMPLATE_IDS.length).toBeGreaterThanOrEqual(2));
});
