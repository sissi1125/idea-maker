import { describe, expect, it, vi } from "vitest";
import type {
  OpenAICompatibleClient,
  PgClient,
  RetrievalInput,
  RetrievalParams,
} from "@harness/shared-types";
import { runRetrieval } from "../retrieval";

const defaultParams: RetrievalParams = {
  topK: 10,
  threshold: 0.5,
  embeddingProvider: "debug-deterministic",
  embeddingModel: "text-embedding-v4",
  embeddingDimension: 4,
  k1: 1.5,
  b: 0.75,
  connectionString: undefined,
  apiKey: undefined,
  baseUrl: undefined,
  teiEndpoint: undefined,
};

function makeRow(id: string, score: number, text = "测试文本") {
  return {
    id,
    document_id: "d1",
    version: 1,
    chunk_index: 0,
    text,
    source_ref: "章节A",
    keywords: [],
    score,
  };
}

function makeMockPgClient(routeFn: (sql: string) => unknown[]): {
  client: PgClient;
  queryFn: ReturnType<typeof vi.fn>;
} {
  const queryFn = vi.fn(async (sql: string) => {
    const rows = routeFn(sql);
    return { rows, rowCount: rows.length };
  });
  return { client: { query: queryFn } as PgClient, queryFn };
}

function makeInput(over: Partial<RetrievalInput> = {}): RetrievalInput {
  const { client } = makeMockPgClient(() => []);
  return {
    methodId: "dense-vector",
    params: defaultParams,
    queries: ["测试 query"],
    pgClient: client,
    projectId: "test-project",  // feat-200.8.x P0：必填，测试用 dummy 字符串
    ...over,
  };
}

describe("runRetrieval - dense-vector", () => {
  it("debug-deterministic：不需要 client，直接生成 query vector", async () => {
    const { client, queryFn } = makeMockPgClient((sql) => {
      if (sql.includes("FROM rag_chunks")) {
        return [makeRow("A", 0.85), makeRow("B", 0.72)];
      }
      return [];
    });

    const r = await runRetrieval(makeInput({ pgClient: client }));
    expect(r.output.matches).toHaveLength(2);
    expect(r.output.matches[0].score).toBe(0.85);
    expect(r.output.matches[0].retrievalMethod).toBe("dense");
    expect(queryFn).toHaveBeenCalled();
  });

  it("多 query：同 chunk 取最高分", async () => {
    let callCount = 0;
    const { client } = makeMockPgClient((sql) => {
      if (sql.includes("FROM rag_chunks")) {
        callCount++;
        return [
          makeRow("A", callCount === 1 ? 0.6 : 0.9), // 第二次更高
          makeRow("B", 0.5),
        ];
      }
      return [];
    });

    const r = await runRetrieval(
      makeInput({
        pgClient: client,
        queries: ["query1", "query2"],
      }),
    );
    expect(r.output.matches[0].chunkId).toBe("A");
    expect(r.output.matches[0].score).toBe(0.9);
  });

  it("openai provider 缺 client：missing_client", async () => {
    await expect(
      runRetrieval(
        makeInput({
          params: { ...defaultParams, embeddingProvider: "openai" },
        }),
      ),
    ).rejects.toMatchObject({ code: "missing_client" });
  });

  it("openai provider 有 client：调用 client.embeddings.create", async () => {
    const mockEmbed = vi.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3, 0.4], index: 0 }],
    });
    const openaiClient: OpenAICompatibleClient = {
      embeddings: { create: mockEmbed },
    };
    const { client } = makeMockPgClient((sql) => {
      if (sql.includes("FROM rag_chunks")) return [makeRow("A", 0.8)];
      return [];
    });

    const r = await runRetrieval(
      makeInput({
        params: { ...defaultParams, embeddingProvider: "openai" },
        pgClient: client,
        openaiClient,
      }),
    );
    expect(r.output.matches[0].chunkId).toBe("A");
    expect(mockEmbed).toHaveBeenCalledOnce();
  });

  it("hf-tei 缺 endpoint：missing_endpoint", async () => {
    await expect(
      runRetrieval(
        makeInput({
          params: { ...defaultParams, embeddingProvider: "hf-tei" },
        }),
      ),
    ).rejects.toMatchObject({ code: "missing_endpoint" });
  });

  it("hf-tei mock fetch：调 TEI /embed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[0.5, 0.5, 0.5, 0.5]],
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { client } = makeMockPgClient((sql) => {
        if (sql.includes("FROM rag_chunks")) return [makeRow("A", 0.7)];
        return [];
      });
      await runRetrieval(
        makeInput({
          params: { ...defaultParams, embeddingProvider: "hf-tei" },
          pgClient: client,
          hfTeiEndpoint: "http://localhost:8080/",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/embed", expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("runRetrieval - postgres-fulltext", () => {
  it("使用 ts_rank + plainto_tsquery", async () => {
    let sqlCaptured = "";
    const { client } = makeMockPgClient((sql) => {
      if (sql.includes("ts_rank")) {
        sqlCaptured = sql;
        return [makeRow("A", 0.4)];
      }
      return [];
    });

    const r = await runRetrieval(
      makeInput({ methodId: "postgres-fulltext", pgClient: client }),
    );
    expect(sqlCaptured).toContain("ts_rank");
    expect(sqlCaptured).toContain("plainto_tsquery");
    expect(r.output.matches[0].retrievalMethod).toBe("fulltext");
    expect(r.warnings.some((w) => w.includes("simple 字典"))).toBe(true);
  });
});

describe("runRetrieval - hybrid-rrf", () => {
  it("dense + fulltext 并行：RRF 融合，同 chunk 累加排名倒数", async () => {
    const { client } = makeMockPgClient((sql) => {
      if (sql.includes("embedding <=>")) {
        return [makeRow("A", 0.9), makeRow("B", 0.7)];
      }
      if (sql.includes("ts_rank")) {
        return [makeRow("B", 0.5), makeRow("C", 0.4)];
      }
      return [];
    });

    const r = await runRetrieval(
      makeInput({ methodId: "hybrid-rrf", pgClient: client }),
    );
    expect(r.output.matches.length).toBeGreaterThan(0);
    // B 在两路都出现，应排名靠前
    expect(r.output.matches[0].chunkId).toBe("B");
    expect(r.output.matches[0].retrievalMethod).toBe("hybrid");
  });
});

describe("runRetrieval - bm25-chinese", () => {
  it("候选 ILIKE → JS 计算 BM25 → 排序", async () => {
    const { client } = makeMockPgClient((sql) => {
      if (sql.includes("AVG(length(text))")) {
        return [{ n: "100", avgdl: "50" }];
      }
      if (sql.includes("ILIKE ANY")) {
        return [
          {
            id: "A",
            document_id: "d1",
            version: 1,
            chunk_index: 0,
            text: "产品支持文档上传，包括 PDF 和 Markdown",
            source_ref: "章节",
            keywords: [],
          },
          {
            id: "B",
            document_id: "d1",
            version: 1,
            chunk_index: 1,
            text: "完全不相关内容",
            source_ref: "章节",
            keywords: [],
          },
        ];
      }
      return [];
    });

    const r = await runRetrieval(
      makeInput({
        methodId: "bm25-chinese",
        pgClient: client,
        queries: ["产品 PDF 上传"],
      }),
    );
    expect(r.output.matches.length).toBeGreaterThan(0);
    expect(r.output.matches[0].chunkId).toBe("A");
    expect(r.output.matches[0].retrievalMethod).toBe("bm25");
  });

  it("query 分词后无 term：返回空", async () => {
    const { client, queryFn } = makeMockPgClient(() => []);
    const r = await runRetrieval(
      makeInput({
        methodId: "bm25-chinese",
        pgClient: client,
        queries: ["a"], // 短词被 minLength 过滤
      }),
    );
    expect(r.output.matches).toEqual([]);
    // 应该没调 DB（terms 为空，提前 return）
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("候选为空（ILIKE 命中 0 行）：返回空 + warning", async () => {
    const { client } = makeMockPgClient((sql) => {
      if (sql.includes("AVG(length(text))")) return [{ n: "0", avgdl: "0" }];
      return [];
    });

    const r = await runRetrieval(
      makeInput({
        methodId: "bm25-chinese",
        pgClient: client,
        queries: ["完全不存在的 query"],
      }),
    );
    expect(r.output.matches).toEqual([]);
    expect(r.warnings.some((w) => w.includes("未检索到结果"))).toBe(true);
  });
});

describe("runRetrieval - 错误路径", () => {
  it("缺 pgClient：missing_client", async () => {
    await expect(
      runRetrieval(makeInput({ pgClient: undefined as unknown as PgClient })),
    ).rejects.toMatchObject({ code: "missing_client" });
  });

  it("空 queries：empty_queries", async () => {
    await expect(runRetrieval(makeInput({ queries: [] }))).rejects.toMatchObject({
      code: "empty_queries",
    });
  });
});

describe("runRetrieval - trace + 透传", () => {
  it("trace 含 methodId / queryCount / matchCount / dimension", async () => {
    const { client } = makeMockPgClient((sql) => {
      if (sql.includes("FROM rag_chunks")) return [makeRow("A", 0.7)];
      return [];
    });
    const r = await runRetrieval(
      makeInput({
        pgClient: client,
        queries: ["q1", "q2"],
      }),
    );
    expect(r.trace.methodId).toBe("dense-vector");
    expect(r.trace.queryCount).toBe(2);
    expect(r.trace.matchCount).toBe(1);
    expect(r.trace.dimension).toBe(4);
  });

  it("originalQuery = queries[0]", async () => {
    const r = await runRetrieval(makeInput({ queries: ["第一个查询", "第二个"] }));
    expect(r.output.originalQuery).toBe("第一个查询");
  });
});
