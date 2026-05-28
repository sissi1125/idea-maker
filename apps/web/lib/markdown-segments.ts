/**
 * markdown-segments — feat-200.7 UX 改进
 *
 * 把 LLM 输出的长 markdown 切成可独立操作的"片段"，让用户能单条保存到笔记库
 * 而不是只能整段保存。
 *
 * 切分策略（按优先级降序）：
 *   1. 标题（# / ## / ###）→ 每个标题及其后续内容算一段
 *   2. 有序列表项（^\d+\.）→ 每项算一段（"5 个卖点" 这种典型场景）
 *   3. 无序列表项（^[-*]）→ 每项算一段（如果整段都是无序列表）
 *   4. 段落（空行分隔）→ 每段算一段
 *   5. 兜底：整段一份
 *
 * 设计取舍：
 *   - 不做 AST 解析，简单 regex 足够覆盖 LLM 实际输出形态
 *   - 切完后每段都至少 20 字符——避免把孤立标题或空行算成"一段"
 *   - 标题作为段的 title（取前 30 字符）；无标题段以"片段 N"为名
 *
 * 例子（输入）：
 *   # 5 个卖点
 *   1. **强续航**：30 天待机
 *   2. **轻量化**：仅 200g
 *
 * 输出：
 *   [
 *     { title: "强续航", body: "1. **强续航**：30 天待机" },
 *     { title: "轻量化", body: "2. **轻量化**：仅 200g" },
 *   ]
 */

export interface MarkdownSegment {
  /** 短标题——供 AddToLibraryButton 的 titleSeed 用 */
  title: string;
  /** 完整 markdown 片段——保存为 note.content */
  body: string;
}

const MIN_SEGMENT_CHARS = 20;
const MAX_TITLE_CHARS = 30;

function trimTitle(raw: string): string {
  // 去掉 markdown 装饰符再截断
  const cleaned = raw
    .replace(/^#+\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[\[\]【】「」"'""]/g, "")
    .trim();
  return cleaned.slice(0, MAX_TITLE_CHARS);
}

/**
 * 把 markdown 文本切成片段。
 * 返回数组保证按原文顺序。
 */
export function splitMarkdownSegments(content: string): MarkdownSegment[] {
  const text = content.trim();
  if (!text) return [];

  // 策略 1：按标题切（# / ## / ###）
  // 用前瞻 split 保留分隔符
  const headingPattern = /^(#{1,3}\s+.*)$/gm;
  const headingMatches = [...text.matchAll(headingPattern)];
  if (headingMatches.length > 0) {
    const segments: MarkdownSegment[] = [];
    // 标题前可能有"导语"内容，单独成段
    const firstHeadingIdx = headingMatches[0].index ?? 0;
    if (firstHeadingIdx > 0) {
      const intro = text.slice(0, firstHeadingIdx).trim();
      if (intro.length >= MIN_SEGMENT_CHARS) {
        segments.push({ title: "导语", body: intro });
      }
    }
    for (let i = 0; i < headingMatches.length; i++) {
      const start = headingMatches[i].index ?? 0;
      const end = headingMatches[i + 1]?.index ?? text.length;
      const body = text.slice(start, end).trim();
      if (body.length >= MIN_SEGMENT_CHARS) {
        const titleLine = headingMatches[i][1];
        segments.push({ title: trimTitle(titleLine), body });
      }
    }
    if (segments.length > 0) return segments;
  }

  // 策略 2：按有序列表项切（^\d+\.）
  const orderedPattern = /^\d+\.\s+/gm;
  const orderedMatches = [...text.matchAll(orderedPattern)];
  if (orderedMatches.length >= 2) {
    const segments: MarkdownSegment[] = [];
    const firstIdx = orderedMatches[0].index ?? 0;
    if (firstIdx > 0) {
      const intro = text.slice(0, firstIdx).trim();
      if (intro.length >= MIN_SEGMENT_CHARS) {
        segments.push({ title: "导语", body: intro });
      }
    }
    for (let i = 0; i < orderedMatches.length; i++) {
      const start = orderedMatches[i].index ?? 0;
      const end = orderedMatches[i + 1]?.index ?? text.length;
      const body = text.slice(start, end).trim();
      if (body.length >= MIN_SEGMENT_CHARS) {
        // 取第一行做标题（去掉 "1. " 前缀）
        const firstLine = body.split("\n", 1)[0];
        segments.push({ title: trimTitle(firstLine), body });
      }
    }
    if (segments.length > 0) return segments;
  }

  // 策略 3：按无序列表项切（^[-*] ）——仅当至少 3 项时才切（2 项可能是普通段落）
  const bulletPattern = /^[-*]\s+/gm;
  const bulletMatches = [...text.matchAll(bulletPattern)];
  if (bulletMatches.length >= 3) {
    const segments: MarkdownSegment[] = [];
    for (let i = 0; i < bulletMatches.length; i++) {
      const start = bulletMatches[i].index ?? 0;
      const end = bulletMatches[i + 1]?.index ?? text.length;
      const body = text.slice(start, end).trim();
      if (body.length >= MIN_SEGMENT_CHARS) {
        const firstLine = body.split("\n", 1)[0];
        segments.push({ title: trimTitle(firstLine), body });
      }
    }
    if (segments.length > 0) return segments;
  }

  // 策略 4：按空行（双换行）切段
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2) {
    return paragraphs
      .filter((p) => p.length >= MIN_SEGMENT_CHARS)
      .map((p, i) => ({
        title: trimTitle(p.split("\n", 1)[0]) || `片段 ${i + 1}`,
        body: p,
      }));
  }

  // 兜底：整段一份
  return [{ title: trimTitle(text.split("\n", 1)[0]) || "笔记", body: text }];
}
