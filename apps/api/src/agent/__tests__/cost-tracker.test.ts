/**
 * CostTracker 单测：价格查找 / 累计 / over / snapshot / BudgetExceededError。
 */

import { describe, expect, it } from "vitest";
import {
  CostTracker,
  PRICING,
  lookupPrice,
  BudgetExceededError,
} from "../cost-tracker";

describe("lookupPrice", () => {
  it("精确命中已知 model", () => {
    const p = lookupPrice("gpt-4o-mini");
    expect(p.inputPer1k).toBe(0.00015);
  });

  it("后缀匹配：版本号变体也能命中", () => {
    const p = lookupPrice("gpt-4o-mini-2024-07-18");
    expect(p.inputPer1k).toBe(0.00015);
  });

  it("未知 model 走 fallback 但不抛错", () => {
    const p = lookupPrice("totally-unknown-model");
    expect(p.source).toMatch(/fallback/);
    expect(p.inputPer1k).toBeGreaterThan(0);
  });
});

describe("CostTracker", () => {
  it("add() 按 input/output 分别计价并累加", () => {
    const t = new CostTracker("gpt-4o-mini");
    // 1000 input × $0.00015 + 500 output × $0.0006 = $0.00015 + $0.0003 = $0.00045
    const total = t.add({ promptTokens: 1000, completionTokens: 500 });
    expect(total).toBeCloseTo(0.00045, 8);
  });

  it("多次 add() 总账累加", () => {
    const t = new CostTracker("glm-4-flash");
    t.add({ promptTokens: 1000, completionTokens: 1000 });
    t.add({ promptTokens: 1000, completionTokens: 1000 });
    // glm-4-flash 0.0000139/1k × (4 × 1000) = 0.0000556
    expect(t.total).toBeCloseTo(0.0000556, 8);
  });

  it("over(budget) 在累计 > budget 时返 true", () => {
    const t = new CostTracker("gpt-4o-mini");
    t.add({ promptTokens: 100000, completionTokens: 100000 });
    // 0.015 + 0.06 = 0.075
    expect(t.over(0.05)).toBe(true);
    expect(t.over(0.1)).toBe(false);
  });

  it("budget=0 视为无上限（开发模式）", () => {
    const t = new CostTracker("gpt-4o");
    t.add({ promptTokens: 100000, completionTokens: 100000 });
    expect(t.over(0)).toBe(false);
  });

  it("percentOf 计算百分比", () => {
    const t = new CostTracker("gpt-4o-mini");
    t.add({ promptTokens: 100000, completionTokens: 0 }); // $0.015
    expect(t.percentOf(0.03)).toBeCloseTo(50, 1);
    expect(t.percentOf(0)).toBe(0);
  });

  it("snapshot() 返回完整明细", () => {
    const t = new CostTracker("glm-4-flash");
    t.add({ promptTokens: 100, completionTokens: 50 });
    const s = t.snapshot();
    expect(s.modelName).toBe("glm-4-flash");
    expect(s.inputTokens).toBe(100);
    expect(s.outputTokens).toBe(50);
    expect(s.usd).toBeGreaterThan(0);
  });
});

describe("BudgetExceededError", () => {
  it("含 usedUsd / budgetUsd 字段便于日志结构化", () => {
    const e = new BudgetExceededError(0.25, 0.2);
    expect(e.usedUsd).toBe(0.25);
    expect(e.budgetUsd).toBe(0.2);
    expect(e.name).toBe("BudgetExceededError");
    expect(e.message).toMatch(/Budget exceeded/);
  });

  it("可以被 instanceof 识别（AgentRunner catch 用）", () => {
    const e = new BudgetExceededError(1, 0.1);
    expect(e instanceof BudgetExceededError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });
});

describe("PRICING 表健全性", () => {
  it("所有价格都 > 0", () => {
    for (const [name, row] of Object.entries(PRICING)) {
      expect(row.inputPer1k, `${name}.inputPer1k`).toBeGreaterThan(0);
      expect(row.outputPer1k, `${name}.outputPer1k`).toBeGreaterThan(0);
    }
  });
  it("output 通常 >= input（典型 LLM 计价规律）", () => {
    for (const [name, row] of Object.entries(PRICING)) {
      // 不是硬规则，但偏离时要在 source 里注明（如智谱单价模型）
      if (row.outputPer1k < row.inputPer1k) {
        expect(row.source, `${name} output<input but no source note`).toBeDefined();
      }
    }
  });
});
