/**
 * RAG Pipeline Stage 4 - Chunk 增强 (Transform)
 *
 * 作用：对 chunk 阶段输出的每个 chunk 进行元数据注入或内容增强，
 *       让 embedding 能捕获更多上下文语义，提升检索召回率。
 *
 * Pipeline 位置：
 *   分块 → [Transform] → 向量化 → 存储
 *
 * 三种方法：
 *
 *   none              直接透传，不修改任何 chunk 内容
 *
 *   heading-context   在每个 chunk 前缀注入文档标题和/或 sourceRef 标题路径。
 *                     例：原文 "支持多格式上传" → "产品介绍 > 核心功能\n支持多格式上传"
 *                     好处：embedding 向量同时编码了"这段话属于哪个章节"，
 *                     检索 "核心功能有哪些" 时能命中正确 chunk。
 *
 *   summary-keywords  用规则（词频 TF + 停用词过滤）提取关键词，
 *                     用句子截取生成摘要，拼接到 chunk 末尾。
 *                     不调用 LLM，纯本地计算，适合离线批量处理。
 *                     LLM 版本留给后续 feat-004 系列扩展。
 *
 * 为什么要 Transform？
 *   原始 chunk 只包含正文片段，缺少章节上下文。
 *   embedding 模型（尤其是短文本模型）对孤立片段的编码质量较差。
 *   注入标题路径相当于给 chunk 打"坐标"，让检索器更容易找到它。
 */

import { NextRequest, NextResponse } from "next/server";
import { extractKeywords as nlpExtractKeywords } from "@/lib/nlp";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface InputChunk {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  charCount: number;
  tokenEstimate: number;
  sourceRef: string;
}

interface ChunkOutput {
  chunks: InputChunk[];
  chunkCount: number;
  warnings: string[];
}

export interface TransformedChunk extends InputChunk {
  /** 增强后的文本，供 embedding 使用（不替换原始 text） */
  enhancedText: string;
  /** 本次 transform 注入的前缀内容 */
  injectedPrefix: string;
  /** 关键词列表（summary-keywords 方法） */
  keywords: string[];
  /** 摘要（summary-keywords 方法） */
  summary: string;
  /** 增强后的 token 估算 */
  enhancedTokenEstimate: number;
}

interface TransformOutput {
  chunks: TransformedChunk[];
  chunkCount: number;
  method: string;
  /** 有多少 chunk 实际被注入了内容（none 方法为 0） */
  transformedCount: number;
  warnings: string[];
}

// ─── none ─────────────────────────────────────────────────────────────────────

function transformNone(chunks: InputChunk[]): TransformOutput {
  return {
    chunks: chunks.map((c) => ({
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
 * 在 chunk 文本前注入标题路径前缀。
 *
 * 注入格式（可选组合）：
 *   "[文档标题]\n[sourceRef 路径]\n\n[原始 chunk 文本]"
 *
 * 为什么有效？
 *   Dense vector 检索时，query "核心功能" 和 chunk "支持 PDF 上传" 的余弦相似度很低。
 *   注入前缀后 chunk 变成 "产品介绍 > 核心功能\n支持 PDF 上传"，
 *   其 embedding 就同时捕获了章节语义，与 query 的相似度显著提升。
 */
function transformHeadingContext(
  chunks: InputChunk[],
  params: { includeTitle: boolean; includeHeadingPath: boolean; documentTitle: string }
): TransformOutput {
  const warnings: string[] = [];
  let transformedCount = 0;

  const transformed = chunks.map((c) => {
    const parts: string[] = [];

    if (params.includeTitle && params.documentTitle) {
      parts.push(params.documentTitle);
    }
    if (params.includeHeadingPath && c.sourceRef) {
      // 避免把文档标题和 sourceRef 重复（sourceRef 通常已包含顶层标题）
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
    warnings.push("所有 chunk 的 sourceRef 均为空，heading-context 未注入任何内容。建议先用 markdown-structure 预处理。");
  }

  return { chunks: transformed, chunkCount: chunks.length, method: "heading-context", transformedCount, warnings };
}

// ─── summary-keywords ─────────────────────────────────────────────────────────

// 停用词统一由 lib/nlp.ts 管理（stopword 包 zho+eng + 产品文档领域词，共 500+ 词）。
// 本文件不再维护本地副本，避免多处发散。

/**
 * 关键词提取：委托给 lib/nlp.ts（jieba 分词 + 停用词过滤 + 词频排序）。
 * 原手写版使用空格/标点切分，中文整句变 1 个 token，关键词质量极低。
 * 现使用 jieba 后中文词组可被正确识别（"设计风格"、"主题色方案"）。
 */
function extractKeywords(text: string, topN: number): string[] {
  return nlpExtractKeywords(text, topN);
}

/**
 * 简单摘要：取前 N 句，截断到 maxChars。
 *
 * 规则摘要不理解语义，只保证结构完整性。
 * LLM 摘要（调用 Claude/GPT）效果更好，但需要 API Key 和延迟，
 * 留给后续 llm-summary transform 方法扩展。
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
  chunks: InputChunk[],
  params: { keywordCount: number; summaryMaxChars: number; appendToChunk: boolean }
): TransformOutput {
  const warnings: string[] = [];
  let transformedCount = 0;

  const transformed = chunks.map((c) => {
    const keywords = extractKeywords(c.text, params.keywordCount);
    const summary = extractSummary(c.text, params.summaryMaxChars);

    // 把关键词和摘要拼到 chunk 末尾（供 embedding 使用）
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

  return { chunks: transformed, chunkCount: chunks.length, method: "summary-keywords", transformedCount, warnings };
}

// ─── API Route ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { methodId, params, upstreamOutput } = body as {
      methodId: string;
      params: Record<string, unknown>;
      upstreamOutput: ChunkOutput | null;
    };

    if (!upstreamOutput?.chunks?.length) {
      return NextResponse.json(
        { error: { code: "missing_upstream", message: "未找到分块输出，请先运行分块 Stage" } },
        { status: 400 }
      );
    }

    const { chunks } = upstreamOutput;
    let result: TransformOutput;

    switch (methodId) {
      case "heading-context":
        result = transformHeadingContext(chunks, {
          includeTitle: params?.includeTitle !== false,
          includeHeadingPath: params?.includeHeadingPath !== false,
          documentTitle: (params?.documentTitle as string) ?? "",
        });
        break;

      case "summary-keywords":
        result = transformSummaryKeywords(chunks, {
          keywordCount: Math.max(1, Number(params?.keywordCount ?? 5)),
          summaryMaxChars: Math.max(20, Number(params?.summaryMaxTokens ?? 100) * 4),
          appendToChunk: params?.appendToChunk !== false,
        });
        break;

      default: // none
        result = transformNone(chunks);
        break;
    }

    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      output: result,
      trace: {
        method: methodId,
        inputChunkCount: chunks.length,
        transformedCount: result.transformedCount,
        avgEnhancedTokens: result.chunks.length
          ? Math.round(result.chunks.reduce((s, c) => s + c.enhancedTokenEstimate, 0) / result.chunks.length)
          : 0,
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
