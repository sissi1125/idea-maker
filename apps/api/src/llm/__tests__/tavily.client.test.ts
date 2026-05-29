/**
 * TavilyClient 单测
 *
 * 重点验证：缺 key 降级 / 缓存命中 / TTL 失效 / 错误分类。
 * 用 vi.stubGlobal 拦截 fetch，不真实调外网。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TavilyClient } from "../tavily.client";

describe("TavilyClient", () => {
  let client: TavilyClient;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    client = new TavilyClient();
    originalEnv = { ...process.env };
    delete process.env.TAVILY_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("缺 TAVILY_API_KEY 时返回 unavailable，不抛错", async () => {
    const out = await client.search({ query: "小红书 卖点" });
    expect(out.status).toBe("unavailable");
    if (out.status === "unavailable") {
      expect(out.message).toMatch(/TAVILY_API_KEY/);
    }
  });

  it("成功返回结果并缓存；第二次同 query 命中 cache 且不再 fetch", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: "T1", url: "https://x.com", content: "C1", score: 0.9 }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await client.search({ query: "竞品分析" });
    expect(first.status).toBe("ok");
    if (first.status === "ok") {
      expect(first.source).toBe("live");
      expect(first.results).toHaveLength(1);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await client.search({ query: "竞品分析" });
    expect(second.status).toBe("ok");
    if (second.status === "ok") expect(second.source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 没有再调
  });

  it("缓存 key 对 query 大小写/前后空格归一化", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await client.search({ query: "  Foo BAR  " });
    await client.search({ query: "foo bar" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("缓存条目超过 30 天后失效，重新 fetch", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await client.search({ query: "Q" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 31 天后
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    await client.search({ query: "Q" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP 429 标记 retryable=true", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }),
    );
    const out = await client.search({ query: "Q" });
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.retryable).toBe(true);
  });

  it("HTTP 401 标记 retryable=false（参数/key 问题）", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" }),
    );
    const out = await client.search({ query: "Q" });
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.retryable).toBe(false);
  });

  it("网络异常（fetch reject）返回 retryable=true 的 error", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const out = await client.search({ query: "Q" });
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.retryable).toBe(true);
      expect(out.message).toMatch(/ECONNRESET/);
    }
  });

  it("失败的查询不写缓存（下次仍发请求）", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const first = await client.search({ query: "Q" });
    expect(first.status).toBe("error");
    const second = await client.search({ query: "Q" });
    expect(second.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
