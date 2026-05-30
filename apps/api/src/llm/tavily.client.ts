/**
 * TavilyClient — feat-300.1 Phase 3.5
 *
 * 包装 Tavily Web Search API（https://docs.tavily.com/）作为 agent 的 search_web tool 底座。
 *
 * 三个工程问题，对应三段实现：
 *
 *   1. 缓存：Tavily 按次收费（免费 1000 次/月），同 query 在 ReAct 里可能被 LLM 反复
 *      想到、用户也会反复生成相似主题。30 天 LRU 同时解决"重复消耗"+"延迟"两个问题。
 *      用进程内 Map + 容量上限（500 条）当 LRU，避免引 lru-cache 包；MVP 够用，规模化
 *      再换 Redis（feat-400）。
 *
 *   2. 无 key 降级：用户没配 TAVILY_API_KEY 不应该让整个 agent 崩。返回 status:
 *      'unavailable' 让 LLM 自己看到这个观察，自主决定退路（比如用 search_kb 凑合）。
 *      这是 graceful degradation，比抛异常优雅，也是 agent 自主性的体现。
 *
 *   3. 错误透明：HTTP 5xx / 限流不缓存，但要把结构化错误回给 agent，让 LLM 自己决定
 *      要不要重试或换工具。绝不 silent fallback——可观测性优先。
 */

import { Injectable, Logger } from "@nestjs/common";

export interface TavilySearchInput {
  query: string;
  maxResults?: number;
  /** 'basic' 便宜快，'advanced' 给出更长摘要 */
  searchDepth?: "basic" | "advanced";
}

export interface TavilySearchResultItem {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export type TavilySearchOutput =
  | {
      status: "ok";
      query: string;
      results: TavilySearchResultItem[];
      /** 'cache' = 命中缓存（不计费）, 'live' = 真实请求 */
      source: "cache" | "live";
    }
  | {
      status: "unavailable";
      query: string;
      /** 给 LLM 的提示，让它知道走别的路径 */
      message: string;
    }
  | {
      status: "error";
      query: string;
      message: string;
      retryable: boolean;
    };

interface CacheEntry {
  result: TavilySearchOutput & { status: "ok" };
  /** 写入时间戳，用于 TTL 失效判断 */
  storedAt: number;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const CACHE_MAX_ENTRIES = 500;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_DEPTH: "basic" | "advanced" = "basic";

@Injectable()
export class TavilyClient {
  private readonly logger = new Logger(TavilyClient.name);
  /**
   * Map 的迭代顺序就是插入顺序（ES2015 起规范保证），用它实现 LRU：
   *   读：命中后先 delete 再 set，把条目挪到"最新"位置
   *   写：超容量时删除迭代器第一个元素（最老）
   * 这是 0 依赖的最简 LRU。
   */
  private readonly cache = new Map<string, CacheEntry>();

  async search(input: TavilySearchInput): Promise<TavilySearchOutput> {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      // 给 LLM 的提示明确告诉它"工具暂不可用"，由它在 reasoning 里自主决定 fallback。
      // 不在这里硬塞 "请改用 search_kb"——硬编码 fallback 路径违反 ReAct 的自主性原则。
      return {
        status: "unavailable",
        query: input.query,
        message:
          "Tavily web search is not configured (TAVILY_API_KEY missing). Choose another tool such as search_kb if needed.",
      };
    }

    const cacheKey = this.cacheKey(input);
    const cached = this.readCache(cacheKey);
    if (cached) return cached;

    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
    const searchDepth = input.searchDepth ?? DEFAULT_DEPTH;

    try {
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: input.query,
          max_results: maxResults,
          search_depth: searchDepth,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        this.logger.warn(`Tavily HTTP ${resp.status}: ${text.slice(0, 200)}`);
        // 区分 retryable：429 / 5xx 让 agent 决定重试；4xx 是参数/key 问题，重试无意义。
        const retryable = resp.status === 429 || resp.status >= 500;
        return {
          status: "error",
          query: input.query,
          message: `Tavily HTTP ${resp.status}`,
          retryable,
        };
      }

      const json = (await resp.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
      };
      const results: TavilySearchResultItem[] = (json.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: r.content ?? "",
        score: r.score,
      }));

      const ok: TavilySearchOutput & { status: "ok" } = {
        status: "ok",
        query: input.query,
        results,
        source: "live",
      };
      this.writeCache(cacheKey, ok);
      // 命中后下次返 cache，缓存里的 source 应该标 'cache' —— 写时记 'live' 不影响，
      // readCache() 返回前会改写。
      return ok;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Tavily fetch failed: ${message}`);
      // 网络异常视为可重试，让 agent 自己决定。
      return { status: "error", query: input.query, message, retryable: true };
    }
  }

  /** 测试用：清空缓存，避免单测之间互相污染 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 测试用：观察缓存条目数 */
  get cacheSize(): number {
    return this.cache.size;
  }

  // ─── 内部 ────────────────────────────────────────────────────────────

  private cacheKey(input: TavilySearchInput): string {
    // depth 不同结果不同；query 归一化大小写 + trim 避免"近似 query"穿透缓存
    const depth = input.searchDepth ?? DEFAULT_DEPTH;
    const max = input.maxResults ?? DEFAULT_MAX_RESULTS;
    return `${depth}|${max}|${input.query.trim().toLowerCase()}`;
  }

  private readCache(key: string): (TavilySearchOutput & { status: "ok" }) | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    // LRU 触摸：删了再插，挪到 Map 末尾（最新）。
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { ...entry.result, source: "cache" };
  }

  private writeCache(key: string, result: TavilySearchOutput & { status: "ok" }): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // 迭代器第一个 key = 最老（最早插入且未被触摸）
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, storedAt: Date.now() });
  }
}
