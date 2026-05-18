/**
 * RAG Pipeline Stage 2 - 文档预处理 (Preprocess)
 *
 * 作用：把上传的原始文档转换为结构化的 cleanText，并提取 metadata。
 * 这是 chunking 的前置步骤——只有清洗干净的文本才能被有效切分和检索。
 *
 * 在 pipeline 中的位置：
 *   幂等性检查 → [预处理] → 分块 → 向量化 → 存储
 *
 * 为什么预处理很重要？
 * - 原始 Markdown 包含大量语法符号（##、**、[]()），直接嵌入会引入噪音
 * - PDF 提取的文本常含页眉页脚、乱序段落，需要清洗
 * - 保留 heading 结构可以在后续 chunk 时记录"这段话属于哪个章节"，
 *   这个 sourceRef 对生成引用和溯源非常关键
 *
 * 支持三种解析方法：
 *   - markdown-structure: 保留 Markdown heading 层级，提取 heading path
 *   - plain-text:         只做基础清洗，适合纯文本文件
 *   - pdf-pages:          按页解析（当前用文本模拟，生产环境接 pdf-parse 库）
 */

import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/docStore";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 段落级别的 source 引用，记录该段文字来自文档的哪里 */
interface SourceRef {
  type: "heading" | "paragraph" | "page";
  value: string;      // heading 路径或页码
  charStart: number;
  charEnd: number;
}

/** preprocess 的产物结构 */
interface PreprocessOutput {
  rawText: string;
  cleanText: string;
  charCount: number;
  wordCount: number;
  metadata: {
    fileName: string;
    mimeType: string;
    headings?: string[];       // Markdown heading 列表
    pageCount?: number;        // PDF 页数
  };
  sourceRefs: SourceRef[];
  warnings: string[];
}

// ─── Markdown 预处理 ──────────────────────────────────────────────────────────

/**
 * 解析 Markdown 文档，保留标题层级结构。
 *
 * 核心逻辑：
 * 1. 按行扫描，识别 # ~ ###### 标题行
 * 2. 维护一个"当前 heading path"栈，例如 ["产品介绍", "核心功能"]
 * 3. 清洗 Markdown 语法（加粗、链接、代码块等）
 * 4. 每个段落记录其 heading path 作为 sourceRef，供 chunking 阶段使用
 *
 * @param raw 原始 Markdown 文本
 * @param params 用户配置项
 */
function parseMarkdown(
  raw: string,
  params: { preserveHeadings: boolean; removeBoilerplate: boolean; maxChars: number }
): PreprocessOutput {
  const lines = raw.split("\n");
  const headings: string[] = [];
  const sourceRefs: SourceRef[] = [];
  const warnings: string[] = [];
  const cleanLines: string[] = [];

  // heading path 栈：index 0 = h1, 1 = h2, ...（最多 6 层）
  const headingStack: string[] = new Array(6).fill("");
  let charCursor = 0;

  for (const line of lines) {
    // 识别 Markdown 标题：以 1~6 个 # 开头
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length - 1; // 转为 0-based 索引
      const title = headingMatch[2].trim();

      // 更新 heading 栈：当前层级写入标题，更深层级清空
      headingStack[level] = title;
      for (let i = level + 1; i < 6; i++) headingStack[i] = "";

      headings.push(title);

      if (params.preserveHeadings) {
        // 保留标题文字（去掉 # 符号），保持段落可读性
        const headingText = title;
        cleanLines.push(headingText);
        const start = charCursor;
        charCursor += headingText.length + 1;
        sourceRefs.push({
          type: "heading",
          value: headingStack.filter(Boolean).join(" > "),
          charStart: start,
          charEnd: charCursor,
        });
      }
      continue;
    }

    // 清洗 Markdown 行内语法
    let clean = line
      .replace(/!\[.*?\]\(.*?\)/g, "")      // 移除图片
      .replace(/\[(.+?)\]\(.*?\)/g, "$1")   // 链接保留文字
      .replace(/`{1,3}[^`]*`{1,3}/g, "")    // 移除行内代码
      .replace(/\*{1,2}(.+?)\*{1,2}/g, "$1") // 移除加粗/斜体符号
      .replace(/_{1,2}(.+?)_{1,2}/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")           // 移除删除线
      .replace(/^[-*+]\s+/, "")              // 移除无序列表符号
      .replace(/^\d+\.\s+/, "")             // 移除有序列表序号
      .replace(/^>\s+/, "")                 // 移除引用符号
      .trim();

    // removeBoilerplate：过滤掉可能是页眉页脚的短行（<15 字且全是数字/标点）
    if (params.removeBoilerplate && clean.length < 15 && /^[\d\s\W]+$/.test(clean)) {
      warnings.push(`已过滤疑似样板内容: "${clean}"`);
      continue;
    }

    if (!clean) continue; // 跳过空行

    const start = charCursor;
    charCursor += clean.length + 1;

    // 记录该段落当前所属的 heading path
    const currentPath = headingStack.filter(Boolean).join(" > ");
    if (currentPath) {
      sourceRefs.push({ type: "paragraph", value: currentPath, charStart: start, charEnd: charCursor });
    }

    cleanLines.push(clean);
  }

  let cleanText = cleanLines.join("\n");

  // 截断处理：maxChars > 0 时限制输出长度，并记录警告
  if (params.maxChars > 0 && cleanText.length > params.maxChars) {
    cleanText = cleanText.slice(0, params.maxChars);
    warnings.push(`文本已截断至 ${params.maxChars} 字符`);
  }

  return {
    rawText: raw,
    cleanText,
    charCount: cleanText.length,
    wordCount: cleanText.split(/\s+/).filter(Boolean).length,
    metadata: { fileName: "", mimeType: "text/markdown", headings },
    sourceRefs,
    warnings,
  };
}

// ─── 纯文本预处理 ─────────────────────────────────────────────────────────────

/**
 * 纯文本清洗：只做基础空白归一化。
 *
 * 为什么不直接用原始文本？
 * 原始文本可能含大量连续空行、行首空白、不可见字符，
 * 这些会导致 chunking 时产生大量无意义的空 chunk。
 */
function parsePlainText(
  raw: string,
  params: { removeBoilerplate: boolean; maxChars: number }
): PreprocessOutput {
  const warnings: string[] = [];
  const lines = raw.split("\n");
  const cleanLines: string[] = [];

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    // 过滤样板内容（同 Markdown 逻辑）
    if (params.removeBoilerplate && clean.length < 15 && /^[\d\s\W]+$/.test(clean)) {
      warnings.push(`已过滤疑似样板内容: "${clean}"`);
      continue;
    }
    cleanLines.push(clean);
  }

  let cleanText = cleanLines.join("\n");
  if (params.maxChars > 0 && cleanText.length > params.maxChars) {
    cleanText = cleanText.slice(0, params.maxChars);
    warnings.push(`文本已截断至 ${params.maxChars} 字符`);
  }

  return {
    rawText: raw,
    cleanText,
    charCount: cleanText.length,
    wordCount: cleanText.split(/\s+/).filter(Boolean).length,
    metadata: { fileName: "", mimeType: "text/plain" },
    sourceRefs: [],
    warnings,
  };
}

// ─── API Route ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { methodId, params, pipelineRun } = body as {
      methodId: string;
      params: Record<string, unknown>;
      pipelineRun: { selectedDocumentId: string | null };
    };

    if (!pipelineRun?.selectedDocumentId) {
      return NextResponse.json(
        { error: { code: "missing_document", message: "未选择文档" } },
        { status: 400 }
      );
    }

    const doc = getDocument(pipelineRun.selectedDocumentId);
    if (!doc) {
      return NextResponse.json(
        { error: { code: "document_not_found", message: `文档不存在` } },
        { status: 404 }
      );
    }

    // 从 params 中读取配置，提供安全默认值
    const preserveHeadings = params?.preserveHeadings !== false;
    const removeBoilerplate = Boolean(params?.removeBoilerplate);
    const maxChars = Number(params?.maxChars ?? 0);
    const pdfPageRange = (params?.pdfPageRange as string) ?? "";

    let result: PreprocessOutput;

    switch (methodId) {
      case "plain-text":
        result = parsePlainText(doc.rawContent, { removeBoilerplate, maxChars });
        break;

      case "pdf-pages":
        // 当前用纯文本模拟 PDF 解析，生产环境应接入 pdf-parse 或 pdf2json
        // 按指定页码范围过滤（这里简化为按行数模拟分页）
        result = parsePlainText(doc.rawContent, { removeBoilerplate, maxChars });
        result.metadata.pageCount = Math.ceil(doc.rawContent.split("\n").length / 30);
        if (pdfPageRange) result.warnings.push(`pdf-pages: 当前为文本模拟，页码范围 "${pdfPageRange}" 未生效`);
        break;

      default: // markdown-structure
        result = parseMarkdown(doc.rawContent, { preserveHeadings, removeBoilerplate, maxChars });
        break;
    }

    // 用文档 metadata 补全 result
    result.metadata.fileName = doc.fileName;
    result.metadata.mimeType = doc.mimeType;

    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      output: result,
      trace: {
        method: methodId,
        preserveHeadings,
        removeBoilerplate,
        maxChars,
        rawCharCount: doc.rawContent.length,
        cleanCharCount: result.cleanText.length,
        compressionRatio: (result.cleanText.length / doc.rawContent.length).toFixed(2),
        headingCount: result.metadata.headings?.length ?? 0,
        sourceRefCount: result.sourceRefs.length,
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
