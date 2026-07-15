/**
 * Campaign 生成 · 纯函数单测 — feat-400.4
 */

import { describe, expect, it } from "vitest";
import { buildGenerationPrompt, parseVariants, groundVariants } from "../campaign-generation";

describe("buildGenerationPrompt", () => {
  it("列出允许卖点并标 claim_id", () => {
    const p = buildGenerationPrompt(
      { goal: "launch", platform: "小红书" },
      [{ id: "c1", text: "一键导出 PDF" }],
      3,
    );
    expect(p).toContain("[claim_id: c1] 一键导出 PDF");
    expect(p).toContain("3 个");
    expect(p).toContain("产品发布");
  });
  it("无卖点时给出提示，不留空", () => {
    const p = buildGenerationPrompt({ goal: "messaging" }, [], 3);
    expect(p).toContain("没有可用卖点");
  });
});

describe("parseVariants", () => {
  it("剥 fence 并解析多个角度", () => {
    const text = '```json\n{"variants":[{"angle":"痛点","hook":"h","body":"b1","cta":"试试","claimIds":["c1"]},{"angle":"场景","body":"b2"}]}\n```';
    const vs = parseVariants(text);
    expect(vs).toHaveLength(2);
    expect(vs[0].angle).toBe("痛点");
    expect(vs[1].cta).toBe(""); // 默认值
  });
  it("非法 JSON → 空数组", () => {
    expect(parseVariants("not json")).toEqual([]);
  });
  it("缺 body 的角度整体校验失败 → 空", () => {
    expect(parseVariants('{"variants":[{"angle":"x"}]}')).toEqual([]);
  });

  // 真实 glm-4-flash 会把结果多包一层数组，回归此 bug
  it("数组包裹 [{variants:[...]}] → 拆包解析", () => {
    const text = '[{"variants":[{"angle":"痛点","body":"b1"},{"angle":"场景","body":"b2"}]}]';
    expect(parseVariants(text)).toHaveLength(2);
  });
});

describe("groundVariants", () => {
  const allowed = new Set(["c1", "c2"]);
  it("剔除越界/幻觉卖点引用", () => {
    const g = groundVariants(
      [{ angle: "a", hook: "", body: "b", cta: "", claimIds: ["c1", "ghost", "c3"] }],
      allowed,
    );
    expect(g[0].claimIds).toEqual(["c1"]);
    expect(g[0].droppedClaimIds).toEqual(["ghost", "c3"]);
  });
  it("全部合法 → 无剔除", () => {
    const g = groundVariants([{ angle: "a", hook: "", body: "b", cta: "", claimIds: ["c1", "c2"] }], allowed);
    expect(g[0].claimIds).toEqual(["c1", "c2"]);
    expect(g[0].droppedClaimIds).toEqual([]);
  });
});
