/**
 * Golden 集加载器 — feat-300.5
 *
 * 从 apps/api/src/eval/golden/*.json 同步读所有测试集条目。
 *
 * 为什么是同步 fs 调用：
 *   - 加载发生在 eval 启动时一次性，不在请求路径
 *   - golden 数量 < 100 条，文件 < 100KB，sync 读 < 5ms
 *   - 避免给 EvalRunner 增加额外 async 层
 *
 * 为什么不用 import.meta.glob / require.context：
 *   ts-node + nest build + vitest 三个运行环境对 glob 支持不一，fs.readdirSync 最稳。
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { GoldenItem } from "./eval.types";

/** golden 目录默认位置（编译/源码两种环境都能定位） */
export const DEFAULT_GOLDEN_DIR = join(__dirname, "golden");

/**
 * 加载目录下所有 .json，按 id 排序。
 *
 * 防御：
 *   - 跳过非 .json 文件（README 等）
 *   - 单个文件解析失败抛错（带文件名），不要默默吞 → 测试集错误必须立即可见
 *   - id 重复抛错（同 id 两个文件会让回归对比错乱）
 */
export function loadGoldenSet(dir: string = DEFAULT_GOLDEN_DIR): GoldenItem[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const items: GoldenItem[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const path = join(dir, file);
    let parsed: GoldenItem;
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8")) as GoldenItem;
    } catch (err) {
      throw new Error(`[golden] 解析 ${file} 失败：${(err as Error).message}`);
    }
    if (!parsed.id || typeof parsed.query !== "string" || !parsed.referenceAnswer) {
      throw new Error(`[golden] ${file} 字段缺失（id/query/referenceAnswer 必填）`);
    }
    if (seenIds.has(parsed.id)) {
      throw new Error(`[golden] id 冲突：${parsed.id} 在多个文件中出现`);
    }
    seenIds.add(parsed.id);
    items.push(parsed);
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}
