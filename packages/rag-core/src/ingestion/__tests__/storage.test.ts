import { describe, expect, it, vi } from "vitest";
import type {
  EmbeddedChunk,
  PgClient,
  StorageInput,
  StorageParams,
} from "@harness/shared-types";
import { runStorage } from "../storage";
import { PipelineError } from "../../errors";

const defaultParams: StorageParams = {
  indexMode: "none", // 默认 none，避免触发索引创建路径
  conflictPolicy: "upsert",
  truncateTable: false,
  connectionString: undefined,
};

function makeChunk(over: Partial<EmbeddedChunk> = {}): EmbeddedChunk {
  return {
    index: 0,
    text: "测试 chunk",
    charStart: 0,
    charEnd: 8,
    charCount: 8,
    tokenEstimate: 4,
    sourceRef: "章节A",
    embedding: [0.1, 0.2, 0.3, 0.4],
    embeddingDimension: 4,
    ...over,
  };
}

/**
 * 创建一个可编程的 mock PgClient。
 * routeFn 接收 SQL 文本，返回该 SQL 的 mock 结果（rows 列表）。
 */
function makeMockClient(
  routeFn: (sql: string, params?: ReadonlyArray<unknown>) => unknown[],
): {
  client: PgClient;
  queryFn: ReturnType<typeof vi.fn>;
} {
  const queryFn = vi.fn(async (sql: string, params?: ReadonlyArray<unknown>) => {
    const rows = routeFn(sql, params);
    return { rows, rowCount: rows.length };
  });
  return { client: { query: queryFn } as PgClient, queryFn };
}

/** 标准默认路由：空表 + 无现有索引 + count=0 */
function defaultRoute(sql: string): unknown[] {
  if (sql.includes("SELECT embedding_dimension FROM rag_chunks")) return [];
  if (sql.includes("SELECT indexname FROM pg_indexes")) return [];
  if (sql.includes("COUNT(*)")) return [{ cnt: "0" }];
  if (sql.includes("SELECT MAX(version)")) return [{ max_version: null }];
  return [];
}

function makeInput(over: Partial<StorageInput> = {}): StorageInput {
  const { client } = makeMockClient(defaultRoute);
  return {
    methodId: "pgvector-upsert-version",
    params: defaultParams,
    upstreamChunks: [makeChunk()],
    dimension: 4,
    documentId: "doc-1",
    pgClient: client,
    ...over,
  };
}

describe("runStorage - 3 个 method 各自的 version 决定逻辑", () => {
  it("pgvector-upsert-version：用现有 max(version) 或 1", async () => {
    const queries: string[] = [];
    const { client, queryFn } = makeMockClient((sql) => {
      queries.push(sql);
      if (sql.includes("SELECT embedding_dimension")) return [];
      if (sql.includes("pg_indexes")) return [];
      if (sql.includes("SELECT MAX(version)")) return [{ max_version: 3 }];
      return [];
    });
    const r = await runStorage(makeInput({ pgClient: client }));
    expect(r.output.version).toBe(3);
    expect(queryFn).toHaveBeenCalled();
  });

  it("pgvector-new-version：max(version) + 1", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("SELECT embedding_dimension")) return [];
      if (sql.includes("pg_indexes")) return [];
      if (sql.includes("SELECT MAX(version)")) return [{ max_version: 2 }];
      return [];
    });
    const r = await runStorage(makeInput({ methodId: "pgvector-new-version", pgClient: client }));
    expect(r.output.version).toBe(3);
  });

  it("pgvector-new-version 首次入库：version = 1", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("SELECT embedding_dimension")) return [];
      if (sql.includes("pg_indexes")) return [];
      if (sql.includes("SELECT MAX(version)")) return [{ max_version: null }];
      return [];
    });
    const r = await runStorage(makeInput({ methodId: "pgvector-new-version", pgClient: client }));
    expect(r.output.version).toBe(1);
  });

  it("pgvector-replace-version：先 DELETE 再 INSERT version=1", async () => {
    const queries: string[] = [];
    const { client } = makeMockClient((sql) => {
      queries.push(sql);
      return defaultRoute(sql);
    });
    const r = await runStorage(
      makeInput({ methodId: "pgvector-replace-version", pgClient: client }),
    );
    expect(r.output.version).toBe(1);
    expect(queries.some((q) => q.includes("DELETE FROM rag_chunks WHERE document_id"))).toBe(true);
  });
});

describe("runStorage - Dimension Guard", () => {
  it("表中已有维度 1536，本次写入 4：抛 dimension_mismatch", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("SELECT embedding_dimension")) {
        return [{ embedding_dimension: 1536 }];
      }
      return defaultRoute(sql);
    });
    await expect(runStorage(makeInput({ pgClient: client }))).rejects.toMatchObject({
      code: "dimension_mismatch",
    });
  });

  it("表中维度与本次一致：通过", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("SELECT embedding_dimension")) {
        return [{ embedding_dimension: 4 }];
      }
      return defaultRoute(sql);
    });
    const r = await runStorage(makeInput({ pgClient: client }));
    expect(r.output.freshTable).toBe(false); // 已有数据
  });

  it("空表（first write）：freshTable=true", async () => {
    const r = await runStorage(makeInput());
    expect(r.output.freshTable).toBe(true);
  });
});

describe("runStorage - truncateTable", () => {
  it("truncateTable=true：执行 TRUNCATE + DROP INDEX + ALTER COLUMN", async () => {
    const queries: string[] = [];
    const { client } = makeMockClient((sql) => {
      queries.push(sql);
      return defaultRoute(sql);
    });
    const r = await runStorage(
      makeInput({
        params: { ...defaultParams, truncateTable: true },
        pgClient: client,
      }),
    );
    expect(queries.some((q) => q.includes("TRUNCATE TABLE rag_chunks"))).toBe(true);
    expect(queries.some((q) => q.includes("DROP INDEX IF EXISTS"))).toBe(true);
    expect(queries.some((q) => q.includes("ALTER TABLE rag_chunks ALTER COLUMN embedding TYPE vector"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("已清空"))).toBe(true);
    expect(r.output.freshTable).toBe(true);
  });

  it("truncateTable=true 跳过 Dimension Guard（已清空）", async () => {
    // 即使旧维度不匹配，truncate 后也应通过
    const { client } = makeMockClient((sql) => {
      if (sql.includes("SELECT embedding_dimension")) {
        // truncate 后查询返回空，符合实际行为
        return [];
      }
      return defaultRoute(sql);
    });
    const r = await runStorage(
      makeInput({
        params: { ...defaultParams, truncateTable: true },
        dimension: 1024,
        pgClient: client,
      }),
    );
    expect(r.output.dimension).toBe(1024);
  });
});

describe("runStorage - 索引模式", () => {
  it("indexMode=none：不建索引 + warning", async () => {
    const r = await runStorage(
      makeInput({ params: { ...defaultParams, indexMode: "none" } }),
    );
    expect(r.output.indexCreated).toBe(false);
    expect(r.warnings.some((w) => w.includes("indexMode=none"))).toBe(true);
  });

  it("indexMode=hnsw + 表无现有索引：CREATE INDEX HNSW", async () => {
    const queries: string[] = [];
    const { client } = makeMockClient((sql) => {
      queries.push(sql);
      return defaultRoute(sql);
    });
    const r = await runStorage(
      makeInput({
        params: { ...defaultParams, indexMode: "hnsw" },
        pgClient: client,
      }),
    );
    expect(r.output.indexCreated).toBe(true);
    expect(queries.some((q) => q.includes("USING hnsw"))).toBe(true);
    expect(queries.some((q) => q.includes("ALTER COLUMN embedding TYPE vector(4)"))).toBe(true);
  });

  it("indexMode=ivfflat：CREATE INDEX IVFFlat 含 lists 参数", async () => {
    const queries: string[] = [];
    const { client } = makeMockClient((sql) => {
      queries.push(sql);
      if (sql.includes("COUNT(*)")) return [{ cnt: "100" }];
      return defaultRoute(sql);
    });
    const r = await runStorage(
      makeInput({
        params: { ...defaultParams, indexMode: "ivfflat" },
        pgClient: client,
      }),
    );
    expect(r.output.indexCreated).toBe(true);
    expect(queries.some((q) => q.includes("USING ivfflat"))).toBe(true);
    expect(queries.some((q) => q.includes("WITH (lists"))).toBe(true);
  });

  it("表已有索引：skip + 不重复创建 + warning", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("pg_indexes")) {
        return [{ indexname: "idx_rag_chunks_embedding_hnsw" }];
      }
      return defaultRoute(sql);
    });
    const r = await runStorage(
      makeInput({
        params: { ...defaultParams, indexMode: "hnsw" },
        pgClient: client,
      }),
    );
    expect(r.output.indexCreated).toBe(false);
    expect(r.warnings.some((w) => w.includes("索引已存在"))).toBe(true);
  });
});

describe("runStorage - 错误路径", () => {
  it("缺 pgClient：抛 missing_client", async () => {
    await expect(
      runStorage(makeInput({ pgClient: undefined as unknown as PgClient })),
    ).rejects.toMatchObject({ code: "missing_client" });
  });

  it("空 upstreamChunks：抛 empty_chunks", async () => {
    await expect(
      runStorage(makeInput({ upstreamChunks: [] })),
    ).rejects.toMatchObject({ code: "empty_chunks" });
  });

  it("dimension_mismatch error 含 details（existingDimension / incomingDimension）", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("SELECT embedding_dimension")) {
        return [{ embedding_dimension: 1536 }];
      }
      return defaultRoute(sql);
    });
    try {
      await runStorage(makeInput({ dimension: 4, pgClient: client }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineError);
      expect((e as PipelineError).details).toMatchObject({
        existingDimension: 1536,
        incomingDimension: 4,
      });
    }
  });
});

describe("runStorage - INSERT 语句生成", () => {
  it("upsert：INSERT ON CONFLICT DO UPDATE", async () => {
    const queries: string[] = [];
    const { client } = makeMockClient((sql) => {
      queries.push(sql);
      return defaultRoute(sql);
    });
    await runStorage(makeInput({ pgClient: client }));
    const insertSql = queries.find((q) => q.includes("INSERT INTO rag_chunks"));
    expect(insertSql).toBeDefined();
    expect(insertSql).toContain("ON CONFLICT");
    expect(insertSql).toContain("DO UPDATE");
  });

  it("conflictPolicy=error：裸 INSERT，无 ON CONFLICT 子句", async () => {
    const queries: string[] = [];
    const { client } = makeMockClient((sql) => {
      queries.push(sql);
      return defaultRoute(sql);
    });
    await runStorage(
      makeInput({
        params: { ...defaultParams, conflictPolicy: "error" },
        pgClient: client,
      }),
    );
    const insertSql = queries.find((q) => q.includes("INSERT INTO rag_chunks"));
    expect(insertSql).toBeDefined();
    expect(insertSql).not.toContain("ON CONFLICT");
  });

  it("INSERT 参数包含 enhancedText（transform 启用）+ fallback 到 text（未启用）", async () => {
    const calls: ReadonlyArray<unknown>[] = [];
    const { client } = makeMockClient((sql, params) => {
      if (sql.includes("INSERT INTO rag_chunks")) calls.push(params!);
      return defaultRoute(sql);
    });
    await runStorage(
      makeInput({
        upstreamChunks: [
          makeChunk({ index: 0, text: "原文", enhancedText: "增强" }),
          makeChunk({ index: 1, text: "无增强" }),
        ],
        pgClient: client,
      }),
    );
    // INSERT params 位置 6 是 enhanced_text
    expect(calls[0]?.[5]).toBe("增强");
    expect(calls[1]?.[5]).toBe("无增强");
  });
});
