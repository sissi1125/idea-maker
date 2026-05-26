/**
 * RAG Pipeline Stage - Citation - 纯算法 + section 模式注入 pgClient
 *
 * 4 method：
 *   chunk-citation        全文引用
 *   page-aware-citation   从 sourceRef 提取页码
 *   snippet-citation      关键词窗口截取
 *   section-citation      pg 反查同 sourceRef / 相邻 chunk 扩展上下文
 *                         路由层创建 pg.Client 并 connect 后注入到 Input.pgClient
 */

import type {
  CitationInput,
  CitationOutput,
  CitationResult,
  EvidenceItem,
  PgClient,
  RankedChunk,
} from "@harness/shared-types";
import { PipelineError } from "../errors";
import { tokenize } from "../util/nlp";

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function chunkToEvidenceId(m: RankedChunk): string {
  return `${m.documentId}_v${m.version}_c${m.chunkIndex}`;
}

/** 从 sourceRef 提取页码：支持"第N页"和"page:N"两种格式 */
function extractPageNumber(sourceRef: string): number | null {
  const m1 = sourceRef.match(/第\s*(\d+)\s*页/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = sourceRef.match(/(?:page|p)[.:\s]*(\d+)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

/**
 * 窗口截取：找第一个 query 关键词位置，前后取 snippetLength/2。
 * 边界加省略号。
 */
function extractSnippet(text: string, query: string, snippetLength: number): string {
  if (text.length <= snippetLength) return text;

  const qTokens = tokenize(query, true, 2);

  let anchorPos = 0;
  for (const token of qTokens) {
    const idx = text.toLowerCase().indexOf(token.toLowerCase());
    if (idx >= 0) {
      anchorPos = idx;
      break;
    }
  }

  const half = Math.floor(snippetLength / 2);
  let start = Math.max(0, anchorPos - half);
  const end = Math.min(text.length, start + snippetLength);
  if (end - start < snippetLength) start = Math.max(0, end - snippetLength);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

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

function buildChunkCitation(matches: RankedChunk[], maxEvidence: number): CitationOutput {
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
  maxEvidence: number,
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
    warnings.push(
      "未从 sourceRef 中提取到任何页码信息；页码提取依赖 preprocess 阶段在 sourceRef 中写入 '第N页' 或 'page:N' 格式",
    );
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
  maxEvidence: number,
): CitationOutput {
  const evidencePack: EvidenceItem[] = matches.slice(0, maxEvidence).map((m) => {
    const snippet = extractSnippet(m.text, query, snippetLength);
    return {
      evidenceId: chunkToEvidenceId(m),
      text: snippet,
      sourceRef: m.sourceRef,
      documentId: m.documentId,
      version: m.version,
      chunkIndex: m.chunkIndex,
      pageNumber: includePage ? extractPageNumber(m.sourceRef) : null,
      score: m.rerankScore,
      snippet,
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

// ─── section-citation（pg 反查上下文扩展）────────────────────────────────────

/**
 * 反查 DB 取兄弟 chunk 拼成扩展上下文。等价 parent-child chunking 不改 schema。
 *
 * 两种模式：
 *   adjacent — chunk_index ±1（折中节省 token）
 *   section  — 同 source_ref 全部 chunk（完整章节）
 *
 * 去重：section 模式按 (documentId, sourceRef) 去重，保留分数最高的 chunk 作 evidenceId
 */
async function buildSectionCitation(
  matches: RankedChunk[],
  maxEvidence: number,
  expansionMode: "adjacent" | "section",
  pgClient: PgClient,
): Promise<CitationOutput> {
  const warnings: string[] = [];

  let sourceList: RankedChunk[];
  if (expansionMode === "section") {
    const bestPerSection = new Map<string, RankedChunk>();
    for (const m of matches) {
      const key = `${m.documentId}::${m.sourceRef}`;
      const existing = bestPerSection.get(key);
      if (!existing || m.rerankScore > existing.rerankScore) {
        bestPerSection.set(key, m);
      }
    }
    sourceList = [...bestPerSection.values()]
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, maxEvidence);
  } else {
    sourceList = matches.slice(0, maxEvidence);
  }

  const evidencePack: EvidenceItem[] = [];

  for (const m of sourceList) {
    let expandedText = m.text;
    let chunkCount = 1;

    if (expansionMode === "adjacent") {
      const result = await pgClient.query<{ chunk_index: number; text: string }>(
        `SELECT chunk_index, text FROM rag_chunks
         WHERE document_id = $1 AND version = $2
           AND chunk_index BETWEEN $3 AND $4
         ORDER BY chunk_index ASC`,
        [m.documentId, m.version, m.chunkIndex - 1, m.chunkIndex + 1],
      );
      if (result.rows.length > 0) {
        expandedText = result.rows.map((r) => r.text).join("\n\n");
        chunkCount = result.rows.length;
      }
    } else {
      const result = await pgClient.query<{ chunk_index: number; text: string }>(
        `SELECT chunk_index, text FROM rag_chunks
         WHERE document_id = $1 AND version = $2
           AND source_ref = $3
         ORDER BY chunk_index ASC`,
        [m.documentId, m.version, m.sourceRef],
      );
      if (result.rows.length > 0) {
        expandedText = result.rows.map((r) => r.text).join("\n\n");
        chunkCount = result.rows.length;
      } else {
        warnings.push(
          `chunk ${m.chunkId} 的 sourceRef "${m.sourceRef}" 在 DB 里未找到匹配章节，降级为原 chunk 文本`,
        );
      }
    }

    evidencePack.push({
      evidenceId: chunkToEvidenceId(m),
      text: expandedText,
      sourceRef: m.sourceRef,
      documentId: m.documentId,
      version: m.version,
      chunkIndex: m.chunkIndex,
      pageNumber: extractPageNumber(m.sourceRef),
      score: m.rerankScore,
    });

    if (chunkCount > 1) {
      warnings.push(`evidence ${chunkToEvidenceId(m)}: ${expansionMode} 模式扩展为 ${chunkCount} 个 chunk`);
    }
  }

  return {
    evidencePack,
    totalEvidence: evidencePack.length,
    method: "section-citation",
    contextText: buildContextText(evidencePack),
    warnings,
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runCitation(input: CitationInput): Promise<CitationResult> {
  const { methodId, params, upstreamMatches, originalQuery, pgClient } = input;

  if (!upstreamMatches || upstreamMatches.length === 0) {
    throw new PipelineError("empty_matches", "Rerank 未产出任何 chunk");
  }

  const maxEvidence = params.maxEvidencePerClaim;
  // 上游 rerank.originalQuery 优先于 params.query
  const query = (originalQuery ?? params.query).trim();

  let result: CitationOutput;

  switch (methodId) {
    case "page-aware-citation":
      result = buildPageAwareCitation(upstreamMatches, params.includePage, maxEvidence);
      break;
    case "snippet-citation":
      result = buildSnippetCitation(
        upstreamMatches,
        query,
        params.snippetLength,
        params.includePage,
        maxEvidence,
      );
      break;
    case "section-citation": {
      if (!pgClient) {
        throw new PipelineError(
          "missing_client",
          "section-citation 需要注入 pg.Client；路由层应创建并 connect 后传入 Input.pgClient",
        );
      }
      result = await buildSectionCitation(upstreamMatches, maxEvidence, params.expansionMode, pgClient);
      break;
    }
    case "chunk-citation":
    default:
      result = buildChunkCitation(upstreamMatches, maxEvidence);
      break;
  }

  return {
    output: { ...result, originalQuery: query || undefined },
    trace: {
      methodId,
      inputMatches: upstreamMatches.length,
      evidenceCount: result.totalEvidence,
      contextLength: result.contextText.length,
      avgEvidenceLength:
        result.evidencePack.length > 0
          ? Math.round(result.contextText.length / result.evidencePack.length)
          : 0,
    },
    warnings: result.warnings,
  };
}
