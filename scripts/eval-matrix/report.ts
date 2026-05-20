import type { TestCaseResult } from "./types.js";

const COL_WIDTHS = { id: 4, label: 22, hitRate: 8, citation: 9, confidence: 10, retrieved: 9, avgScore: 8, ideas: 6, ms: 7, status: 7 };

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function fmt(v: number | null, decimals = 2): string {
  return v === null ? " n/a  " : v.toFixed(decimals);
}

function statusIcon(s: string): string {
  if (s === "success") return "✓";
  if (s === "partial") return "~";
  return "✗";
}

export function generateReport(results: TestCaseResult[]): void {
  console.log("\n" + "═".repeat(100));
  console.log("EVAL MATRIX REPORT");
  console.log("═".repeat(100));

  const header = [
    pad("ID",     COL_WIDTHS.id),
    pad("Label",  COL_WIDTHS.label),
    pad("hitRate", COL_WIDTHS.hitRate),
    pad("citation", COL_WIDTHS.citation),
    pad("confidence", COL_WIDTHS.confidence),
    pad("retrieved", COL_WIDTHS.retrieved),
    pad("avgScore", COL_WIDTHS.avgScore),
    pad("cited", COL_WIDTHS.ideas),
    pad("ms",    COL_WIDTHS.ms),
    pad("status", COL_WIDTHS.status),
  ].join(" │ ");
  console.log(header);
  console.log("─".repeat(100));

  for (const r of results) {
    const m = r.metrics;
    const row = [
      pad(r.testId,   COL_WIDTHS.id),
      pad(r.label,    COL_WIDTHS.label),
      pad(m ? fmt(m.hitRate) : "  n/a  ", COL_WIDTHS.hitRate),
      pad(m ? fmt(m.citationCoverage) : "  n/a   ", COL_WIDTHS.citation),
      pad(m ? fmt(m.confidenceScore) : "   n/a    ", COL_WIDTHS.confidence),
      pad(m ? m.retrievedCount.toFixed(1) : "  n/a   ", COL_WIDTHS.retrieved),
      pad(m ? fmt(m.avgScore) : "  n/a  ", COL_WIDTHS.avgScore),
      pad(m ? fmt(m.ideaCount, 1) : " n/a ", COL_WIDTHS.ideas),
      pad(m ? String(Math.round(m.totalDurationMs)) : " n/a ", COL_WIDTHS.ms),
      `${statusIcon(r.status)} ${r.status}`,
    ].join(" │ ");
    console.log(row);
  }

  console.log("─".repeat(100));

  // 排名摘要（仅成功的 test case）
  const successful = results.filter((r) => r.metrics !== null);
  if (successful.length === 0) {
    console.log("没有成功完成的 test case。");
    return;
  }

  console.log("\n📊 排名（按 citationCoverage 降序）：");
  const ranked = [...successful].sort((a, b) => (b.metrics!.citationCoverage ?? 0) - (a.metrics!.citationCoverage ?? 0));
  ranked.forEach((r, i) => {
    const m = r.metrics!;
    console.log(`  ${i + 1}. ${r.testId} ${r.label} — citation=${fmt(m.citationCoverage)} hitRate=${fmt(m.hitRate)} confidence=${fmt(m.confidenceScore)}`);
  });

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    console.log(`\n⚠ 失败的 test case (${failed.length}个):`);
    failed.forEach((r) => console.log(`  ${r.testId}: ${r.error ?? "未知错误"}`));
  }

  console.log("\n" + "═".repeat(100));
}
