/**
 * 内容评测离线回归 · 测试 — feat-400.2
 *
 * 把开发集 + 保留集全跑一遍，任何一条与期望不符即 fail。改硬规则/决策后跑这个就知道有没有退化。
 */

import { describe, expect, it } from "vitest";
import { runSuite } from "../golden-runner";
import { DEV_SET } from "../golden/dev-set";
import { HOLDOUT_SET } from "../golden/holdout-set";

describe("内容评测离线回归", () => {
  it("开发集全过", () => {
    const r = runSuite(DEV_SET);
    const failed = r.results.filter((x) => !x.ok);
    if (failed.length) console.error(failed.map((f) => `${f.id}: ${f.mismatches.join("; ")}`).join("\n"));
    expect(r.failed).toBe(0);
    expect(r.total).toBeGreaterThanOrEqual(8);
  });

  it("保留集全过（回归防线）", () => {
    const r = runSuite(HOLDOUT_SET);
    const failed = r.results.filter((x) => !x.ok);
    if (failed.length) console.error(failed.map((f) => `${f.id}: ${f.mismatches.join("; ")}`).join("\n"));
    expect(r.failed).toBe(0);
    expect(r.total).toBeGreaterThanOrEqual(6);
  });
});
