/**
 * trajectoryMatch 单测 — feat-300.5
 *
 * 覆盖：
 *   - 完全命中
 *   - 部分命中（precision/recall/jaccard 数值正确）
 *   - 期望为空 → 满分
 *   - 实际为空 → precision=0 / recall=0 / jaccard=0
 *   - 重复 actual 去重
 *   - fullCover 判定
 */

import { describe, expect, it } from "vitest";
import { trajectoryMatch } from "../trajectory-match";

describe("trajectoryMatch", () => {
  it("完全命中：所有分项 = 1，fullCover=true", () => {
    const m = trajectoryMatch(["search_kb", "generate_draft"], ["generate_draft", "search_kb"]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.jaccard).toBe(1);
    expect(m.fullCover).toBe(true);
  });

  it("部分命中：precision/recall/jaccard 反映集合差异", () => {
    // expected = {a, b, c}; actual = {a, b, d}
    // 交集 {a,b}=2, 并集 {a,b,c,d}=4
    // precision = 2/3, recall = 2/3, jaccard = 2/4 = 0.5
    const m = trajectoryMatch(["a", "b", "c"], ["a", "b", "d"]);
    expect(m.precision).toBe(0.667);
    expect(m.recall).toBe(0.667);
    expect(m.jaccard).toBe(0.5);
    expect(m.fullCover).toBe(false);
  });

  it("expected 为空 → 不关心路径，全部满分", () => {
    const m = trajectoryMatch([], ["search_kb", "log_decision"]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.jaccard).toBe(1);
    expect(m.fullCover).toBe(true);
  });

  it("actual 为空但 expected 非空 → 全 0", () => {
    const m = trajectoryMatch(["search_kb"], []);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.jaccard).toBe(0);
    expect(m.fullCover).toBe(false);
  });

  it("actual 含重复：去重后比对", () => {
    // expected={a}; actual=[a,a,a] → 视作 {a}
    const m = trajectoryMatch(["a"], ["a", "a", "a"]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.jaccard).toBe(1);
  });

  it("fullCover：实际是期望的超集", () => {
    // expected={a,b}; actual={a,b,c} → fullCover true，但 precision = 2/3
    const m = trajectoryMatch(["a", "b"], ["a", "b", "c"]);
    expect(m.fullCover).toBe(true);
    expect(m.precision).toBe(0.667);
    expect(m.recall).toBe(1);
  });
});
