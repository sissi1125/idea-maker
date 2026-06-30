/**
 * 清洗 auto-gen 摘要 — v1.0 优化项 follow-up
 *
 * auto_generations 的 result_notes 是 LLM 生成的 markdown，含 `##` 标题、`**加粗**`、
 * `- 列表`、以及 `[evidence-NNN]` 引用占位符。这种格式：
 *
 *   - 进 agent system prompt 后：LLM 看到嵌套 markdown 容易把语法当噪音处理，
 *     注意力分散到格式而非内容；`[evidence-NNN]` 是空占位符没语义
 *   - 给前端「查看上下文」展示时：与项目设计的自然语言风格不符
 *
 * 这里做两件事：
 *   1. 剥 markdown 句法（标题 / 粗斜体 / 列表标记 / 多余换行 / 横线分隔）
 *   2. 用 evidence 池里的真实 chunk 文本替换 [evidence-NNN]，让占位符变成可读上下文
 *
 * 不依赖任何 markdown 解析库——result_notes 是 LLM 生成、格式可预测，正则足够；
 * 引入 remark 等会把 NestJS 主包体积顶大且没必要。
 */

export interface EvidenceChunk {
  /** evidenceId 或 chunkId，本函数按下标顺序匹配 [evidence-NNN] */
  text: string;
}

/**
 * 主入口：把 markdown 摘要清洗成自然中文。
 *
 * 算法：
 *   1. 展开 [evidence-NNN]：N 是 1-based 序号，对应 evidence[N-1].text
 *      —— 与 packages/rag-core/src/retrieval/citation.ts 里
 *      `String(idx + 1).padStart(3, "0")` 的编码规则一一对齐
 *   2. 剥 markdown：
 *      - 行首 `#+ ` → 去掉，留标题文本
 *      - `**xxx**` / `__xxx__` → xxx
 *      - `*xxx*` / `_xxx_` → xxx
 *      - 行首 `- ` / `* ` / `+ ` → `· `（保留可读列表感）
 *      - 行首 `1. ` / `2. ` → 去掉编号
 *      - `---` / `***` 横线 → 删除整行
 *      - 行内 `` `code` `` → code
 *   3. 收拢多余空行（3+ 个连续 \n → 2）
 */
export function sanitizeSummaryForPrompt(
  raw: string | null | undefined,
  evidence: EvidenceChunk[] = [],
  options: { evidenceMaxChars?: number } = {},
): string {
  if (!raw) return "";
  const evidenceMaxChars = options.evidenceMaxChars ?? 200;

  // ── 1. 展开 [evidence-NNN] ──
  // 三位数字 padded，但容错也认 [evidence-1] [evidence-12] 形态
  let text = raw.replace(/\[evidence-(\d+)\]/gi, (match, numStr: string) => {
    const idx = parseInt(numStr, 10) - 1;
    if (idx < 0 || idx >= evidence.length) {
      // 找不到对应 chunk → 删除占位符，避免污染输出
      return "";
    }
    const chunkText = evidence[idx].text.trim();
    if (!chunkText) return "";
    const truncated =
      chunkText.length > evidenceMaxChars
        ? chunkText.slice(0, evidenceMaxChars).trim() + "…"
        : chunkText;
    // 用「」包住原文，与摘要正文区分；不另起段防止破坏句子流
    return `（依据原文：「${truncated}」）`;
  });

  // ── 2. 剥 markdown ──
  text = text
    // 删整行的横线分隔符
    .replace(/^\s*(---+|\*\*\*+|___+)\s*$/gm, "")
    // 行首标题：# / ## / ### → 留文本
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // 加粗 / 斜体
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
    // 行内 code
    .replace(/`([^`]+)`/g, "$1")
    // 行首列表标记：- * + → ·
    .replace(/^(\s*)[-*+]\s+/gm, "$1· ")
    // 行首数字列表：1. → 删
    .replace(/^(\s*)\d+\.\s+/gm, "$1")
    // 链接 [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // ── 3. 收拢空行 ──
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
