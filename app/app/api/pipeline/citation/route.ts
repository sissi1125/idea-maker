/**
 * RAG Pipeline Stage — Citation（引用构建）
 *
 * 作用：将重排后的 chunk 转换为可直接传给 LLM 的 evidence pack，
 *       每条 evidence 包含标准化的引用格式（来源、页码、片段），
 *       让 LLM 生成时能准确标注 "据文档第X页" 或 "来自XXX章节"。
 *
 * Pipeline 位置：
 *   Rerank → [Citation] → Prompt Build → Generation
 *
 * 三种方法：
 *
 *   chunk-citation        全文引用：把 chunk 原文完整传给 LLM
 *                         最完整，但 token 消耗大；适合 chunk 较短（< 200 tokens）的场景
 *
 *   page-aware-citation   从 sourceRef 和 metadata 中提取页码信息
 *                         适合 PDF 文档（preprocess 阶段提取了 page number）
 *
 *   snippet-citation      从 chunk 中提取包含关键词的最相关片段（窗口截取）
 *                         压缩 token 消耗，适合长 chunk；牺牲一定完整性
 *
 * Evidence Pack 格式：
 *   LLM 接收 evidence 时可以引用 evidenceId，生成结果里的 citation 字段包含 evidenceId 列表，
 *   便于后端追溯到原始 chunk 和文档来源（这是"evidence first"原则的落地）。
 */

import { NextRequest, NextResponse } from "next/server";
import type { RerankOutput, RankedChunk } from "../rerank/route";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface EvidenceItem {
  /** 稳定 ID，格式：{documentId}_v{version}_c{chunkIndex} */
  evidenceId: string;
  /** 引用文本：根据方法不同，可能是全文、摘要片段或截断文本 */
  text: string;
  /** 章节路径，例如 "产品介绍 > 核心功能" */
  sourceRef: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  /** 页码（page-aware-citation 提取；无法提取时为 null） */
  pageNumber: number | null;
  /** 原始 rerank 分数，LLM 可用于判断 evidence 可信度 */
  score: number;
  /** 截取的片段（snippet-citation 方法专用） */
  snippet?: string;
}

export interface CitationOutput {
  evidencePack: EvidenceItem[];
  totalEvidence: number;
  method: string;
  /** 供 Prompt Build 阶段直接拼接的 context 字符串（含 evidenceId 标注） */
  contextText: string;
  warnings: string[];
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function chunkToEvidenceId(m: RankedChunk): string {
  return `${m.documentId}_v${m.version}_c${m.chunkIndex}`;
}

/**
 * 从 sourceRef 中提取页码。
 * sourceRef 格式示例："第3页 > 核心功能" 或 "page:3 > 功能介绍"
 * 匹配 "第N页" 或 "page:N" 或 "p.N" 模式。
 */
function extractPageNumber(sourceRef: string): number | null {
  const m1 = sourceRef.match(/第\s*(\d+)\s*页/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = sourceRef.match(/(?:page|p)[.:\s]*(\d+)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

/**
 * 窗口截取：在 text 中找到第一个 query 关键词的出现位置，
 * 以该位置为中心截取长度为 snippetLength 的片段，保持句子边界。
 */
function extractSnippet(text: string, query: string, snippetLength: number): string {
  if (text.length <= snippetLength) return text;

  const qTokens = query
    .split(/[\s，。？！、；：\?!,.:;()\n]+/)
    .filter((t) => t.length >= 2);

  // 找第一个关键词出现的位置
  let anchorPos = 0;
  for (const token of qTokens) {
    const idx = text.toLowerCase().indexOf(token.toLowerCase());
    if (idx >= 0) { anchorPos = idx; break; }
  }

  // 以 anchorPos 为中心，向前后各取 snippetLength/2
  const half = Math.floor(snippetLength / 2);
  let start = Math.max(0, anchorPos - half);
  const end = Math.min(text.length, start + snippetLength);
  if (end - start < snippetLength) start = Math.max(0, end - snippetLength);

  let snippet = text.slice(start, end);
  // 前后加省略号（如果不是句子起点/终点）
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

/**
 * 构建供 LLM 使用的 context 字符串。
 * 格式：
 *   [evidence-001] 来源：产品介绍 > 核心功能
 *   支持多格式上传，包括 Markdown...
 *   ---
 */
function buildContextText(evidencePack: EvidenceItem[]): string {
  return evidencePack
    .map((e, idx) => {
      const id = `evidence-${String(idx + 1).padStart(3, "0")}`;
      const pageNote = e.pageNumber ? ` (第${e.pageNumber}页)` : "";
      return `[${id}] 来源：${e.sourceRef}${pageNote}\n${e.text}`;
    })
    .join("\n---\n");
}

// ─── chunk-citation ───────────────────────────────────────────────────────────

function buildChunkCitation(
  matches: RankedChunk[],
  maxEvidence: number
): CitationOutput {
  const evidencePack: EvidenceItem[] = matches.slice(0, maxEvidence).map((m) => ({
    evidenceId: chunkToEvidenceId(m),
    text: m.text,
    sourceRef: m.sourceRef,
    documentId: m.documentId,
    version: m.version,
    chunkIndex: m.chunkIndex,
    pageNumber: extractPageNumber(m.sourceRef),
    score: m.rerankScore,
  }));

  return {
    evidencePack,
    totalEvidence: evidencePack.length,
    method: "chunk-citation",
    contextText: buildContextText(evidencePack),
    warnings: [],
  };
}

// ─── page-aware-citation ──────────────────────────────────────────────────────

function buildPageAwareCitation(
  matches: RankedChunk[],
  includePage: boolean,
  maxEvidence: number
): CitationOutput {
  const warnings: string[] = [];
  const evidencePack: EvidenceItem[] = matches.slice(0, maxEvidence).map((m) => {
    const pageNumber = extractPageNumber(m.sourceRef);
    return {
      evidenceId: chunkToEvidenceId(m),
      text: m.text,
      sourceRef: m.sourceRef,
      documentId: m.documentId,
      version: m.version,
      chunkIndex: m.chunkIndex,
      pageNumber: includePage ? pageNumber : null,
      score: m.rerankScore,
    };
  });

  const withPage = evidencePack.filter((e) => e.pageNumber !== null).length;
  if (includePage && withPage === 0) {
    warnings.push("未从 sourceRef 中提取到任何页码信息；页码提取依赖 preprocess 阶段在 sourceRef 中写入 '第N页' 或 'page:N' 格式");
  }

  return {
    evidencePack,
    totalEvidence: evidencePack.length,
    method: "page-aware-citation",
    contextText: buildContextText(evidencePack),
    warnings,
  };
}

// ─── snippet-citation ─────────────────────────────────────────────────────────

function buildSnippetCitation(
  matches: RankedChunk[],
  query: string,
  snippetLength: number,
  includePage: boolean,
  maxEvidence: number
): CitationOutput {
  const evidencePack: EvidenceItem[] = matches.slice(0, maxEvidence).map((m) => {
    const snippet = extractSnippet(m.text, query, snippetLength);
    return {
      evidenceId: chunkToEvidenceId(m),
      text: snippet,        // snippet 作为主要 text（压缩 token）
      sourceRef: m.sourceRef,
      documentId: m.documentId,
      version: m.version,
      chunkIndex: m.chunkIndex,
      pageNumber: includePage ? extractPageNumber(m.sourceRef) : null,
      score: m.rerankScore,
      snippet,              // 同时保留 snippet 字段
    };
  });

  return {
    evidencePack,
    totalEvidence: evidencePack.length,
    method: "snippet-citation",
    contextText: buildContextText(evidencePack),
    warnings: query ? [] : ["query 参数为空，snippet 截取退化为从文本开头截取"],
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown>; upstreamOutput: RerankOutput | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Rerank 产物，请先运行 Rerank Stage" } },
      { status: 400 }
    );
  }

  const matches = upstreamOutput.rankedMatches ?? [];
  if (matches.length === 0) {
    return NextResponse.json({ error: { code: "empty_matches", message: "Rerank 未产出任何 chunk" } }, { status: 400 });
  }

  const maxEvidence = Number(params.maxEvidencePerClaim ?? 3);
  const query = String(params.query ?? "").trim();

  let result: CitationOutput;

  switch (methodId) {
    case "chunk-citation":
      result = buildChunkCitation(matches, maxEvidence);
      break;
    case "page-aware-citation":
      result = buildPageAwareCitation(matches, Boolean(params.includePage ?? true), maxEvidence);
      break;
    case "snippet-citation":
      result = buildSnippetCitation(matches, query, Number(params.snippetLength ?? 200), Boolean(params.includePage ?? false), maxEvidence);
      break;
    default:
      return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
  }

  return NextResponse.json({
    output: result,
    trace: {
      methodId,
      inputMatches: matches.length,
      evidenceCount: result.totalEvidence,
      contextLength: result.contextText.length,
      durationMs: Date.now() - startMs,
    },
    durationMs: Date.now() - startMs,
    warnings: result.warnings,
  });
}
