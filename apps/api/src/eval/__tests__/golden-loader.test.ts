/**
 * golden-loader 单测 — feat-300.5
 *
 * - 默认目录可加载现有 5 条 sample item
 * - 字段缺失文件抛错（含文件名）
 * - id 冲突抛错
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadGoldenSet, DEFAULT_GOLDEN_DIR } from "../golden-loader";

describe("loadGoldenSet", () => {
  it("默认目录加载 5 条 sample item，按 id 排序", () => {
    const items = loadGoldenSet(DEFAULT_GOLDEN_DIR);
    expect(items.length).toBeGreaterThanOrEqual(5);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual([...ids].sort());
    // 每条都有 expectedTools / referenceAnswer / thresholds
    for (const it of items) {
      expect(it.referenceAnswer).toBeTruthy();
      expect(it.thresholds).toBeDefined();
      expect(Array.isArray(it.expectedTools)).toBe(true);
    }
  });

  it("字段缺失文件抛错（带文件名）", () => {
    const dir = mkdtempSync(join(tmpdir(), "golden-test-"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ id: "x" }));
    expect(() => loadGoldenSet(dir)).toThrow(/bad\.json/);
  });

  it("id 冲突抛错", () => {
    const dir = mkdtempSync(join(tmpdir(), "golden-test-"));
    const item = {
      id: "dup-1",
      query: "q",
      expectedTools: [],
      referenceAnswer: "r",
      thresholds: { faithfulness: 3, completeness: 3, style: 3 },
    };
    writeFileSync(join(dir, "a.json"), JSON.stringify(item));
    writeFileSync(join(dir, "b.json"), JSON.stringify(item));
    expect(() => loadGoldenSet(dir)).toThrow(/id 冲突/);
  });
});
