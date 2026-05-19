/**
 * RAG Pipeline Stage 3 - 文档分块 (Chunk)
 *
 * 作用：把 preprocess 输出的 cleanText 切分为独立的检索单元（chunks）。
 *
 * Pipeline 位置：
 *   预处理 → [分块] → 向量化 → 存储
 *
 * 三种方法：
 *
 *   fixed-size        按固定字符数切分，支持 overlap（滑动窗口）
 *                     最简单、速度最快，适合结构均匀的文本
 *
 *   recursive         优先按语义分隔符（段落→换行→空格→字符）切分，
 *                     避免在句中断开，比 fixed-size 更接近语义边界。
 *                     是 LangChain RecursiveCharacterTextSplitter 的思路。
 *
 *   markdown-heading  按 Markdown 标题（#/##/###）边界切分，
 *                     保持每个章节完整，适合结构化文档（产品文档、Wiki）。
 *
 * 为什么分块很重要？
 *   向量模型有输入长度限制（通常 512 token）；分块粒度直接影响检索召回率：
 *   太大 → 一个 chunk 包含多个话题，相似度被稀释；
 *   太小 → 缺少上下文，embedding 不准确，也增加存储和检索开销。
 *
 * token 估算：采用 chars/4 近似，适合英文/中文混合文本。
 */

import { NextRequest, NextResponse } from "next/server";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface SourceRef {
  type: "heading" | "paragraph" | "page";
  value: string;
  charStart: number;
  charEnd: number;
}

interface PreprocessOutput {
  cleanText: string;
  sourceRefs: SourceRef[];
  metadata: {
    fileName: string;
    mimeType: string;
    headings?: string[];
  };
  warnings: string[];
}

export interface Chunk {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  charCount: number;
  /** chars/4 近似 token 数；实际值取决于具体 tokenizer */
  tokenEstimate: number;
  /** 该 chunk 命中的 sourceRef 路径（如"产品介绍 > 核心功能"） */
  sourceRef: string;
}

interface ChunkOutput {
  chunks: Chunk[];
  chunkCount: number;
  totalChars: number;
  avgChunkSize: number;
  maxChunkSize: number;
  minChunkSize: number;
  warnings: string[];
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 根据 charStart 找到 cleanText 中对应位置的 sourceRef 路径。
 * sourceRefs 是有序的，找覆盖该位置的第一个区间即可。
 */
function findSourceRef(charStart: number, sourceRefs: SourceRef[]): string {
  // 从后向前找最近覆盖或在其之前的 ref（chunk 可能跨越多个 ref，取最近的一个）
  let best = "";
  for (const ref of sourceRefs) {
    if (ref.charStart <= charStart) best = ref.value;
    else break;
  }
  return best;
}

/** 近似 token 估算（chars / 4），对中英文混合文本误差在 ±20% 以内 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildStats(chunks: Chunk[], warnings: string[]): ChunkOutput {
  const sizes = chunks.map((c) => c.charCount);
  return {
    chunks,
    chunkCount: chunks.length,
    totalChars: sizes.reduce((a, b) => a + b, 0),
    avgChunkSize: chunks.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / chunks.length) : 0,
    maxChunkSize: chunks.length ? Math.max(...sizes) : 0,
    minChunkSize: chunks.length ? Math.min(...sizes) : 0,
    warnings,
  };
}

// ─── fixed-size ───────────────────────────────────────────────────────────────

/**
 * 固定大小滑动窗口切分。
 *
 * 实现原理：
 *   从 pos=0 开始，每次取 [pos, pos+chunkSize) 子串；
 *   下次起点为 pos + chunkSize - overlap（overlap 保留上下文）。
 *
 * 适用场景：结构均匀、无明显标题的纯文本（日志、报告正文）。
 */
function chunkFixedSize(
  text: string,
  sourceRefs: SourceRef[],
  params: { chunkSize: number; overlap: number }
): ChunkOutput {
  const { chunkSize, overlap } = params;
  const warnings: string[] = [];
  if (overlap >= chunkSize) {
    warnings.push(`overlap(${overlap}) ≥ chunkSize(${chunkSize})，已强制设为 chunkSize/4`);
  }
  const safeOverlap = Math.min(overlap, Math.floor(chunkSize / 4));
  const step = chunkSize - safeOverlap;

  const chunks: Chunk[] = [];
  let pos = 0;
  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length);
    const chunkText = text.slice(pos, end);
    chunks.push({
      index: chunks.length,
      text: chunkText,
      charStart: pos,
      charEnd: end,
      charCount: chunkText.length,
      tokenEstimate: estimateTokens(chunkText),
      sourceRef: findSourceRef(pos, sourceRefs),
    });
    if (end === text.length) break;
    pos += step;
  }
  return buildStats(chunks, warnings);
}

// ─── recursive ────────────────────────────────────────────────────────────────

/**
 * 递归语义切分（对标 LangChain RecursiveCharacterTextSplitter）。
 *
 * 核心思路：
 *   给定一组分隔符（优先级从高到低），找到当前 text 中第一个出现的高优先级分隔符，
 *   以它为边界切分；如果某段仍然 > chunkSize，继续用下一级分隔符递归切分。
 *
 * 默认分隔符顺序：["\n\n", "\n", " ", ""]（段落 → 换行 → 词 → 字符）。
 * 这样能尽量在语义边界（段落、句子）处断开，而非在词中间。
 *
 * overlap 通过在相邻 chunk 之间保留末尾片段实现。
 */
function chunkRecursive(
  text: string,
  sourceRefs: SourceRef[],
  params: { chunkSize: number; overlap: number; separators: string[]; minChunkSize: number }
): ChunkOutput {
  const warnings: string[] = [];
  const { chunkSize, overlap, minChunkSize } = params;
  // 支持 JSON array 或逗号分隔字符串两种来源
  let separators = params.separators;
  if (!Array.isArray(separators) || separators.length === 0) {
    separators = ["\n\n", "\n", " ", ""];
    warnings.push("separators 为空，使用默认值 [段落, 换行, 空格, 字符]");
  }

  // 将 JSON 转义的 \\n 还原为真实换行符
  separators = separators.map((s) => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t"));

  /**
   * 递归切分辅助函数，返回所有叶子 (charStart 相对于原始 text) 的 [start, end] 对。
   */
  function splitText(sub: string, seps: string[], offset: number): Array<[number, number]> {
    if (sub.length <= chunkSize) {
      if (sub.trim().length < minChunkSize) return [];
      return [[offset, offset + sub.length]];
    }

    // 找出使用当前分隔符切分的结果
    const sep = seps[0];
    const nextSeps = seps.slice(1);

    let parts: string[];
    if (sep === "") {
      // 最后兜底：按字符切分
      parts = [];
      for (let i = 0; i < sub.length; i += chunkSize) {
        parts.push(sub.slice(i, i + chunkSize));
      }
    } else {
      parts = sub.split(sep);
    }

    // 合并过小的碎片
    const merged: Array<[string, number]> = [];
    let buf = "";
    let bufOffset = offset;
    for (const part of parts) {
      const candidate = buf ? buf + sep + part : part;
      if (candidate.length <= chunkSize) {
        if (!buf) bufOffset = offset + sub.indexOf(part);
        buf = candidate;
      } else {
        if (buf) merged.push([buf, bufOffset]);
        buf = part;
        bufOffset = offset + sub.indexOf(part, bufOffset - offset);
      }
    }
    if (buf) merged.push([buf, bufOffset]);

    // 对仍然过大的段落递归
    const result: Array<[number, number]> = [];
    for (const [m, mOffset] of merged) {
      if (m.length > chunkSize && nextSeps.length > 0) {
        result.push(...splitText(m, nextSeps, mOffset));
      } else if (m.trim().length >= minChunkSize) {
        result.push([mOffset, mOffset + m.length]);
      }
    }
    return result;
  }

  const spans = splitText(text, separators, 0);

  // 添加 overlap：每个 chunk 的起点向前延伸 overlap 字符
  const chunks: Chunk[] = spans.map(([start, end], i) => {
    const overlapStart = i > 0 ? Math.max(0, start - overlap) : start;
    const chunkText = text.slice(overlapStart, end);
    return {
      index: i,
      text: chunkText,
      charStart: overlapStart,
      charEnd: end,
      charCount: chunkText.length,
      tokenEstimate: estimateTokens(chunkText),
      sourceRef: findSourceRef(start, sourceRefs),
    };
  });

  return buildStats(chunks, warnings);
}

// ─── markdown-heading ─────────────────────────────────────────────────────────

/**
 * 按 Markdown 标题边界切分，每个章节作为一个 chunk。
 *
 * 实现原理：
 *   扫描 cleanText，遇到 headingDepth 以内的标题（# / ## / ###...）就开始新 chunk。
 *   如果某章节超过 maxChunkSize，递归调用 fixed-size 切分。
 *
 * 最适合：产品文档、Wiki、README 等有明确章节结构的 Markdown 文档。
 *   例如：一个 ## 功能介绍 章节 → 一个 chunk，embedding 代表该章节的语义。
 */
function chunkMarkdownHeading(
  text: string,
  sourceRefs: SourceRef[],
  params: { headingDepth: number; chunkSize: number; overlap: number }
): ChunkOutput {
  const { headingDepth, chunkSize, overlap } = params;
  const warnings: string[] = [];
  const lines = text.split("\n");

  const sections: Array<{ start: number; end: number }> = [];
  let sectionStart = 0;
  let charCursor = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+/);
    if (headingMatch && headingMatch[1].length <= headingDepth && i > 0) {
      sections.push({ start: sectionStart, end: charCursor });
      sectionStart = charCursor;
    }
    charCursor += line.length + 1; // +1 for "\n"
  }
  sections.push({ start: sectionStart, end: text.length });

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const { start, end } of sections) {
    const sectionText = text.slice(start, end).trimEnd();
    if (!sectionText.trim()) continue;

    if (sectionText.length <= chunkSize) {
      chunks.push({
        index: chunkIndex++,
        text: sectionText,
        charStart: start,
        charEnd: start + sectionText.length,
        charCount: sectionText.length,
        tokenEstimate: estimateTokens(sectionText),
        sourceRef: findSourceRef(start, sourceRefs),
      });
    } else {
      // 章节过长：降级为 fixed-size 切分
      warnings.push(`章节（起始位置 ${start}）超过 maxChunkSize(${chunkSize})，降级为 fixed-size 切分`);
      const sub = chunkFixedSize(sectionText, sourceRefs, { chunkSize, overlap });
      for (const c of sub.chunks) {
        chunks.push({
          ...c,
          index: chunkIndex++,
          charStart: start + c.charStart,
          charEnd: start + c.charEnd,
          sourceRef: findSourceRef(start + c.charStart, sourceRefs),
        });
      }
    }
  }

  return buildStats(chunks, warnings);
}

// ─── API Route ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { methodId, params, upstreamOutput } = body as {
      methodId: string;
      params: Record<string, unknown>;
      upstreamOutput: PreprocessOutput | null;
    };

    if (!upstreamOutput?.cleanText) {
      return NextResponse.json(
        { error: { code: "missing_upstream", message: "未找到预处理输出，请先运行预处理 Stage" } },
        { status: 400 }
      );
    }

    const { cleanText, sourceRefs = [], metadata } = upstreamOutput;
    const chunkSize = Math.max(64, Number(params?.chunkSize ?? 512));
    const overlap = Math.max(0, Number(params?.overlap ?? 64));
    const minChunkSize = Math.max(0, Number(params?.minChunkSize ?? 0));
    const headingDepth = Math.min(6, Math.max(1, Number(params?.headingDepth ?? 2)));

    let result: ChunkOutput;
    const warnings: string[] = [];

    if (!cleanText.trim()) {
      return NextResponse.json(
        { error: { code: "empty_text", message: "预处理输出的 cleanText 为空，无法分块" } },
        { status: 400 }
      );
    }

    switch (methodId) {
      case "fixed-size":
        result = chunkFixedSize(cleanText, sourceRefs, { chunkSize, overlap });
        break;

      case "markdown-heading":
        result = chunkMarkdownHeading(cleanText, sourceRefs, { headingDepth, chunkSize, overlap });
        break;

      default: // recursive
        result = chunkRecursive(cleanText, sourceRefs, {
          chunkSize,
          overlap,
          separators: (params?.separators as string[]) ?? ["\n\n", "\n", " ", ""],
          minChunkSize,
        });
        break;
    }

    // 附加来源文档信息到 warnings（便于 Playground 展示）
    if (warnings.length > 0) result.warnings.push(...warnings);

    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      output: result,
      trace: {
        method: methodId,
        inputChars: cleanText.length,
        chunkCount: result.chunkCount,
        avgChunkSize: result.avgChunkSize,
        maxChunkSize: result.maxChunkSize,
        minChunkSize: result.minChunkSize,
        params: { chunkSize, overlap, headingDepth, minChunkSize },
        sourceFile: metadata?.fileName ?? "",
        durationMs,
      },
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "internal_error", message: String(err) } },
      { status: 500 }
    );
  }
}
