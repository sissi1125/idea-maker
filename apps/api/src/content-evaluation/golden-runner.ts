/**
 * 内容评测离线回归 · 运行器 — feat-400.2（纯函数）
 *
 * 把每条 golden 用例喂进硬规则检查 + 决策器，比对 gatePassed / decision / 期望失败原因。
 */

import { runDeterministicGate } from "./deterministic-gate";
import { decide } from "./decision";
import type { GoldenCase } from "./golden/types";

export interface CaseResult {
  id: string;
  ok: boolean;
  mismatches: string[];
}

export function runCase(c: GoldenCase): CaseResult {
  const gate = runDeterministicGate(c.variant, {
    claimsById: new Map(c.claims.map((x) => [x.id, x])),
    platform: c.platform,
  });
  const decision = decide(gate, c.scores ?? null);

  const mismatches: string[] = [];
  if (gate.passed !== c.expect.gatePassed) {
    mismatches.push(`gatePassed 实际 ${gate.passed} ≠ 期望 ${c.expect.gatePassed}`);
  }
  if (decision !== c.expect.decision) {
    mismatches.push(`decision 实际 ${decision} ≠ 期望 ${c.expect.decision}`);
  }
  for (const rule of c.expect.failureRules ?? []) {
    if (!gate.failures.some((f) => f.rule === rule)) {
      mismatches.push(`缺失期望的失败原因 ${rule}（实际失败：${gate.failures.map((f) => f.rule).join(",") || "无"}）`);
    }
  }
  return { id: c.id, ok: mismatches.length === 0, mismatches };
}

export interface SuiteResult {
  total: number;
  passed: number;
  failed: number;
  results: CaseResult[];
}

export function runSuite(cases: GoldenCase[]): SuiteResult {
  const results = cases.map(runCase);
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
