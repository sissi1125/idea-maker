/**
 * RAG Pipeline Stage 3 - 文档分块 (Chunk) - 纯算法
 *
 * 4 种 method：
 *   fixed-size                  滑动窗口，简单快但不感知语义边界
 *   recursive                   LangChain RecursiveCharacterTextSplitter
 *                               分隔符递归优先级：段落 > 换行 > 中文句终 > 空格 > 字符
 *   markdown-heading            按 # 边界切分；超长降级 fixed-size（硬截断）
 *   markdown-heading-recursive  层级切分：标题边界 + 长章节用 recursive（保语义）
 *
 * 为什么分块重要：
 *   embedding 模型有输入限制（通常 512 token）；粒度直接影响召回率：
 *   太大 → chunk 含多话题，相似度被稀释；
 *   太小 → 缺上下文，embedding 不准，存储/检索开销大。
 *
 * token 估算：chars/4 近似；中英混合自动调整为 chars/2 ~ chars/1.5。
 * （feat-009 后续可换 tiktoken）
 */

import type {
  Chunk,
  ChunkInput,
  ChunkOutput,
  ChunkResult,
  ChunkSourceRef,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 根据 charStart 找 cleanText 中该位置的 sourceRef path。
 * sourceRefs 有序，找覆盖该位置的最近前缀 ref。
 */
function findSourceRef(charStart: number, sourceRefs: ChunkSourceRef[]): string {
  let best = "";
  for (const ref of sourceRefs) {
    if (ref.charStart <= charStart) best = ref.value;
    else break;
  }
  return best;
}

/**
 * 近似 token 估算。中英混合场景：
 *   纯英文 ~4 chars/token，纯中文 1-2 chars/token（cl100k_base）
 *   检测中文占比自动选 divisor。
 *   最终方案：用 tiktoken 替换（feat-009 待办）
 */
function estimateTokens(text: string): number {
  const zhChars = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length;
  const zhRatio = zhChars / Math.max(text.length, 1);
  const divisor = zhRatio > 0.5 ? 1.5 : 3;
  return Math.ceil(text.length / divisor);
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

function chunkFixedSize(
  text: string,
  sourceRefs: ChunkSourceRef[],
  params: { chunkSize: number; overlap: number },
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
 * 递归语义切分（LangChain RecursiveCharacterTextSplitter 移植）。
 *
 * 思路：给定优先级递减的分隔符列表，先用最高级切分；
 *      仍 > chunkSize 的段落继续用下一级递归切分；
 *      最终兜底为字符级硬切。
 *
 * 默认分隔符（中文优先版）：
 *   ["\n\n", "\n", "。", "！", "？", "；", " ", ""]
 *   段落 > 换行 > 中文句终 > 空格 > 字符
 */
function chunkRecursive(
  text: string,
  sourceRefs: ChunkSourceRef[],
  params: { chunkSize: number; overlap: number; separators: string[]; minChunkSize: number },
): ChunkOutput {
  const warnings: string[] = [];
  const { chunkSize, overlap, minChunkSize } = params;
  let separators = params.separators;
  if (!Array.isArray(separators) || separators.length === 0) {
    separators = ["\n\n", "\n", "。", "！", "？", "；", " ", ""];
    warnings.push("separators 为空，使用默认值 [段落, 换行, 中文句终标点, 空格, 字符]");
  }

  // JSON 转义还原（来自前端时可能是 "\\n" 字面量）
  separators = separators.map((s) => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t"));

  function splitText(sub: string, seps: string[], offset: number): Array<[number, number]> {
    if (sub.length <= chunkSize) {
      if (sub.trim().length < minChunkSize) return [];
      return [[offset, offset + sub.length]];
    }

    const sep = seps[0];
    const nextSeps = seps.slice(1);

    let parts: string[];
    if (sep === "") {
      parts = [];
      for (let i = 0; i < sub.length; i += chunkSize) {
        parts.push(sub.slice(i, i + chunkSize));
      }
    } else {
      parts = sub.split(sep);
    }

    // 合并小碎片
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

  // overlap：每个 chunk 起点向前延伸 overlap 字符
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

function chunkMarkdownHeading(
  text: string,
  sourceRefs: ChunkSourceRef[],
  params: { headingDepth: number; chunkSize: number; overlap: number },
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
      warnings.push(
        `章节（起始位置 ${start}）超过 maxChunkSize(${chunkSize})，降级为 fixed-size 切分`,
      );
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

// ─── markdown-heading-recursive（层级切分）────────────────────────────────────

/**
 * 与 markdown-heading 区别：长章节用 recursive 语义切分而非 fixed-size 硬截断。
 * 业界对应：LangChain MarkdownHeader + RecursiveCharacterTextSplitter 组合。
 */
function chunkMarkdownHeadingRecursive(
  text: string,
  sourceRefs: ChunkSourceRef[],
  params: {
    headingDepth: number;
    chunkSize: number;
    overlap: number;
    separators: string[];
    minChunkSize: number;
  },
): ChunkOutput {
  const { headingDepth, chunkSize, overlap, separators, minChunkSize } = params;
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
    charCursor += line.length + 1;
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
      warnings.push(
        `章节（起始位置 ${start}）超过 chunkSize(${chunkSize})，降级为 recursive 语义切分`,
      );
      const sub = chunkRecursive(sectionText, sourceRefs, {
        chunkSize,
        overlap,
        separators,
        minChunkSize,
      });
      for (const c of sub.chunks) {
        chunks.push({
          ...c,
          index: chunkIndex++,
          charStart: start + c.charStart,
          charEnd: start + c.charEnd,
          sourceRef: findSourceRef(start + c.charStart, sourceRefs),
        });
      }
      warnings.push(...sub.warnings);
    }
  }

  return buildStats(chunks, warnings);
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

const DEFAULT_SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", " ", ""];

export function runChunk(input: ChunkInput): ChunkResult {
  const { methodId, params, upstream } = input;
  const { cleanText, sourceRefs, fileName } = upstream;

  if (!cleanText.trim()) {
    throw new PipelineError("empty_text", "预处理输出的 cleanText 为空，无法分块");
  }

  // 规范化参数（前端可能传任意 number / undefined）
  const chunkSize = Math.max(64, params.chunkSize);
  const overlap = Math.max(0, params.overlap);
  const minChunkSize = Math.max(0, params.minChunkSize);
  const headingDepth = Math.min(6, Math.max(1, params.headingDepth));
  const separators = params.separators ?? DEFAULT_SEPARATORS;

  let output: ChunkOutput;

  switch (methodId) {
    case "fixed-size":
      output = chunkFixedSize(cleanText, sourceRefs, { chunkSize, overlap });
      break;

    case "markdown-heading":
      output = chunkMarkdownHeading(cleanText, sourceRefs, { headingDepth, chunkSize, overlap });
      break;

    case "markdown-heading-recursive":
      output = chunkMarkdownHeadingRecursive(cleanText, sourceRefs, {
        headingDepth,
        chunkSize,
        overlap,
        separators,
        minChunkSize,
      });
      break;

    case "recursive":
    default:
      output = chunkRecursive(cleanText, sourceRefs, {
        chunkSize,
        overlap,
        separators,
        minChunkSize,
      });
      break;
  }

  return {
    output,
    trace: {
      method: methodId,
      inputChars: cleanText.length,
      chunkCount: output.chunkCount,
      avgChunkSize: output.avgChunkSize,
      maxChunkSize: output.maxChunkSize,
      minChunkSize: output.minChunkSize,
      params: { chunkSize, overlap, headingDepth, minChunkSize },
      sourceFile: fileName,
    },
    warnings: output.warnings,
  };
}
