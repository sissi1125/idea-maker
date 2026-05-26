/**
 * 文档预处理 - 纯算法
 *
 * 5 种 method 及其依赖：
 *   markdown-structure  heading 栈解析 MD，产 heading path sourceRef
 *   plain-text          空白归一化 + 过滤样板内容
 *   markitdown          自动按 mimeType 分派：PDF/DOCX/HTML/MD → 统一输出
 *   pdf-pages           pdf-parse 按页拆分，产 "第 N 页" sourceRef（法律 / 学术场景）
 *   pymupdf             调外部 Python 微服务（URL 由 Input 注入，不读 env）
 *
 * 设计：纯函数，文档 buffer + URL 由路由层注入；不读 env，不访问文件系统。
 */

import isHtmlCheck from "is-html";
import pdfParse from "pdf-parse";
import TurndownService from "turndown";
import mammoth from "mammoth";
import type {
  PreprocessInput,
  PreprocessOutput,
  PreprocessResult,
  PreprocessSourceRef,
} from "@harness/shared-types";

// ─── markdown-structure ───────────────────────────────────────────────────────

/**
 * 用 heading path 栈解析 Markdown，为每段文字记录所属章节。
 * sourceRef 的 heading path（如"产品介绍 > 核心功能"）是后续 citation 溯源的基础。
 */
function parseMarkdown(
  raw: string,
  params: { preserveHeadings: boolean; removeBoilerplate: boolean; maxChars: number },
): PreprocessOutput {
  const lines = raw.split("\n");
  const headings: string[] = [];
  const sourceRefs: PreprocessSourceRef[] = [];
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
        sourceRefs.push({
          type: "heading",
          value: headingStack.filter(Boolean).join(" > "),
          charStart: start,
          charEnd: charCursor,
        });
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
    if (currentPath) {
      sourceRefs.push({ type: "paragraph", value: currentPath, charStart: start, charEnd: charCursor });
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
    metadata: { fileName: "", mimeType: "text/markdown", headings },
    sourceRefs,
    warnings,
  };
}

// ─── plain-text ───────────────────────────────────────────────────────────────

function parsePlainText(
  raw: string,
  params: { removeBoilerplate: boolean; maxChars: number },
): PreprocessOutput {
  const warnings: string[] = [];
  const cleanLines = raw
    .split("\n")
    .filter((line) => {
      const clean = line.trim();
      if (!clean) return false;
      if (params.removeBoilerplate && clean.length < 15 && /^[\d\s\W]+$/.test(clean)) {
        warnings.push(`已过滤疑似样板内容: "${clean}"`);
        return false;
      }
      return true;
    })
    .map((l) => l.trim());

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

// ─── markitdown：按文件类型路由 ───────────────────────────────────────────────

/**
 * 路由策略：
 *   PDF  → pdf-parse 提取文本 → plain-text 清洗
 *   DOCX → mammoth 转 HTML → turndown 转 Markdown → parseMarkdown
 *   HTML → turndown 转 Markdown → parseMarkdown
 *   MD   → parseMarkdown
 *   其他 → plainText
 *
 * 为什么三个库：PDF/DOCX/HTML 各有专属解析需求，单库不能通吃。
 * 微软 markitdown (Python) 背后也是类似分派。
 */
async function parseMarkitdown(
  rawContent: string,
  buffer: Buffer,
  mimeType: string,
  params: { preserveHeadings: boolean; preserveTables: boolean; removeBoilerplate: boolean; maxChars: number },
): Promise<PreprocessOutput> {
  const warnings: string[] = [];
  const isPdf = mimeType === "application/pdf" || mimeType === "application/x-pdf";
  const isDocx =
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword";
  // is-html 包：避免 /<[a-z]/i 误判 TS 泛型 Array<string> 等
  const isHtml = mimeType === "text/html" || (!isPdf && !isDocx && isHtmlCheck(rawContent.slice(0, 2000)));
  const isMarkdown = mimeType === "text/markdown" || /^#{1,6}\s+.+/m.test(rawContent);

  if (isPdf) {
    warnings.push("markitdown: 检测到 PDF，使用 pdf-parse 提取文本");
    try {
      const result = await pdfParse(buffer);
      const extracted = result.text ?? "";
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

  if (isDocx) {
    warnings.push("markitdown: 检测到 DOCX，使用 mammoth 转换为 HTML");
    try {
      const mammothResult = await mammoth.convertToHtml({ buffer });
      const html = mammothResult.value;
      if (mammothResult.messages.length > 0) {
        warnings.push(...mammothResult.messages.map((m: { message: string }) => `mammoth: ${m.message}`));
      }
      const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
      const markdown = td.turndown(html);
      warnings.push("markitdown: DOCX → HTML → Markdown 转换完成");
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

  if (isHtml) {
    warnings.push("markitdown: 检测到 HTML，使用 turndown 转换为 Markdown");
    const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
    const markdown = td.turndown(rawContent);
    const inner = parseMarkdown(markdown, { preserveHeadings: params.preserveHeadings, removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
    inner.warnings.unshift(...warnings);
    inner.rawText = rawContent;
    return inner;
  }

  if (isMarkdown) {
    warnings.push("markitdown: 检测到 Markdown，直接解析");
    const inner = parseMarkdown(rawContent, { preserveHeadings: params.preserveHeadings, removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
    inner.warnings.unshift(...warnings);
    return inner;
  }

  warnings.push(`markitdown: 未知格式 (${mimeType})，降级为纯文本解析`);
  const fallback = parsePlainText(rawContent, { removeBoilerplate: params.removeBoilerplate, maxChars: params.maxChars });
  fallback.warnings.unshift(...warnings);
  return fallback;
}

// ─── pdf-pages：按页拆分 ──────────────────────────────────────────────────────

async function parsePdfPages(
  buffer: Buffer,
  mimeType: string,
  rawContent: string,
  params: { pdfPageRange: string; maxChars: number },
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
      return {
        rawText: "",
        cleanText: "",
        charCount: 0,
        wordCount: 0,
        metadata: { fileName: "", mimeType, pageCount: totalPages },
        sourceRefs: [],
        warnings: [
          "pdf-parse 提取到空文本，请删除文档后重新上传（存储格式升级前上传的 PDF 需要重传）。",
        ],
      };
    }

    let startPage = 1;
    let endPage = totalPages;
    if (params.pdfPageRange.trim()) {
      const m = params.pdfPageRange.match(/^(\d+)(?:-(\d+))?$/);
      if (m) {
        startPage = parseInt(m[1]);
        endPage = m[2] ? parseInt(m[2]) : startPage;
      } else {
        warnings.push(`无法解析页码范围 "${params.pdfPageRange}"，处理全部页`);
      }
    }

    // pdf-parse 以 \f（form feed）分页
    const pages = fullText.split(/\f/);
    const sourceRefs: PreprocessSourceRef[] = [];
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

    return {
      rawText: fullText,
      cleanText,
      charCount: cleanText.length,
      wordCount: cleanText.split(/\s+/).filter(Boolean).length,
      metadata: { fileName: "", mimeType, pageCount: totalPages },
      sourceRefs,
      warnings,
    };
  } catch (e) {
    warnings.push(`pdf-parse 失败: ${e}，降级为纯文本`);
    const fb = parsePlainText(rawContent, { removeBoilerplate: false, maxChars: params.maxChars });
    fb.warnings.unshift(...warnings);
    return fb;
  }
}

// ─── pymupdf：Python 微服务调用 ───────────────────────────────────────────────

async function callPymupdfService(
  rawContent: string,
  isBinary: boolean,
  mimeType: string,
  serviceUrl: string,
  params: { pageRange: string; preserveLayout: boolean; extractImages: boolean; maxChars: number },
): Promise<PreprocessOutput> {
  const warnings: string[] = [];

  const isPdf = mimeType === "application/pdf" || mimeType === "application/x-pdf";
  if (!isPdf) {
    warnings.push(`pymupdf: 文件类型 ${mimeType} 不是 PDF，降级为纯文本`);
    const fb = parsePlainText(rawContent, { removeBoilerplate: false, maxChars: params.maxChars });
    fb.warnings.unshift(...warnings);
    return fb;
  }

  // 二进制文件 rawContent 已是 base64，文本文件需转换
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
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const msg = String(err).includes("ECONNREFUSED")
      ? `pymupdf 服务未启动。请运行 "docker compose up pymupdf" 后重试。`
      : `pymupdf 服务连接失败: ${err}`;
    return {
      rawText: "",
      cleanText: "",
      charCount: 0,
      wordCount: 0,
      metadata: { fileName: "", mimeType },
      sourceRefs: [],
      warnings: [msg],
    };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      rawText: "",
      cleanText: "",
      charCount: 0,
      wordCount: 0,
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
    sourceRefs: (data.source_refs ?? []).map(
      (r: { type: string; value: string; char_start: number; char_end: number }) => ({
        type: r.type as PreprocessSourceRef["type"],
        value: r.value,
        charStart: r.char_start,
        charEnd: r.char_end,
      }),
    ),
    warnings: [...(data.warnings ?? []), ...warnings],
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runPreprocess(input: PreprocessInput): Promise<PreprocessResult> {
  const { methodId, params, doc, pymupdfServiceUrl } = input;

  let output: PreprocessOutput;

  switch (methodId) {
    case "plain-text":
      output = parsePlainText(doc.rawContent, {
        removeBoilerplate: params.removeBoilerplate,
        maxChars: params.maxChars,
      });
      break;

    case "markitdown":
      output = await parseMarkitdown(doc.rawContent, doc.buffer, doc.mimeType, {
        preserveHeadings: params.preserveHeadings,
        preserveTables: params.preserveTables,
        removeBoilerplate: params.removeBoilerplate,
        maxChars: params.maxChars,
      });
      break;

    case "pdf-pages":
      output = await parsePdfPages(doc.buffer, doc.mimeType, doc.rawContent, {
        pdfPageRange: params.pdfPageRange,
        maxChars: params.maxChars,
      });
      break;

    case "pymupdf":
      output = await callPymupdfService(
        doc.rawContent,
        doc.isBinary,
        doc.mimeType,
        pymupdfServiceUrl ?? "http://localhost:8001",
        {
          pageRange: params.pdfPageRange,
          preserveLayout: params.preserveLayout,
          extractImages: params.extractImages,
          maxChars: params.maxChars,
        },
      );
      break;

    case "markdown-structure":
    default:
      output = parseMarkdown(doc.rawContent, {
        preserveHeadings: params.preserveHeadings,
        removeBoilerplate: params.removeBoilerplate,
        maxChars: params.maxChars,
      });
      break;
  }

  // 统一注入 fileName/mimeType（各 method 内部不知道 fileName）
  output.metadata.fileName = doc.fileName;
  output.metadata.mimeType = doc.mimeType;

  return {
    output,
    trace: {
      method: methodId,
      isBinary: doc.isBinary,
      rawCharCount: doc.rawContent.length,
      cleanCharCount: output.cleanText.length,
      compressionRatio: (output.cleanText.length / Math.max(1, doc.rawContent.length)).toFixed(2),
      headingCount: output.metadata.headings?.length ?? 0,
      sourceRefCount: output.sourceRefs.length,
    },
    warnings: output.warnings,
  };
}
