/**
 * Chunk Transform - 纯算法
 *
 * 3 种 method：
 *   none              透传
 *   heading-context   注入 documentTitle / sourceRef 标题路径前缀
 *                     embedding 同时编码"这段属于哪个章节"，提升检索召回
 *   summary-keywords  jieba TF 提关键词 + 句子截取摘要，拼到 chunk 末尾
 *                     纯本地，不调 LLM；feat-004 系列可加 llm-summary 增强
 *
 * 设计：纯函数，无 I/O，无 framework。
 */

import type {
  TransformInput,
  TransformInputChunk,
  TransformOutput,
  TransformResult,
  TransformedChunk,
} from "@harness/shared-types";
import { extractKeywords as nlpExtractKeywords } from "../util/nlp";

// ─── none ─────────────────────────────────────────────────────────────────────

function transformNone(chunks: TransformInputChunk[]): TransformOutput {
  return {
    chunks: chunks.map<TransformedChunk>((c) => ({
      ...c,
      enhancedText: c.text,
      injectedPrefix: "",
      keywords: [],
      summary: "",
      enhancedTokenEstimate: c.tokenEstimate,
    })),
    chunkCount: chunks.length,
    method: "none",
    transformedCount: 0,
    warnings: [],
  };
}

// ─── heading-context ──────────────────────────────────────────────────────────

/**
 * 注入格式：
 *   "[documentTitle]\n[sourceRef 路径]\n\n[原始 chunk 文本]"
 *
 * 为什么有效：
 *   Dense vector 检索时，query "核心功能" 和 chunk "支持 PDF 上传" 余弦相似度低。
 *   注入前缀后 chunk 同时编码章节语义，与 query 相似度显著提升。
 */
function transformHeadingContext(
  chunks: TransformInputChunk[],
  params: { includeTitle: boolean; includeHeadingPath: boolean; documentTitle: string },
): TransformOutput {
  const warnings: string[] = [];
  let transformedCount = 0;

  const transformed = chunks.map<TransformedChunk>((c) => {
    const parts: string[] = [];

    if (params.includeTitle && params.documentTitle) {
      parts.push(params.documentTitle);
    }
    if (params.includeHeadingPath && c.sourceRef) {
      // 避免文档标题和 sourceRef 重复（sourceRef 通常已含顶层标题）
      if (!params.includeTitle || c.sourceRef !== params.documentTitle) {
        parts.push(c.sourceRef);
      }
    }

    const prefix = parts.join("\n");
    const enhancedText = prefix ? `${prefix}\n\n${c.text}` : c.text;

    if (prefix) transformedCount++;

    return {
      ...c,
      enhancedText,
      injectedPrefix: prefix,
      keywords: [],
      summary: "",
      enhancedTokenEstimate: Math.ceil(enhancedText.length / 4),
    };
  });

  if (transformedCount === 0) {
    warnings.push(
      "所有 chunk 的 sourceRef 均为空，heading-context 未注入任何内容。建议先用 markdown-structure 预处理。",
    );
  }

  return {
    chunks: transformed,
    chunkCount: chunks.length,
    method: "heading-context",
    transformedCount,
    warnings,
  };
}

// ─── summary-keywords ─────────────────────────────────────────────────────────

/**
 * 简单摘要：取前 N 句，截断到 maxChars。
 * 规则摘要不理解语义，只保证结构完整性。
 * LLM 摘要效果更好但需 API Key 和延迟，留给后续 llm-summary 扩展。
 */
function extractSummary(text: string, maxChars: number): string {
  const sentences = text
    .split(/(?<=[。！？.!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  let summary = "";
  for (const s of sentences) {
    if ((summary + s).length > maxChars) break;
    summary += (summary ? " " : "") + s;
  }
  return summary || text.slice(0, maxChars);
}

function transformSummaryKeywords(
  chunks: TransformInputChunk[],
  params: { keywordCount: number; summaryMaxChars: number; appendToChunk: boolean },
): TransformOutput {
  const warnings: string[] = [];
  let transformedCount = 0;

  const transformed = chunks.map<TransformedChunk>((c) => {
    const keywords = nlpExtractKeywords(c.text, params.keywordCount);
    const summary = extractSummary(c.text, params.summaryMaxChars);

    const suffix = params.appendToChunk
      ? `\n\n关键词: ${keywords.join(", ")}\n摘要: ${summary}`
      : "";
    const enhancedText = c.text + suffix;

    if (keywords.length > 0 || summary) transformedCount++;

    return {
      ...c,
      enhancedText,
      injectedPrefix: "",
      keywords,
      summary,
      enhancedTokenEstimate: Math.ceil(enhancedText.length / 4),
    };
  });

  if (transformedCount === 0) {
    warnings.push("所有 chunk 的关键词和摘要均为空（文本过短或全为停用词）。");
  }

  return {
    chunks: transformed,
    chunkCount: chunks.length,
    method: "summary-keywords",
    transformedCount,
    warnings,
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export function runTransform(input: TransformInput): TransformResult {
  const { methodId, params, upstreamChunks } = input;

  let output: TransformOutput;

  switch (methodId) {
    case "heading-context":
      output = transformHeadingContext(upstreamChunks, {
        includeTitle: params.includeTitle,
        includeHeadingPath: params.includeHeadingPath,
        documentTitle: params.documentTitle,
      });
      break;

    case "summary-keywords":
      output = transformSummaryKeywords(upstreamChunks, {
        keywordCount: Math.max(1, params.keywordCount),
        // summaryMaxTokens × 4 ≈ summaryMaxChars（GPT 经验比例，中文略偏小）
        summaryMaxChars: Math.max(20, params.summaryMaxTokens * 4),
        appendToChunk: params.appendToChunk,
      });
      break;

    case "none":
    default:
      output = transformNone(upstreamChunks);
      break;
  }

  return {
    output,
    trace: {
      method: methodId,
      inputChunkCount: upstreamChunks.length,
      transformedCount: output.transformedCount,
      avgEnhancedTokens: output.chunks.length
        ? Math.round(
            output.chunks.reduce((s, c) => s + c.enhancedTokenEstimate, 0) / output.chunks.length,
          )
        : 0,
    },
    warnings: output.warnings,
  };
}
