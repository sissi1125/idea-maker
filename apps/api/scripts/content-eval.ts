/**
 * pnpm eval:content CLI — feat-400.2
 *
 * 跑内容评测离线回归（开发集 + 保留集）。纯函数，不连库、不调 LLM，秒级完成。
 *
 * 退出码（CI 集成）：
 *   0 = 全过
 *   1 = 有用例与期望不符（视为回归）
 *   2 = 执行异常
 *
 * 用法：pnpm --filter @harness/api eval:content
 *       pnpm --filter @harness/api eval:content -- --holdout-only
 */

import { runSuite, type SuiteResult } from "../src/content-evaluation/golden-runner";
import { DEV_SET } from "../src/content-evaluation/golden/dev-set";
import { HOLDOUT_SET } from "../src/content-evaluation/golden/holdout-set";

function printSuite(name: string, r: SuiteResult): void {
  console.log(`\n【${name}】 ${r.passed}/${r.total} 通过`);
  for (const c of r.results) {
    if (c.ok) console.log(`  ✓ ${c.id}`);
    else console.log(`  ✗ ${c.id}\n      ${c.mismatches.join("\n      ")}`);
  }
}

function main(): number {
  const holdoutOnly = process.argv.includes("--holdout-only");
  try {
    const suites: Array<[string, SuiteResult]> = [];
    if (!holdoutOnly) suites.push(["开发集", runSuite(DEV_SET)]);
    suites.push(["保留集", runSuite(HOLDOUT_SET)]);

    let failed = 0;
    for (const [name, r] of suites) {
      printSuite(name, r);
      failed += r.failed;
    }
    console.log(`\n合计失败 ${failed} 条`);
    return failed === 0 ? 0 : 1;
  } catch (err) {
    console.error("执行异常：", err instanceof Error ? err.message : err);
    return 2;
  }
}

process.exit(main());
