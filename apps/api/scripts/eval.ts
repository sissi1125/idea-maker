/**
 * pnpm eval CLI — feat-300.5
 *
 * 使用：
 *   pnpm --filter @harness/api eval -- --project=<projectId> --user=<userId>
 *                                       [--threshold-drop=0.5]
 *                                       [--ids=gold-skincare-001,gold-compete-002]
 *                                       [--tags=xiaohongshu]
 *                                       [--commit=$(git rev-parse HEAD)]
 *                                       [--branch=$(git rev-parse --abbrev-ref HEAD)]
 *
 * 退出码（CI 集成关键）：
 *   0 = eval 完成且没有触发回归阈值
 *   1 = eval 跑通但 avgOverall 相比 baseline 下降 > thresholdDrop（视为回归）
 *   2 = eval 执行异常（LLM 配置错、DB 连不上、golden 解析失败等）
 *
 * 为什么用 NestApplicationContext 而不是 createApplication：
 *   不需要起 HTTP 端口，纯调 service；启动更快、占用更少。
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "../src/app.module";
import { EvalRunnerService } from "../src/eval/eval-runner.service";

interface Args {
  projectId?: string;
  userId?: string;
  thresholdDrop?: number;
  ids?: string[];
  tags?: string[];
  commit?: string;
  branch?: string;
}

function parseArgs(): Args {
  const out: Args = {};
  for (const arg of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (!m) continue;
    const [, k, v] = m;
    switch (k) {
      case "project":
      case "projectId":
        out.projectId = v;
        break;
      case "user":
      case "userId":
        out.userId = v;
        break;
      case "threshold-drop":
        out.thresholdDrop = Number(v);
        break;
      case "ids":
        out.ids = v.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "tags":
        out.tags = v.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "commit":
        out.commit = v;
        break;
      case "branch":
        out.branch = v;
        break;
    }
  }
  return out;
}

function formatMarkdown(summary: Awaited<ReturnType<EvalRunnerService["run"]>>): string {
  const pct = summary.totalItems === 0
    ? "0%"
    : `${Math.round((summary.passedItems / summary.totalItems) * 100)}%`;
  const delta = summary.deltaVsBaseline;
  const deltaStr =
    delta === null ? "n/a（无 baseline）" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`;
  return [
    `# Eval Report`,
    ``,
    `- eval_run_id: \`${summary.evalRunId}\``,
    `- 通过率: **${summary.passedItems} / ${summary.totalItems}** (${pct})`,
    `- avg.faithfulness: ${summary.avgFaithfulness}`,
    `- avg.completeness: ${summary.avgCompleteness}`,
    `- avg.style: ${summary.avgStyle}`,
    `- avg.overall: **${summary.avgOverall}**`,
    `- delta vs baseline.avg_overall: ${deltaStr}`,
    `- shouldFailCI: **${summary.shouldFailCI ? "YES（回归）" : "no"}**`,
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  if (!args.projectId || !args.userId) {
    console.error("用法：pnpm eval -- --project=<id> --user=<id> [--threshold-drop=0.5] [--ids=...] [--tags=...] [--commit=...] [--branch=...]");
    process.exit(2);
  }

  const logger = new Logger("EvalCli");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
  try {
    const runner = app.get(EvalRunnerService);
    const summary = await runner.run({
      userId: args.userId,
      projectId: args.projectId,
      triggeredBy: "cli",
      gitCommit: args.commit ?? null,
      gitBranch: args.branch ?? null,
      thresholdDrop: args.thresholdDrop,
      filter:
        (args.ids && args.ids.length > 0) || (args.tags && args.tags.length > 0)
          ? { ids: args.ids, tags: args.tags }
          : undefined,
    });
    console.log(formatMarkdown(summary));
    await app.close();
    process.exit(summary.shouldFailCI ? 1 : 0);
  } catch (err) {
    logger.error(`eval failed: ${(err as Error).message}`);
    await app.close().catch(() => undefined);
    process.exit(2);
  }
}

main();
