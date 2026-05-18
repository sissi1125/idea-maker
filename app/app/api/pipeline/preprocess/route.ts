/**
 * RAG Pipeline Stage 2 - 文档预处理 (Preprocess)
 *
 * 作用：把原始文档转换为结构化的 cleanText 和 sourceRefs，供 chunking 使用。
 *
 * Pipeline 位置：
 *   幂等性检查 → [预处理] → 分块 → 向量化 → 存储
 *
 * 五种方法及其真实依赖：
 *
 *   markdown-structure  纯 JS，无外部依赖
 *   plain-text          纯 JS，无外部依赖
 *   markitdown-ts       mammoth（DOCX→HTML）+ turndown（HTML→MD）+ pdf-parse v2（PDF→text）
 *                       按文件类型自动路由，思路对标微软 markitdown，但全部是 npm 包
 *   pdf-pages           pdf-parse v2 直接按页提取，适合需要页码 sourceRef 的场景
 *   pymupdf             ⚠ pymupdf 是 Python 库，Next.js 不能直接调用。
 *                       生产环境需独立 Python 微服务（FastAPI + pymupdf）。
 *                       此处返回 501 + 部署建议，而非假实现。
 */

import { NextRequest, NextResponse } from "next/server";
import { getDocument, getDocumentBuffer } from "@/lib/docStore";
// pdf-parse v1：纯 Node.js，无 web worker 依赖，直接 pdfParse(buffer) 返回 Promise
// v2 在 Next.js server 端会找 pdfjs web worker 文件导致失败，故回退到 v1
import pdfParse from "pdf-parse";
import TurndownService from "turndown";
import mammoth from "mammoth";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface SourceRef {
  type: "heading" | "paragraph" | "page";
  value: string;
  charStart: number;
  charEnd: number;
}

interface PreprocessOutput {
  rawText: string;        // 原始内容（文本文件为原文，二进制文件为提取的文本）
  cleanText: string;      // 清洗后的文本，直接用于 chunking
  charCount: number;
  wordCount: number;
  metadata: {
    fileName: string;
    mimeType: string;
    headings?: string[];
    pageCount?: number;
  };
  sourceRefs: SourceRef[];
  warnings: string[];
}

// ─── markdown-structure ───────────────────────────────────────────────────────

/**
 * 用 heading path 栈解析 Markdown，为每段文字记录所属章节。
 * sourceRef 的 heading path（如"产品介绍 > 核心功能"）是后续 citation 溯源的基础。
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
  const headingStack: string[] = new Array(6).fill("");
  let charCursor = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length - 1;
      const title = headingMatch[2].trim();
      headingStack[level] = title;
      for (let i = level + 1; i < 6; i++) headingStack[i] = "";
      headings.push(title);
      if (params.preserveHeadings) {
        cleanLines.push(title);
        const start = charCursor;
        charCursor += title.length + 1;
        sourceRefs.push({ type: "heading", value: headingStack.filter(Boolean).join(" > "), charStart: start, charEnd: charCursor });
      }
      continue;
    }

    const clean = line
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[(.+?)\]\(.*?\)/g, "$1")
      .replace(/`{1,3}[^`]*`{1,3}/g, "")
      .replace(/\*{1,2}(.+?)\*{1,2}/g, "$1")
      .replace(/_{1,2}(.+?)_{1,2}/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/^>\s+/, "")
      .trim();

    if (params.removeBoilerplate && clean.length < 15 && /^[\d\s\W]+$/.test(clean)) {
      warnings.push(`已过滤疑似样板内容: "${clean}"`);
      continue;
    }
    if (!clean) continue;

    const start = charCursor;
    charCursor += clean.length + 1;
    const currentPath = headingStack.filter(Boolean).join(" > ");
    if (currentPath) sourceRefs.push({ type: "paragraph", value: currentPath, charStart: start, charEnd: charCursor });
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
    metadata: { fileName: "", mimeType: "text/markdown", headings },
    sourceRefs,
    warnings,
  };
}

// ─── plain-text ───────────────────────────────────────────────────────────────

function parsePlainText(
  raw: string,
  params: { removeBoilerplate: boolean; maxChars: number }
): PreprocessOutput {
  const warnings: string[] = [];
  const cleanLines = raw.split("\n").filter(line => {
    const clean = line.trim();
    if (!clean) return false;
    if (params.removeBoilerplate && clean.length < 15 && /^[\d\s\W]+$/.test(clean)) {
      warnings.push(`已过滤疑似样板内容: "${clean}"`);
      return false;
    }
    return true;
  }).map(l => l.trim());

  let cleanText = cleanLines.join("\n");
  if (params.maxChars > 0 && cleanText.length > params.maxChars) {
    cleanText = cleanText.slice(0, params.maxChars);
    warnings.push(`文本已截断至 ${params.maxChars} 字符`);
  }
  return { rawText: raw, cleanText, charCount: cleanText.length, wordCount: cleanText.split(/\s+/).filter(Boolean).length, metadata: { fileName: "", mimeType: "text/plain" }, sourceRefs: [], warnings };
}

// ─── markitdown-ts ─────────────────────────────────────────────────────────────

/**
 * markitdown-ts：按文件类型自动路由，统一输出 cleanText。
 *
 * 路由策略：
 *   PDF  → pdf-parse v2 提取文本 → plain-text 清洗
 *   DOCX → mammoth 转 HTML → turndown 转 Markdown → markdown-structure 解析
 *   HTML → turndown 转 Markdown → markdown-structure 解析
 *   MD   → markdown-structure 解析
 *   其他 → plain-text 清洗
 *
 * 为什么分三个库而不是一个？
 *   - PDF 的文本提取需要解析二进制 PDF 格式（pdf-parse）
 *   - DOCX 的文本提取需要解压 ZIP + 解析 XML（mammoth）
 *   - HTML→Markdown 转换需要 DOM 语义理解（turndown）
 *   微软 markitdown 的 Python 版本背后也是类似的分派逻辑。
 */
async function parseMarkitdownTs(
  rawContent: string,
  buffer: Buffer,
  mimeType: string,
  params: { preserveHeadings: boolean; preserveTables: boolean; removeBoilerplate: boolean; maxChars: number }
): Promise<PreprocessOutput> {
  const warnings: string[] = [];
  const isPdf = mimeType === "application/pdf" || mimeType === "application/x-pdf";
  const isDocx = mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "application/msword";
  const isHtml = mimeType === "text/html" || (/<[a-z][\s\S]*>/i.test(rawContent) && !isPdf && !isDocx);
  const isMarkdown = mimeType === "text/markdown" || /^#{1,6}\s+.+/m.test(rawContent);

  // PDF：用 pdf-parse v1 提取文本（v1 纯 Node.js，无 web worker 依赖）
  if (isPdf) {
    warnings.push("markitdown-ts: 检测到 PDF，使用 pdf-parse 提取文本");
    try {
      const result = await pdfParse(buffer);
      const extracted = result.text ?? "";

      // 提取到空文本通常意味着：
      //   1. 文档是扫描版 PDF（需要 OCR，此处不支持）
      //   2. 文档在 docStore 格式修复前上传，binary 被 file.text() 读成乱码存储
      //      解决方法：删除文档后重新上传
      if (!extracted.trim()) {
        return {
          rawText: "",
          cleanText: "",
          charCount: 0,
          wordCount: 0,
          metadata: { fileName: "", mimeType, pageCount: result.numpages },
          sourceRefs: [],
          warnings: [
            ...warnings,
            `pdf-parse 提取到空文本（共 ${result.numpages} 页）。`,
            "可能原因 1：扫描版 PDF，需要 OCR 才能提取文字（当前不支持）。",
            "可能原因 2：此文档在存储格式升级前上传，PDF binary 以错误编码保存。",
            "解决方法：请在文档库中删除该文档并重新上传，系统将以正确的 base64 格式存储 PDF。",
          ],
        };
      }

      const inner = parsePlainText(extracted, { removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
      inner.warnings.unshift(...warnings);
      inner.metadata.pageCount = result.numpages;
      inner.rawText = extracted;
      return inner;
    } catch (e) {
      warnings.push(`pdf-parse 失败: ${e}，降级为原始文本`);
      const fallback = parsePlainText(rawContent, { removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
      fallback.warnings.unshift(...warnings);
      return fallback;
    }
  }

  // DOCX：mammoth 转 HTML，再 turndown 转 Markdown
  if (isDocx) {
    warnings.push("markitdown-ts: 检测到 DOCX，使用 mammoth 转换为 HTML");
    try {
      const mammothResult = await mammoth.convertToHtml({ buffer });
      const html = mammothResult.value;
      if (mammothResult.messages.length > 0) {
        warnings.push(...mammothResult.messages.map((m: { message: string }) => `mammoth: ${m.message}`));
      }
      const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
      const markdown = td.turndown(html);
      warnings.push("markitdown-ts: DOCX → HTML → Markdown 转换完成");
      const inner = parseMarkdown(markdown, { preserveHeadings: params.preserveHeadings, removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
      inner.warnings.unshift(...warnings);
      inner.rawText = rawContent;
      return inner;
    } catch (e) {
      warnings.push(`mammoth 失败: ${e}，降级为纯文本`);
      const fallback = parsePlainText(rawContent, { removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
      fallback.warnings.unshift(...warnings);
      return fallback;
    }
  }

  // HTML：turndown 转 Markdown
  if (isHtml) {
    warnings.push("markitdown-ts: 检测到 HTML，使用 turndown 转换为 Markdown");
    const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
    const markdown = td.turndown(rawContent);
    const inner = parseMarkdown(markdown, { preserveHeadings: params.preserveHeadings, removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
    inner.warnings.unshift(...warnings);
    inner.rawText = rawContent;
    return inner;
  }

  // Markdown：直接解析
  if (isMarkdown) {
    warnings.push("markitdown-ts: 检测到 Markdown，直接解析");
    const inner = parseMarkdown(rawContent, { preserveHeadings: params.preserveHeadings, removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
    inner.warnings.unshift(...warnings);
    return inner;
  }

  // 其他：plain-text
  warnings.push(`markitdown-ts: 未知格式 (${mimeType})，降级为纯文本解析`);
  const fallback = parsePlainText(rawContent, { removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
  fallback.warnings.unshift(...warnings);
  return fallback;
}

// ─── pdf-pages ────────────────────────────────────────────────────────────────

/**
 * 用 pdf-parse v2 按页提取 PDF，每页生成独立 sourceRef。
 * 适合需要"来自第 N 页"精确引用的场景（法律/学术文档）。
 */
async function parsePdfPages(
  buffer: Buffer,
  mimeType: string,
  rawContent: string,
  params: { pdfPageRange: string; maxChars: number }
): Promise<PreprocessOutput> {
  const warnings: string[] = [];
  const isPdf = mimeType === "application/pdf" || mimeType === "application/x-pdf";

  if (!isPdf) {
    warnings.push(`pdf-pages: 文件类型 ${mimeType} 不是 PDF，降级为纯文本`);
    const fb = parsePlainText(rawContent, { removeBoilerplate: false, maxChars: params.maxChars });
    fb.warnings.unshift(...warnings);
    return fb;
  }

  try {
    const result = await pdfParse(buffer);
    const fullText = result.text ?? "";
    const totalPages = result.numpages ?? 1;

    if (!fullText.trim()) {
      return { rawText: "", cleanText: "", charCount: 0, wordCount: 0, metadata: { fileName: "", mimeType, pageCount: totalPages }, sourceRefs: [], warnings: ["pdf-parse 提取到空文本，请删除文档后重新上传（存储格式升级前上传的 PDF 需要重传）。"] };
    }

    // 解析页码范围
    let startPage = 1, endPage = totalPages;
    if (params.pdfPageRange.trim()) {
      const m = params.pdfPageRange.match(/^(\d+)(?:-(\d+))?$/);
      if (m) { startPage = parseInt(m[1]); endPage = m[2] ? parseInt(m[2]) : startPage; }
      else warnings.push(`无法解析页码范围 "${params.pdfPageRange}"，处理全部页`);
    }

    // pdf-parse 以 \f（form feed）分页
    const pages = fullText.split(/\f/);
    const sourceRefs: SourceRef[] = [];
    let combined = "";
    let charCursor = 0;

    for (let i = startPage - 1; i < Math.min(endPage, pages.length); i++) {
      const pageText = pages[i]?.trim() ?? "";
      if (!pageText) continue;
      const start = charCursor;
      charCursor += pageText.length + 1;
      sourceRefs.push({ type: "page", value: `第 ${i + 1} 页`, charStart: start, charEnd: charCursor });
      combined += pageText + "\n";
    }

    let cleanText = combined.trim();
    if (params.maxChars > 0 && cleanText.length > params.maxChars) {
      cleanText = cleanText.slice(0, params.maxChars);
      warnings.push(`文本已截断至 ${params.maxChars} 字符`);
    }

    return { rawText: fullText, cleanText, charCount: cleanText.length, wordCount: cleanText.split(/\s+/).filter(Boolean).length, metadata: { fileName: "", mimeType, pageCount: totalPages }, sourceRefs, warnings };
  } catch (e) {
    warnings.push(`pdf-parse 失败: ${e}，降级为纯文本`);
    const fb = parsePlainText(rawContent, { removeBoilerplate: false, maxChars: params.maxChars });
    fb.warnings.unshift(...warnings);
    return fb;
  }
}

// ─── pymupdf 微服务调用 ────────────────────────────────────────────────────────

/**
 * 调用独立 Python 微服务（services/pymupdf/main.py）。
 *
 * 服务地址优先读环境变量 PYMUPDF_SERVICE_URL，方便 docker-compose 和生产环境配置：
 *   - 本地开发（直接 npm run dev）：docker compose up pymupdf → localhost:8001
 *   - docker-compose 全栈模式：服务名 "pymupdf" 自动 DNS 解析 → http://pymupdf:8000
 *
 * 如果服务未启动，返回明确的 provider_unavailable 错误，不会 crash。
 */
async function callPymupdfService(
  rawContent: string,
  isBinary: boolean,
  mimeType: string,
  params: { pageRange: string; preserveLayout: boolean; extractImages: boolean; maxChars: number }
): Promise<PreprocessOutput> {
  const serviceUrl = process.env.PYMUPDF_SERVICE_URL ?? "http://localhost:8001";
  const warnings: string[] = [];

  // 只有真实 PDF 才发给 pymupdf；其他格式直接降级到纯文本
  const isPdf = mimeType === "application/pdf" || mimeType === "application/x-pdf";
  if (!isPdf) {
    warnings.push(`pymupdf: 文件类型 ${mimeType} 不是 PDF，降级为纯文本`);
    const fb = parsePlainText(rawContent, { removeBoilerplate: false, maxChars: params.maxChars });
    fb.warnings.unshift(...warnings);
    return fb;
  }

  // 确保传给 pymupdf 的是 base64（二进制文件已是 base64，文本文件需转换）
  const pdfBase64 = isBinary ? rawContent : Buffer.from(rawContent, "utf-8").toString("base64");

  let res: Response;
  try {
    res = await fetch(`${serviceUrl}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdf_base64: pdfBase64,
        page_range: params.pageRange,
        preserve_layout: params.preserveLayout,
        extract_images: params.extractImages,
      }),
      signal: AbortSignal.timeout(30000), // 大 PDF 给 30 秒超时
    });
  } catch (err) {
    // 服务未启动或网络不通：返回明确错误，不 crash
    const msg = String(err).includes("ECONNREFUSED")
      ? `pymupdf 服务未启动。请运行 "docker compose up pymupdf" 后重试。`
      : `pymupdf 服务连接失败: ${err}`;
    return {
      rawText: "", cleanText: "", charCount: 0, wordCount: 0,
      metadata: { fileName: "", mimeType },
      sourceRefs: [],
      warnings: [msg],
    };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      rawText: "", cleanText: "", charCount: 0, wordCount: 0,
      metadata: { fileName: "", mimeType },
      sourceRefs: [],
      warnings: [`pymupdf 服务返回错误 ${res.status}: ${JSON.stringify(err)}`],
    };
  }

  const data = await res.json();

  let cleanText: string = data.clean_text ?? "";
  if (params.maxChars > 0 && cleanText.length > params.maxChars) {
    cleanText = cleanText.slice(0, params.maxChars);
    warnings.push(`文本已截断至 ${params.maxChars} 字符`);
  }

  return {
    rawText: data.raw_text ?? cleanText,
    cleanText,
    charCount: cleanText.length,
    wordCount: cleanText.split(/\s+/).filter(Boolean).length,
    metadata: { fileName: "", mimeType, pageCount: data.page_count },
    sourceRefs: (data.source_refs ?? []).map((r: { type: string; value: string; char_start: number; char_end: number }) => ({
      type: r.type,
      value: r.value,
      charStart: r.char_start,
      charEnd: r.char_end,
    })),
    warnings: [...(data.warnings ?? []), ...warnings],
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
      return NextResponse.json({ error: { code: "missing_document", message: "未选择文档" } }, { status: 400 });
    }

    const doc = getDocument(pipelineRun.selectedDocumentId);
    if (!doc) {
      return NextResponse.json({ error: { code: "document_not_found", message: "文档不存在" } }, { status: 404 });
    }

    const buffer = getDocumentBuffer(doc);
    const preserveHeadings = params?.preserveHeadings !== false;
    const preserveTables = params?.preserveTables !== false;
    const removeBoilerplate = Boolean(params?.removeBoilerplate);
    const maxChars = Number(params?.maxChars ?? 0);
    const pdfPageRange = (params?.pdfPageRange as string) ?? "";

    let result: PreprocessOutput;

    switch (methodId) {
      case "plain-text":
        result = parsePlainText(doc.rawContent, { removeBoilerplate, maxChars });
        break;

      case "markitdown":
        result = await parseMarkitdownTs(doc.rawContent, buffer, doc.mimeType, { preserveHeadings, preserveTables, removeBoilerplate, maxChars });
        break;

      case "pdf-pages":
        result = await parsePdfPages(buffer, doc.mimeType, doc.rawContent, { pdfPageRange, maxChars });
        break;

      case "pymupdf":
        // 调用独立 Python 微服务（services/pymupdf/main.py）
        // 本地开发：docker compose up pymupdf，服务监听 localhost:8001
        result = await callPymupdfService(doc.rawContent, doc.isBinary, doc.mimeType, {
          pageRange: pdfPageRange,
          preserveLayout: params?.preserveLayout !== false,
          extractImages: Boolean(params?.extractImages),
          maxChars,
        });
        break;

      default: // markdown-structure
        result = parseMarkdown(doc.rawContent, { preserveHeadings, removeBoilerplate, maxChars });
        break;
    }

    result.metadata.fileName = doc.fileName;
    result.metadata.mimeType = doc.mimeType;
    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      output: result,
      trace: {
        method: methodId,
        isBinary: doc.isBinary,
        rawCharCount: doc.rawContent.length,
        cleanCharCount: result.cleanText.length,
        compressionRatio: (result.cleanText.length / Math.max(1, doc.rawContent.length)).toFixed(2),
        headingCount: result.metadata.headings?.length ?? 0,
        sourceRefCount: result.sourceRefs.length,
        durationMs,
      },
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: { code: "internal_error", message: String(err) } }, { status: 500 });
  }
}
