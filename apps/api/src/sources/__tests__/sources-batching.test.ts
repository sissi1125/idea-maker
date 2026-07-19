import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcesService } from "../sources.service";

type RagCandidate = { pageId: string; url: string; chunks: string[] };
type EmbedInvoker = {
  embedIntoRag(projectId: string, candidates: RagCandidate[]): Promise<number>;
};

describe("SourcesService 官网 RAG 批处理", () => {
  const originalEnv = { ...process.env };
  const query = vi.fn();
  const withClient = vi.fn(async (fn: (client: { query: typeof query }) => Promise<unknown>) =>
    fn({ query }),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMBEDDING_API_KEY = "test-key";
    process.env.EMBEDDING_BASE_URL = "https://embedding.test/v1/";
    process.env.EMBEDDING_MODEL = "text-embedding-v4";
    process.env.EMBEDDING_DIMENSION = "3";
    process.env.WEBSITE_EMBEDDING_BATCH_SIZE = "2";
    process.env.WEBSITE_RAG_INSERT_BATCH_SIZE = "3";
    query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  /** 构造只测试 embedding/RAG 写入路径的 service，官网抓取与资产模块不参与。 */
  function makeService(): EmbedInvoker {
    return new SourcesService(
      { withClient } as never,
      {} as never,
    ) as unknown as EmbedInvoker;
  }

  it("按配置批量请求 embedding，并用同一连接批量写库", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      // 故意逆序返回，验证实现按 provider index 对齐原 chunk。
      const data = body.input
        .map((_, index) => ({ index, embedding: [index + 1, index + 2, index + 3] }))
        .reverse();
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const count = await makeService().embedIntoRag("project-1", [
      { pageId: "page-1", url: "https://example.com", chunks: ["一", "二", "三"] },
      { pageId: "page-2", url: "https://example.com/docs", chunks: ["四", "五"] },
    ]);

    expect(count).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(withClient).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2); // 3 + 2 rows
    expect(query.mock.calls[0][1]).toHaveLength(3 * 8);
    expect(query.mock.calls[1][1]).toHaveLength(2 * 8);
    expect(query.mock.calls[0][1][6]).toBe("[1,2,3]");
    expect(query.mock.calls[0][1][14]).toBe("[2,3,4]");
  });

  it("无 embedding key 时不发网络请求，正文仍批量写入 NULL 向量", async () => {
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await makeService().embedIntoRag("project-1", [
      { pageId: "page-1", url: "https://example.com", chunks: ["一", "二"] },
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
    expect(params[14]).toBeNull();
    expect(params[15]).toBeNull();
  });

  it("维度错误只让对应 chunk 降级，不影响同批有效向量", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        data: [
          { index: 0, embedding: [1, 2] },
          { index: 1, embedding: [3, 4, 5] },
        ],
      }), { status: 200 }),
    ));

    await makeService().embedIntoRag("project-1", [
      { pageId: "page-1", url: "https://example.com", chunks: ["错误", "正确"] },
    ]);

    const params = query.mock.calls[0][1] as unknown[];
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
    expect(params[14]).toBe("[3,4,5]");
    expect(params[15]).toBe(3);
  });

  it("批量向量 INSERT 失败后以整批 NULL 向量重试", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ index: 0, embedding: [1, 2, 3] }],
      }), { status: 200 }),
    ));
    query.mockRejectedValueOnce(new Error("vector dimension mismatch"));
    query.mockResolvedValueOnce({ rows: [] });

    await makeService().embedIntoRag("project-1", [
      { pageId: "page-1", url: "https://example.com", chunks: ["正文"] },
    ]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][6]).toBe("[1,2,3]");
    expect(query.mock.calls[1][1][6]).toBeNull();
    expect(query.mock.calls[1][1][7]).toBeNull();
  });
});
