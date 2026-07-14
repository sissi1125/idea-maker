/**
 * 确定性规则门禁单测 — feat-400.2
 *
 * 穷举门禁的每条死规则：未批准 Claim、缺 evidence、编造硬事实、敏感词、超长、重复。
 */

import { describe, expect, it } from "vitest";
import {
  runDeterministicGate,
  extractHardFacts,
  type GateClaim,
  type GateContext,
} from "../deterministic-gate";

function claim(over: Partial<GateClaim>): GateClaim {
  return {
    id: over.id ?? "c1",
    text: over.text ?? "功能：一键导出 PDF",
    status: over.status ?? "approved",
    claimType: over.claimType ?? "functional",
    evidenceChunkIds: over.evidenceChunkIds ?? ["e1"],
  };
}
function ctx(claims: GateClaim[], platform?: GateContext["platform"]): GateContext {
  return { claimsById: new Map(claims.map((c) => [c.id, c])), platform };
}

describe("extractHardFacts", () => {
  it("抽取价格/百分比/容量，忽略普通计数", () => {
    const f = extractHardFacts("每月 99 元，省 50%，容量 16GB，共 3 个角度");
    expect(f.has("99元")).toBe(true);
    expect(f.has("50%")).toBe(true);
    expect(f.has("16gb")).toBe(true);
    // "3 个角度" 不带硬单位 → 不抽取
    expect([...f].some((x) => x.includes("3"))).toBe(false);
  });
  it("货币前缀", () => {
    expect(extractHardFacts("售价 ¥1,299").has("¥1299")).toBe(true);
  });
});

describe("runDeterministicGate", () => {
  it("引用已批准 Claim + 无硬事实冲突 → 通过", () => {
    const c = claim({ id: "c1", text: "功能：一键导出 PDF" });
    const r = runDeterministicGate(
      { body: "一键导出 PDF，效率翻倍。", claimIds: ["c1"] },
      ctx([c]),
    );
    expect(r.passed).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("引用未批准 Claim → unapproved_claim", () => {
    const c = claim({ id: "c1", status: "candidate" });
    const r = runDeterministicGate({ body: "x", claimIds: ["c1"] }, ctx([c]));
    expect(r.passed).toBe(false);
    expect(r.failures[0].rule).toBe("unapproved_claim");
  });

  it("引用不存在的 Claim → unknown_claim", () => {
    const r = runDeterministicGate({ body: "x", claimIds: ["ghost"] }, ctx([]));
    expect(r.failures.some((f) => f.rule === "unknown_claim")).toBe(true);
  });

  it("事实型 Claim 缺 evidence → missing_evidence", () => {
    const c = claim({ id: "c1", claimType: "functional", evidenceChunkIds: [] });
    const r = runDeterministicGate({ body: "x", claimIds: ["c1"] }, ctx([c]));
    expect(r.failures.some((f) => f.rule === "missing_evidence")).toBe(true);
  });

  it("内容出现无 Claim 支撑的价格 → unsupported_number（核心防幻觉）", () => {
    const c = claim({ id: "c1", text: "功能：导出 PDF" }); // 无价格
    const r = runDeterministicGate(
      { body: "限时特价每月 99 元！", claimIds: ["c1"] },
      ctx([c]),
    );
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.rule === "unsupported_number")).toBe(true);
  });

  it("价格在引用 Claim 里有据 → 通过", () => {
    const c = claim({ id: "c1", text: "价格：专业版每月 99 元", claimType: "functional", evidenceChunkIds: ["e1"] });
    const r = runDeterministicGate(
      { body: "专业版每月 99 元，立省时间。", claimIds: ["c1"] },
      ctx([c]),
    );
    expect(r.passed).toBe(true);
  });

  it("重复引用同一 Claim → duplicate_claim", () => {
    const c = claim({ id: "c1" });
    const r = runDeterministicGate({ body: "一键导出 PDF", claimIds: ["c1", "c1"] }, ctx([c]));
    expect(r.failures.some((f) => f.rule === "duplicate_claim")).toBe(true);
  });

  it("超平台字数 → too_long", () => {
    const c = claim({ id: "c1", text: "功能：导出" });
    const r = runDeterministicGate(
      { body: "导出".repeat(100), claimIds: ["c1"] },
      ctx([c], { maxLength: 50 }),
    );
    expect(r.failures.some((f) => f.rule === "too_long")).toBe(true);
  });

  it("命中敏感词 → banned_word", () => {
    const c = claim({ id: "c1", text: "功能：导出" });
    const r = runDeterministicGate(
      { body: "全网最低价，导出功能", claimIds: ["c1"] },
      ctx([c], { bannedWords: ["最低价"] }),
    );
    expect(r.failures.some((f) => f.rule === "banned_word")).toBe(true);
  });

  it("多条失败一并返回", () => {
    const r = runDeterministicGate(
      { body: "每月 199 元", claimIds: ["ghost", "ghost"] },
      ctx([]),
    );
    // duplicate + unknown + unsupported_number
    expect(r.failures.length).toBeGreaterThanOrEqual(2);
    expect(r.passed).toBe(false);
  });
});
