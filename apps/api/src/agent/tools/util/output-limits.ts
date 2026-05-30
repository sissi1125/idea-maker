/**
 * Tool 输出硬上限 — feat-300.3 任务 0.5
 *
 * 每个 tool 给 LLM 看的返回 payload 都要遵守这里的常量。**预先截断 + Spill 兜底是
 * 两层防御**（详见 docs/agent/feat-300.3-plan.md §3.7）：
 *
 *   1. 预先截断（本文件）= 源头限制，防止过度获取。tool 内部 slice / .slice(0, N)
 *      在 return 之前完成。
 *   2. Spill 落盘（feat-300.3 任务 0.6）= 路径兜底，防止 edge case 输出超阈值
 *      （如 search_web advanced 模式偶发返回长结果）。
 *
 * 数值选择原则：
 *   - chunk 文本 200 字 ≈ 50 token，3 条 ≈ 150 token，agent 4 步内 search_kb
 *     累计 ≈ 600 token，给 ContextManager 阈值（8000 token）足够余裕
 *   - web result content 300 字 ≈ 75 token，5 条 ≈ 375 token，与 search_kb 同量级
 *   - history/notes 已在 feat-300.2 截 300 字 preview，本文件不重复覆盖
 *
 * 改这些常量需要同时跑 feat-300.5 eval 验证召回质量是否下降——截太狠会让 agent
 * "看不清"导致追加调用，反而烧更多 token。
 */

/** search_kb tool：返回给 LLM 的 chunk 数量上限 */
export const SEARCH_KB_MAX_CHUNKS = 3;

/** search_kb tool：每个 chunk 文本截断字符数 */
export const SEARCH_KB_CHUNK_TEXT_CHARS = 200;

/** search_web tool：返回给 LLM 的 result 数量上限（Tavily 默认 5，这里再压一遍） */
export const SEARCH_WEB_MAX_RESULTS = 3;

/** search_web tool：每个 result.content 截断字符数 */
export const SEARCH_WEB_CONTENT_CHARS = 300;

/**
 * 安全截断字符串：保留前 N 字符 + 截断标记。
 * 截断标记让 LLM 看到"...（已截断）"知道还有内容，可以决定要不要换更深的 search。
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…（已截断）`;
}
