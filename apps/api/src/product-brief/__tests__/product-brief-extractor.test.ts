/**
 * ProductBriefExtractor 单测 — feat-400.1 slice 2
 *
 * 只测纯逻辑（不连库、不调 LLM）：解析、净化、幻觉出处过滤、字符预算。
 */

import { describe, expect, it } from "vitest";
import { ProductBriefExtractor } from "../product-brief-extractor";

const ext = () => new ProductBriefExtractor({} as any, {} as any, {} as any, {} as any);

describe("parseFields", () => {
  it("剥掉 ```json fence 并解析", () => {
    const text = '```json\n{"fields":[{"group":"identity","key":"name","value":"Idea-Maker","evidenceChunkIds":["c1"],"confidence":0.9}]}\n```';
    const fields = ext().parseFields(text);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("name");
  });

  it("非法 JSON 容错截取 { }", () => {
    const text = '废话前缀 {"fields":[{"group":"fact","key":"pricing","value":"免费","evidenceChunkIds":[],"confidence":0.5}]} 尾巴';
    expect(ext().parseFields(text)).toHaveLength(1);
  });

  it("完全无法解析 → 空数组", () => {
    expect(ext().parseFields("this is not json")).toEqual([]);
  });

  it("Zod 不符（缺 group）→ 整体判空", () => {
    expect(ext().parseFields('{"fields":[{"key":"x","value":"y"}]}')).toEqual([]);
  });

  // 真实 glm-4-flash 会把结果多包一层数组，回归此 bug
  it("数组包裹 [{fields:[...]}] → 拆包解析", () => {
    const text = '```json\n[{"fields":[{"group":"identity","key":"name","value":"BloomNote","evidenceChunkIds":["c1"],"confidence":1}]}]\n```';
    const fields = ext().parseFields(text);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("name");
  });
  it("直接是字段对象数组 [ {...} ] → 当作 fields", () => {
    const text = '[{"group":"fact","key":"pricing","value":"29 元","evidenceChunkIds":["c2"],"confidence":0.9}]';
    expect(ext().parseFields(text)).toHaveLength(1);
  });
});

describe("sanitize", () => {
  const validIds = new Set(["c1", "c2", "w1"]);
  const originById = new Map<string, "document" | "website">([
    ["c1", "document"],
    ["c2", "document"],
    ["w1", "website"],
  ]);

  it("丢弃幻觉出处（不在输入 chunk 集里的 id）", () => {
    const out = ext().sanitize(
      [{ group: "fact", key: "features", value: "A", evidenceChunkIds: ["c1", "ghost"], confidence: 0.9 }],
      validIds,
      originById,
    );
    expect(out[0].evidenceChunkIds).toEqual(["c1"]);
    expect(out[0].source).toBe("document");
  });

  it("出处来自官网 chunk → source=website", () => {
    const out = ext().sanitize(
      [{ group: "fact", key: "pricing", value: "免费", evidenceChunkIds: ["w1"], confidence: 0.9 }],
      validIds,
      originById,
    );
    expect(out[0].source).toBe("website");
  });

  it("无有效 evidence → source=inferred，置信度封顶 0.4", () => {
    const out = ext().sanitize(
      [{ group: "fact", key: "limit", value: "X", evidenceChunkIds: ["ghost"], confidence: 0.95 }],
      validIds,
      originById,
    );
    expect(out[0].source).toBe("inferred");
    expect(out[0].confidence).toBe(0.4);
  });

  it("非事实型分组（style）被过滤掉", () => {
    const out = ext().sanitize(
      [{ group: "style", key: "tone", value: "活泼", evidenceChunkIds: ["c1"], confidence: 0.8 }],
      validIds,
      originById,
    );
    expect(out).toHaveLength(0);
  });
});

describe("buildInputBlock", () => {
  it("标注 chunk_id 且 usedIds 收集正确", () => {
    const { block, usedIds, truncated } = ext().buildInputBlock([
      { id: "c1", text: "第一段内容", origin: "document" },
      { id: "w1", text: "官网内容", origin: "website" },
    ]);
    expect(block).toContain("[chunk_id: c1]");
    expect(block).toContain("[chunk_id: w1]");
    expect(usedIds).toEqual(new Set(["c1", "w1"]));
    expect(truncated).toBe(false);
  });

  it("超字符预算 → 截断且 truncated=true", () => {
    const big = "x".repeat(1_200);
    const chunks = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, text: big, origin: "document" as const }));
    const { usedIds, truncated } = ext().buildInputBlock(chunks);
    expect(truncated).toBe(true);
    expect(usedIds.size).toBeLessThan(50);
  });
});
