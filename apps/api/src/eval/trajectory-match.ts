/**
 * Trajectory Match — feat-300.5
 *
 * 给定「期望工具集合」和「实际工具调用序列」，输出 precision / recall / jaccard
 * 三个相似度指标，并判断「期望集合是否被实际全覆盖」。
 *
 * 设计抉择：
 *   1. **集合相似度而非有序序列相似度**：
 *      ReAct agent 可能先 search_history 再 search_kb，或者反过来，结果可能等价。
 *      硬要求顺序一致会让大量正确路径误判失败。
 *      未来如果想检测「先 search 再 generate」这种弱约束，再加一个独立的
 *      order-pattern 检测函数即可。
 *
 *   2. **去重后比对**：
 *      agent 可能多次 search_kb（query 改写），算 1 次。
 *      goldenItem.expectedTools 即使含重复也视为 set 处理。
 *
 *   3. **expectedTools 为空 → 始终全分**：
 *      golden 不关心路径只看输出文本时，trajectory 不应拉低 passed 判定。
 *      precision=1 / recall=1 / jaccard=1 / fullCover=true。
 *
 *   4. **fullCover 比 jaccard 严格**：
 *      jaccard=0.6 可能意味着「期望 3 个，实际命中 2 个 + 多调 1 个无关的」。
 *      fullCover 单独标记「期望的都做到了，无遗漏」，用于更严格的通过门。
 *
 * 与 LLM-as-judge 的分工：
 *   judge 关心「输出对不对」，trajectory 关心「过程合不合理」。两条独立信号，
 *   避免 agent 走了对的路径但输出乱七八糟拿高分，反之亦然。
 */

import type { TrajectoryMatch } from "./eval.types";

export function trajectoryMatch(
  expected: readonly string[],
  actual: readonly string[],
): TrajectoryMatch {
  const expSet = new Set(expected);
  const actSet = new Set(actual);

  // 期望为空 → 不关心路径，给满分
  if (expSet.size === 0) {
    return {
      expected: [],
      actual: Array.from(actSet),
      precision: 1,
      recall: 1,
      jaccard: 1,
      fullCover: true,
    };
  }

  let intersect = 0;
  for (const x of actSet) if (expSet.has(x)) intersect++;
  // 并集大小 = |A| + |B| - |A∩B|
  const unionSize = expSet.size + actSet.size - intersect;

  // 实际为空（agent 没调任何 tool）：precision 约定为 0（无法判断），
  // recall 仍按 expSet 算（缺得越多越低），jaccard = 0 / unionSize。
  const precision = actSet.size === 0 ? 0 : intersect / actSet.size;
  const recall = intersect / expSet.size;
  const jaccard = unionSize === 0 ? 1 : intersect / unionSize;

  // 全覆盖：期望集 ⊆ 实际集
  let fullCover = true;
  for (const x of expSet) {
    if (!actSet.has(x)) {
      fullCover = false;
      break;
    }
  }

  return {
    expected: Array.from(expSet),
    actual: Array.from(actSet),
    precision: round3(precision),
    recall: round3(recall),
    jaccard: round3(jaccard),
    fullCover,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
