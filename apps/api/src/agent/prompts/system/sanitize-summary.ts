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
 * 主入口：把 markdown 摘要清洗成自然中文 + 去重的"原文依据"附录。
 *
 * 算法：
 *   1. 收集 [evidence-NNN] 引用的所有 chunk，**按 chunk 文本内容去重**
 *      —— 同一个 chunk 被多个卖点引用时（实际 LLM 经常这样），原文只列一遍
 *   2. 剥掉正文里所有 [evidence-NNN] 标号 → 干净中文段
 *   3. 剥 markdown 句法（标题/粗斜体/列表/横线/code）
 *   4. 收拢空行
 *   5. 底部追加"原文依据：" + 去重后的 chunk 列表（[1] [2] [3]...）
 *
 * 为什么不再内联展开：
 *   之前 [evidence-001] → "（依据原文：「xxx…」）" 内联替换。问题是 4 个卖点
 *   引用同一个 evidence-001 时，500 字的 chunk 被复制 4 遍嵌进正文，prompt
 *   暴涨且 LLM 看到一大堆重复反而干扰。改成正文清爽 + 底部聚合方式。
 */
export function sanitizeSummaryForPrompt(
  raw: string | null | undefined,
  evidence: EvidenceChunk[] = [],
  options: { evidenceMaxChars?: number } = {},
): string {
  if (!raw) return "";
  const evidenceMaxChars = options.evidenceMaxChars ?? 200;

  // ── 1. 扫描所有 [evidence-NNN] 引用，按 chunk text 去重收集 ──
  // textToOrder：chunk 文本 → 在附录中的 1-based 序号；同文本只保留首次顺序
  const textToOrder = new Map<string, number>();
  const orderedChunks: string[] = [];
  for (const m of raw.matchAll(/\[evidence-(\d+)\]/gi)) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx < 0 || idx >= evidence.length) continue;
    const chunkText = evidence[idx].text.trim();
    if (!chunkText) continue;
    if (!textToOrder.has(chunkText)) {
      textToOrder.set(chunkText, orderedChunks.length + 1);
      orderedChunks.push(chunkText);
    }
  }

  // ── 2. 正文剥掉所有 [evidence-NNN] 标号（含前置空白防止留双空格） ──
  let text = raw.replace(/[ \t]*\[evidence-\d+\]/gi, "");

  // ── 3. 剥 markdown ──
  text = text
    .replace(/^\s*(---+|\*\*\*+|___+)\s*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^(\s*)[-*+]\s+/gm, "$1· ")
    .replace(/^(\s*)\d+\.\s+/gm, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // ── 4. 收拢空行 ──
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  // ── 5. 追加去重后的原文依据 ──
  if (orderedChunks.length > 0) {
    const lines = orderedChunks.map((chunkText, i) => {
      const truncated =
        chunkText.length > evidenceMaxChars
          ? chunkText.slice(0, evidenceMaxChars).trim() + "…"
          : chunkText;
      // chunk 内部可能本身就有换行；扁平成单行降低 prompt 长度
      const flat = truncated.replace(/\s+/g, " ").trim();
      return `[${i + 1}] ${flat}`;
    });
    text += `\n\n原文依据：\n${lines.join("\n")}`;
  }

  return text;
}
