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
 * 支持五种解析方法：
 *   - markdown-structure: 保留 Markdown heading 层级，提取 heading path
 *   - plain-text:         只做基础清洗，适合纯文本文件
 *   - markitdown:         微软 Markitdown 风格，支持多格式（HTML/DOCX/PDF）统一转 Markdown
 *   - pymupdf:            PyMuPDF 风格，PDF 精确按页提取，保留排版结构
 *   - pdf-pages:          按页解析（基础版，生产环境接 pdf-parse 库）
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

// ─── Markitdown 预处理 ────────────────────────────────────────────────────────

/**
 * Markitdown 风格预处理（参考微软 markitdown 库的设计）。
 *
 * Markitdown 的核心思路：把任意格式（PDF、DOCX、HTML、PPTX 等）统一转换成
 * 干净的 Markdown，再交给 LLM 或 RAG pipeline 处理。好处是：
 *   1. LLM 对 Markdown 的理解能力远好于裸 HTML 或 PDF 提取文本
 *   2. 结构（标题、表格、列表）在转换后仍然可见
 *   3. 一套 pipeline 可以处理多种输入格式
 *
 * 当前实现：在 markdown-structure 基础上额外处理
 *   - HTML 标签清洗（适合 DOCX 导出的 HTML）
 *   - 表格保留（Markdown GFM 格式）
 *   - 更激进的样板内容过滤
 *
 * 生产环境：调用 Python markitdown 服务或 Pandoc，这里用 JS 近似实现作为演示。
 */
function parseMarkitdown(
  raw: string,
  params: { preserveHeadings: boolean; preserveTables: boolean; removeBoilerplate: boolean; maxChars: number }
): PreprocessOutput {
  const warnings: string[] = [];

  // Step 1: 清除常见 HTML 标签（适合从 DOCX/HTML 导出的内容）
  let cleaned = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")          // 移除所有 HTML 标签，保留内容
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  // Step 2: 如果检测到原始内容是 Markdown，走标准 MD 解析流程
  const isMarkdown = /^#{1,6}\s+.+/m.test(raw) || /\*\*.+\*\*/m.test(raw);
  if (isMarkdown) {
    const mdResult = parseMarkdown(cleaned, {
      preserveHeadings: params.preserveHeadings,
      removeBoilerplate: params.removeBoilerplate,
      maxChars: params.maxChars,
    });
    mdResult.warnings.unshift("markitdown: 检测到 Markdown 格式，已使用结构化解析");
    return mdResult;
  }

  // Step 3: 非 Markdown 内容，做更激进的清洗
  const lines = cleaned.split("\n");
  const cleanLines: string[] = [];

  for (const line of lines) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (!clean) continue;

    // Markitdown 会过滤掉页眉页脚（短于 20 字且只含数字/标点的行）
    if (params.removeBoilerplate && clean.length < 20 && /^[\d\s\W]+$/.test(clean)) {
      warnings.push(`markitdown: 过滤样板行 "${clean}"`);
      continue;
    }

    cleanLines.push(clean);
  }

  let cleanText = cleanLines.join("\n");
  if (params.maxChars > 0 && cleanText.length > params.maxChars) {
    cleanText = cleanText.slice(0, params.maxChars);
    warnings.push(`文本已截断至 ${params.maxChars} 字符`);
  }

  if (!params.preserveTables) {
    // 移除疑似表格行（含多个 | 分隔符）
    cleanText = cleanText.split("\n").filter(l => (l.match(/\|/g) ?? []).length < 2).join("\n");
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

// ─── PyMuPDF 预处理 ───────────────────────────────────────────────────────────

/**
 * PyMuPDF 风格预处理（参考 pymupdf / fitz 库的设计）。
 *
 * PyMuPDF 是 Python 中最精确的 PDF 处理库，核心优势：
 *   1. 按页提取，精确保留页码信息（对法律/学术文档的引用很重要）
 *   2. 能识别文本块的几何位置，从而重建阅读顺序（解决 PDF 多列乱序问题）
 *   3. 支持提取图片、表格、注释等结构化信息
 *
 * 当前实现：模拟 PyMuPDF 的按页分块行为，生产环境应调用 Python 微服务。
 * 每 30 行文本视为一页（粗略估计），记录页码 sourceRef。
 *
 * 为什么在 RAG 中 pymupdf 比基础 pdf-parse 更好？
 *   - 保留页码可以生成"第 X 页"的精确引用，满足法律/合规场景要求
 *   - 几何排序纠正多列 PDF 的乱序文本，chunk 质量更高
 */
function parsePymupdf(
  raw: string,
  params: { pdfPageRange: string; preserveLayout: boolean; extractImages: boolean; maxChars: number }
): PreprocessOutput {
  const warnings: string[] = [];
  const sourceRefs: SourceRef[] = [];

  // 按 30 行模拟一页（生产环境由 PDF 渲染引擎精确分页）
  const lines = raw.split("\n").filter(l => l.trim());
  const LINES_PER_PAGE = 30;
  const totalPages = Math.ceil(lines.length / LINES_PER_PAGE);

  // 解析页码范围（格式: "1-5" 或 "3" 或留空表示全部）
  let startPage = 1;
  let endPage = totalPages;
  if (params.pdfPageRange.trim()) {
    const match = params.pdfPageRange.match(/^(\d+)(?:-(\d+))?$/);
    if (match) {
      startPage = parseInt(match[1]);
      endPage = match[2] ? parseInt(match[2]) : startPage;
    } else {
      warnings.push(`pymupdf: 无法解析页码范围 "${params.pdfPageRange}"，将处理全部页`);
    }
  }

  const selectedLines: string[] = [];
  let charCursor = 0;

  for (let page = 1; page <= totalPages; page++) {
    if (page < startPage || page > endPage) continue;

    const pageStart = (page - 1) * LINES_PER_PAGE;
    const pageLines = lines.slice(pageStart, pageStart + LINES_PER_PAGE);
    const pageText = pageLines.join("\n");

    // 记录每页的 sourceRef，供 citation 阶段使用
    const refStart = charCursor;
    charCursor += pageText.length + 1;
    sourceRefs.push({
      type: "page",
      value: `第 ${page} 页`,
      charStart: refStart,
      charEnd: charCursor,
    });

    selectedLines.push(...pageLines);
  }

  let cleanText = selectedLines.join("\n");

  // preserveLayout=false 时压缩连续空行，减少噪音
  if (!params.preserveLayout) {
    cleanText = cleanText.replace(/\n{3,}/g, "\n\n");
  }

  if (params.maxChars > 0 && cleanText.length > params.maxChars) {
    cleanText = cleanText.slice(0, params.maxChars);
    warnings.push(`文本已截断至 ${params.maxChars} 字符`);
  }

  if (params.extractImages) {
    warnings.push("pymupdf: 图片提取在当前模拟模式下不可用，生产环境需接入 Python pymupdf 服务");
  }

  return {
    rawText: raw,
    cleanText,
    charCount: cleanText.length,
    wordCount: cleanText.split(/\s+/).filter(Boolean).length,
    metadata: {
      fileName: "",
      mimeType: "application/pdf",
      pageCount: totalPages,
    },
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
    const preserveTables = params?.preserveTables !== false;
    const preserveLayout = params?.preserveLayout !== false;
    const removeBoilerplate = Boolean(params?.removeBoilerplate);
    const extractImages = Boolean(params?.extractImages);
    const maxChars = Number(params?.maxChars ?? 0);
    const pdfPageRange = (params?.pdfPageRange as string) ?? "";

    let result: PreprocessOutput;

    switch (methodId) {
      case "plain-text":
        result = parsePlainText(doc.rawContent, { removeBoilerplate, maxChars });
        break;

      case "markitdown":
        result = parseMarkitdown(doc.rawContent, { preserveHeadings, preserveTables, removeBoilerplate, maxChars });
        break;

      case "pymupdf":
        result = parsePymupdf(doc.rawContent, { pdfPageRange, preserveLayout, extractImages, maxChars });
        break;

      case "pdf-pages":
        // 基础 PDF 按页解析（模拟），生产环境接 pdf-parse 或 pdf2json
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
