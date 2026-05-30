/**
 * MemoryReader 单测：SQL 入参 + confidence 阈值 + 防御坏数据。
 */

import { describe, expect, it, vi } from "vitest";
import { MemoryReader, DEFAULT_CONFIDENCE_THRESHOLD } from "../memory-reader";

describe("MemoryReader", () => {
  it("默认阈值传给 SQL", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const reader = new MemoryReader();
    await reader.load({ query: pgQuery } as never, "proj-1");
    expect(pgQuery).toHaveBeenCalledWith(
      expect.any(String),
      ["proj-1", DEFAULT_CONFIDENCE_THRESHOLD],
    );
  });

  it("自定义阈值透传", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const reader = new MemoryReader();
    await reader.load({ query: pgQuery } as never, "proj-1", 0.8);
    expect(pgQuery).toHaveBeenCalledWith(expect.any(String), ["proj-1", 0.8]);
  });

  it("返回结构按 MemoryEntry 形态", async () => {
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [
        { kind: "style", content: "活泼", confidence: 0.85 },
        { kind: "taboo", content: "不提竞品", confidence: 0.95 },
      ],
    });
    const reader = new MemoryReader();
    const result = await reader.load({ query: pgQuery } as never, "p");
    expect(result).toEqual([
      { kind: "style", content: "活泼", confidence: 0.85 },
      { kind: "taboo", content: "不提竞品", confidence: 0.95 },
    ]);
  });

  it("过滤掉非法 kind 值（防御异常数据）", async () => {
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [
        { kind: "style", content: "活泼", confidence: 0.85 },
        { kind: "garbage", content: "坏数据", confidence: 0.9 },
      ],
    });
    const reader = new MemoryReader();
    const result = await reader.load({ query: pgQuery } as never, "p");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("style");
  });

  it("confidence 转换为 number（pg 可能返回 string）", async () => {
    const pgQuery = vi.fn().mockResolvedValue({
      rows: [{ kind: "style", content: "x", confidence: "0.756" as never }],
    });
    const reader = new MemoryReader();
    const result = await reader.load({ query: pgQuery } as never, "p");
    expect(typeof result[0].confidence).toBe("number");
    expect(result[0].confidence).toBeCloseTo(0.756);
  });

  it("空结果返回空数组（不抛错）", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    const reader = new MemoryReader();
    const result = await reader.load({ query: pgQuery } as never, "p");
    expect(result).toEqual([]);
  });
});
