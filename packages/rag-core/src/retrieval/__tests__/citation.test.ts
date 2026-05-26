import { describe, expect, it, vi } from "vitest";
import type {
  CitationInput,
  CitationParams,
  PgClient,
  RankedChunk,
} from "@harness/shared-types";
import { runCitation } from "../citation";

const defaultParams: CitationParams = {
  maxEvidencePerClaim: 3,
  includePage: true,
  snippetLength: 200,
  query: "",
  expansionMode: "section",
  connectionString: undefined,
};

function makeMatch(over: Partial<RankedChunk> = {}): RankedChunk {
  return {
    chunkId: "c1",
    documentId: "doc-1",
    version: 1,
    chunkIndex: 0,
    text: "产品支持 PDF 上传，便于知识库构建。",
    sourceRef: "产品介绍 > 核心功能",
    keywords: [],
    score: 0.9,
    retrievalMethod: "dense",
    filteredRank: 1,
    rerankScore: 0.85,
    originalRank: 1,
    newRank: 1,
    ...over,
  };
}

function makeInput(over: Partial<CitationInput> = {}): CitationInput {
  return {
    methodId: "chunk-citation",
    params: defaultParams,
    upstreamMatches: [makeMatch()],
    ...over,
  };
}

describe("runCitation - chunk-citation", () => {
  it("全文复制到 evidence.text", async () => {
    const r = await runCitation(makeInput());
    expect(r.output.evidencePack[0].text).toContain("PDF 上传");
    expect(r.output.totalEvidence).toBe(1);
  });

  it("evidenceId 格式：{docId}_v{ver}_c{idx}", async () => {
    const r = await runCitation(makeInput());
    expect(r.output.evidencePack[0].evidenceId).toBe("doc-1_v1_c0");
  });

  it("contextText 含 evidence-XXX 标注", async () => {
    const r = await runCitation(makeInput());
    expect(r.output.contextText).toContain("[evidence-001]");
    expect(r.output.contextText).toContain("产品介绍 > 核心功能");
  });

  it("maxEvidencePerClaim 限制 evidence 数量", async () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      makeMatch({ chunkId: `c${i}`, chunkIndex: i }),
    );
    const r = await runCitation(
      makeInput({
        upstreamMatches: matches,
        params: { ...defaultParams, maxEvidencePerClaim: 2 },
      }),
    );
    expect(r.output.totalEvidence).toBe(2);
  });
});

describe("runCitation - page-aware-citation", () => {
  it("从 '第N页' 提取页码", async () => {
    const r = await runCitation(
      makeInput({
        methodId: "page-aware-citation",
        upstreamMatches: [makeMatch({ sourceRef: "第3页 > 核心功能" })],
      }),
    );
    expect(r.output.evidencePack[0].pageNumber).toBe(3);
  });

  it("从 'page:N' 提取页码", async () => {
    const r = await runCitation(
      makeInput({
        methodId: "page-aware-citation",
        upstreamMatches: [makeMatch({ sourceRef: "page:7 > intro" })],
      }),
    );
    expect(r.output.evidencePack[0].pageNumber).toBe(7);
  });

  it("includePage=true 但无页码：warning", async () => {
    const r = await runCitation(
      makeInput({
        methodId: "page-aware-citation",
        upstreamMatches: [makeMatch({ sourceRef: "产品介绍 > 功能" })],
      }),
    );
    expect(r.output.evidencePack[0].pageNumber).toBeNull();
    expect(r.warnings.some((w) => w.includes("未从 sourceRef"))).toBe(true);
  });

  it("includePage=false：永远 pageNumber=null", async () => {
    const r = await runCitation(
      makeInput({
        methodId: "page-aware-citation",
        params: { ...defaultParams, includePage: false },
        upstreamMatches: [makeMatch({ sourceRef: "第3页" })],
      }),
    );
    expect(r.output.evidencePack[0].pageNumber).toBeNull();
  });
});

describe("runCitation - snippet-citation", () => {
  it("命中 query 关键词的位置作为 anchor", async () => {
    const longText = "前置内容".repeat(20) + "PDF 上传功能很方便" + "后续内容".repeat(20);
    const r = await runCitation(
      makeInput({
        methodId: "snippet-citation",
        params: { ...defaultParams, query: "PDF 上传", snippetLength: 50 },
        upstreamMatches: [makeMatch({ text: longText })],
      }),
    );
    expect(r.output.evidencePack[0].text).toContain("PDF 上传");
    expect(r.output.evidencePack[0].text.length).toBeLessThan(longText.length);
  });

  it("text 长度 ≤ snippetLength：原样返回不截", async () => {
    const r = await runCitation(
      makeInput({
        methodId: "snippet-citation",
        params: { ...defaultParams, query: "PDF", snippetLength: 1000 },
        upstreamMatches: [makeMatch({ text: "短文本" })],
      }),
    );
    expect(r.output.evidencePack[0].text).toBe("短文本");
  });

  it("query 为空：warning 提示退化为开头截取", async () => {
    const r = await runCitation(
      makeInput({
        methodId: "snippet-citation",
        upstreamMatches: [makeMatch({ text: "x".repeat(500) })],
      }),
    );
    expect(r.warnings.some((w) => w.includes("query 参数为空"))).toBe(true);
  });
});

describe("runCitation - section-citation (mock pgClient)", () => {
  it("section 模式：查同 sourceRef 全部 chunk 拼接", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        { chunk_index: 0, text: "第一段" },
        { chunk_index: 1, text: "第二段" },
        { chunk_index: 2, text: "第三段" },
      ],
      rowCount: 3,
    });
    const pgClient: PgClient = { query: mockQuery };

    const r = await runCitation(
      makeInput({
        methodId: "section-citation",
        params: { ...defaultParams, expansionMode: "section" },
        pgClient,
      }),
    );
    expect(r.output.evidencePack[0].text).toBe("第一段\n\n第二段\n\n第三段");
    expect(r.warnings.some((w) => w.includes("扩展为 3 个 chunk"))).toBe(true);
  });

  it("adjacent 模式：BETWEEN chunkIndex-1 AND chunkIndex+1", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        { chunk_index: 2, text: "前" },
        { chunk_index: 3, text: "中" },
        { chunk_index: 4, text: "后" },
      ],
      rowCount: 3,
    });
    const pgClient: PgClient = { query: mockQuery };

    await runCitation(
      makeInput({
        methodId: "section-citation",
        params: { ...defaultParams, expansionMode: "adjacent" },
        pgClient,
        upstreamMatches: [makeMatch({ chunkIndex: 3 })],
      }),
    );
    // 验证 SQL 参数：chunkIndex-1=2, chunkIndex+1=4
    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs).toContain(2);
    expect(callArgs).toContain(4);
  });

  it("section 模式去重：同 (documentId, sourceRef) 取分数最高", async () => {
    const matches = [
      makeMatch({ chunkId: "a", documentId: "d1", sourceRef: "X", rerankScore: 0.5 }),
      makeMatch({ chunkId: "b", documentId: "d1", sourceRef: "X", rerankScore: 0.9 }), // 同章节高分
      makeMatch({ chunkId: "c", documentId: "d1", sourceRef: "Y", rerankScore: 0.7 }),
    ];
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const pgClient: PgClient = { query: mockQuery };

    const r = await runCitation(
      makeInput({
        methodId: "section-citation",
        params: { ...defaultParams, expansionMode: "section", maxEvidencePerClaim: 10 },
        upstreamMatches: matches,
        pgClient,
      }),
    );
    expect(r.output.totalEvidence).toBe(2); // X 章节 + Y 章节
    expect(r.output.evidencePack[0].evidenceId).toBe("d1_v1_c0"); // b 的 chunkIndex（高分）
  });

  it("缺 pgClient：抛 missing_client", async () => {
    await expect(
      runCitation(makeInput({ methodId: "section-citation" })),
    ).rejects.toMatchObject({ code: "missing_client" });
  });
});

describe("runCitation - 错误路径", () => {
  it("空 matches：抛 empty_matches", async () => {
    await expect(
      runCitation(makeInput({ upstreamMatches: [] })),
    ).rejects.toMatchObject({ code: "empty_matches" });
  });
});

describe("runCitation - originalQuery 透传", () => {
  it("upstream originalQuery 优先于 params.query", async () => {
    const r = await runCitation(
      makeInput({
        params: { ...defaultParams, query: "params query" },
        originalQuery: "upstream query",
      }),
    );
    expect(r.output.originalQuery).toBe("upstream query");
  });
});
