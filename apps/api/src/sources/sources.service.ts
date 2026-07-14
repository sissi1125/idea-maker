/**
 * SourcesService — feat-400.1 slice 4
 *
 * 受限官网导入的编排层：校验 → 建 record/job → 读 robots → BFS 抓同域白名单页
 * → 存 pages/chunks → 更新 job。安全判定全部委托 website-import.ts 的纯函数。
 *
 * 安全阀（每一条都对应一个不作恶的承诺）：
 *   - 社交平台 / 私网地址（SSRF）直接拒绝
 *   - 只抓同域 + 路径白名单 + robots 允许的页面
 *   - 限页(maxPages) / 限深(maxDepth) / 限速(RATE_MS) / 单页大小上限
 *   - 只处理 text/html，非 2xx 或非 html 跳过
 *
 * fetchImpl 可注入，默认用全局 fetch —— 便于用本地 fixture 站点做端到端。
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID, createHash } from "crypto";
import { DbService } from "../db/db.service";
import { AssetsService } from "../assets/assets.service";
import {
  normalizeRootUrl,
  isSocialHost,
  isPrivateHost,
  sameRegistrableDomain,
  isAllowedPath,
  parseRobotsTxt,
  isAllowedByRobots,
  extractPageContent,
  extractImageUrls,
  chunkText,
  classifyPageType,
  IMPORT_USER_AGENT,
} from "./website-import";

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_DEPTH = 2;
const RATE_MS = 400; // 每次抓取之间的最小间隔，友好限速
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000; // 单页最大 2MB
const MAX_TEXT_CHARS = 20_000; // 单页入库正文上限

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface ImportInput {
  url: string;
  maxPages?: number;
  maxDepth?: number;
}
export interface ImportResult {
  jobId: string;
  sourceRecordId: string;
  host: string;
  pagesFetched: number;
  pagesSkipped: number;
  pages: Array<{ url: string; title: string | null; pageType: string; chunks: number }>;
  /** 自动抓到并入库的品牌图片数（logo/主图） */
  assetsImported: number;
  /** 官网正文进 RAG 的分片数（可被 search_kb 检索） */
  ragChunksEmbedded: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);
  private fetchImpl: FetchImpl = (url, init) => fetch(url, init);

  constructor(
    private readonly db: DbService,
    private readonly assets: AssetsService,
  ) {}

  /** 测试注入点：替换 fetch 实现 */
  setFetchImpl(fn: FetchImpl): void {
    this.fetchImpl = fn;
  }

  private allowPrivateHosts(): boolean {
    return process.env.ALLOW_PRIVATE_IMPORT_HOSTS === "1";
  }

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  /**
   * 校验用户提交的官网 URL —— 不通过就 400（拒绝，绝不"静默降级去抓别的"）。
   * 抽成独立方法便于单测。
   */
  validateTarget(url: string): { root: URL; host: string } {
    let root: URL;
    try {
      root = normalizeRootUrl(url); // 非法格式 / 非 http(s) scheme 在此抛普通 Error
    } catch (e) {
      // 转成 400，避免用户输入错误被当成 500 服务端错误
      throw new BadRequestException(e instanceof Error ? e.message : "域名不合法");
    }
    const host = root.hostname;
    if (isSocialHost(host)) {
      throw new BadRequestException("不支持导入社交平台；社交内容请用导出文件");
    }
    if (isPrivateHost(host) && !this.allowPrivateHosts()) {
      throw new BadRequestException("不支持导入内网/本地地址");
    }
    return { root, host };
  }

  async runWebsiteImport(userId: string, projectId: string, input: ImportInput): Promise<ImportResult> {
    await this.assertOwner(userId, projectId);
    const { root, host } = this.validateTarget(input.url);
    const maxPages = Math.min(Math.max(input.maxPages ?? DEFAULT_MAX_PAGES, 1), 30);
    const maxDepth = Math.min(Math.max(input.maxDepth ?? DEFAULT_MAX_DEPTH, 0), 3);

    // 建 source_record + job
    const sourceRecordId = randomUUID();
    const jobId = randomUUID();
    await this.db.withClient(async (client) => {
      await client.query(
        `INSERT INTO source_records (id, project_id, kind, root_url, host)
         VALUES ($1, $2, 'website', $3, $4)`,
        [sourceRecordId, projectId, root.toString(), host],
      );
      await client.query(
        `INSERT INTO source_sync_jobs (id, project_id, source_record_id, status)
         VALUES ($1, $2, $3, 'running')`,
        [jobId, projectId, sourceRecordId],
      );
    });

    let fetched = 0;
    let skipped = 0;
    const pages: ImportResult["pages"] = [];
    const logoUrls = new Set<string>();
    const imageUrls = new Set<string>();
    // 官网正文 → RAG：收集 (pageId, url, chunks)，抓完统一 embedding 写入 rag_chunks
    const ragCandidates: Array<{ pageId: string; url: string; chunks: string[] }> = [];

    try {
      // 1. robots.txt
      const robotsRules = await this.loadRobots(root);

      // 2. BFS 同域白名单抓取
      const rootPath = root.pathname; // 用户主动提交的入口页，永远允许抓
      const visited = new Set<string>();
      const queue: Array<{ url: string; depth: number }> = [{ url: root.toString(), depth: 0 }];
      let firstFetch = true;

      while (queue.length > 0 && fetched < maxPages) {
        const { url, depth } = queue.shift()!;
        let u: URL;
        try {
          u = new URL(url);
        } catch {
          continue;
        }
        const key = u.origin + u.pathname;
        if (visited.has(key)) continue;
        visited.add(key);

        // 逐条安全判定（任一不过 → 跳过，不抓）
        const isRoot = u.pathname === rootPath;
        if (
          !sameRegistrableDomain(u.hostname, host) ||
          isSocialHost(u.hostname) ||
          (isPrivateHost(u.hostname) && !this.allowPrivateHosts()) ||
          (!isRoot && !isAllowedPath(u.pathname)) ||
          !isAllowedByRobots(u.pathname, robotsRules)
        ) {
          skipped++;
          continue;
        }

        if (!firstFetch) await sleep(RATE_MS); // 限速
        firstFetch = false;

        const html = await this.fetchHtml(u.toString());
        if (html === null) {
          skipped++;
          continue;
        }

        const parsed = extractPageContent(html, u.toString());
        // 收集品牌图片 URL（logo/主图），抓完统一下载
        const imgs = extractImageUrls(html, u.toString());
        imgs.logos.forEach((x) => logoUrls.add(x));
        imgs.images.forEach((x) => imageUrls.add(x));
        const chunks = chunkText(parsed.text.slice(0, MAX_TEXT_CHARS));
        const pageId = randomUUID();
        const hash = createHash("sha256").update(parsed.text).digest("hex");
        const pageType = classifyPageType(u.pathname);

        await this.db.withClient(async (client) => {
          await client.query(
            `INSERT INTO source_pages
               (id, project_id, source_record_id, url, path, title, description, page_type, content_hash, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'fetched')
             ON CONFLICT (source_record_id, url) DO NOTHING`,
            [pageId, projectId, sourceRecordId, u.toString(), u.pathname,
             parsed.title, parsed.description, pageType, hash],
          );
          for (let i = 0; i < chunks.length; i++) {
            await client.query(
              `INSERT INTO source_content_chunks (id, project_id, page_id, chunk_index, text)
               VALUES ($1,$2,$3,$4,$5)`,
              [randomUUID(), projectId, pageId, i, chunks[i]],
            );
          }
        });

        fetched++;
        pages.push({ url: u.toString(), title: parsed.title, pageType, chunks: chunks.length });
        if (chunks.length) ragCandidates.push({ pageId, url: u.toString(), chunks });

        // 3. 入队同域链接（未超深度）
        if (depth < maxDepth) {
          for (const link of parsed.links) {
            try {
              const lu = new URL(link);
              if (sameRegistrableDomain(lu.hostname, host) && isAllowedPath(lu.pathname)) {
                queue.push({ url: lu.toString(), depth: depth + 1 });
              }
            } catch {
              /* skip */
            }
          }
        }
      }

      // 兜底：SPA 页面 raw HTML 常没 icon 标签（如 bear.app 全 JS 渲染），
      // 直接探测约定路径。importFromUrl 会对 404/非图/无法解析静默跳过。
      if (logoUrls.size === 0) {
        logoUrls.add(`${root.origin}/apple-touch-icon.png`);
        logoUrls.add(`${root.origin}/apple-touch-icon-precomposed.png`);
        logoUrls.add(`${root.origin}/favicon.png`);
        logoUrls.add(`${root.origin}/favicon.ico`);
      }

      // 4. 下载品牌图片入库（status=uploaded，待用户批准）
      let assetsImported = 0;
      // logo：候选逐个试，取到一个就停（favicon 兜底常有多个候选）
      for (const url of [...logoUrls].slice(0, 6)) {
        const a = await this.assets.importFromUrl(projectId, "logo", url, "官网 logo");
        if (a) { assetsImported++; break; }
      }
      // 主图：最多 3 张
      for (const url of [...imageUrls].slice(0, 3)) {
        const a = await this.assets.importFromUrl(projectId, "product_screenshot", url, "官网主图");
        if (a) assetsImported++;
      }

      // 5. 官网正文进 RAG（embedding → rag_chunks，让 search_kb 能检索官网内容）
      const ragChunksEmbedded = await this.embedIntoRag(projectId, ragCandidates);

      await this.finishJob(jobId, "succeeded", fetched, skipped, null);
      return { jobId, sourceRecordId, host, pagesFetched: fetched, pagesSkipped: skipped, pages, assetsImported, ragChunksEmbedded };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.finishJob(jobId, "failed", fetched, skipped, msg);
      throw err;
    }
  }

  /**
   * 官网正文进 RAG：每个 chunk 算 embedding，写入 rag_chunks（project_id 隔离，
   * document_id 用 pageId 当伪文档）。这样 search_kb 检索时官网内容和上传文档一起被召回。
   * embedding 失败（无 key / 服务挂）时落 NULL embedding —— 仍可被 BM25(ILIKE) 稀疏检索命中。
   */
  private async embedIntoRag(
    projectId: string,
    candidates: Array<{ pageId: string; url: string; chunks: string[] }>,
  ): Promise<number> {
    if (candidates.length === 0) return 0;
    // 用原始 fetch 直连 OpenAI 兼容 embeddings 接口（OpenAI SDK 对非官方模型不透传 dimensions，
    // 会拿到默认维度导致和库里 1024 对不上；raw fetch 能保证 dimensions 生效）。
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL = (process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1/").replace(/\/?$/, "/");
    const model = process.env.EMBEDDING_MODEL || "text-embedding-v4";
    const dim = parseInt(process.env.EMBEDDING_DIMENSION || "1024", 10);
    if (!apiKey) this.logger.warn("[sources] 无 embedding key，官网 chunk 落 NULL 向量（走 BM25）");

    const embed = async (text: string): Promise<number[] | null> => {
      if (!apiKey) return null;
      try {
        const res = await fetch(`${baseURL}embeddings`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: text.slice(0, 6000), dimensions: dim }),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) return null;
        const j = (await res.json()) as { data?: Array<{ embedding: number[] }> };
        const got = j.data?.[0]?.embedding ?? null;
        if (got && got.length === dim) return got;
        if (got) this.logger.warn(`[sources] embedding 维度 ${got.length} ≠ 期望 ${dim}，该 chunk 落 NULL 走 BM25`);
        return null;
      } catch {
        return null;
      }
    };

    let n = 0;
    for (const c of candidates) {
      for (let i = 0; i < c.chunks.length; i++) {
        const vec = await embed(c.chunks[i]);
        const id = randomUUID();
        const insertRag = (embedLiteral: string | null, embedDim: number | null) =>
          this.db.withClient((client) =>
            client.query(
              `INSERT INTO rag_chunks
                 (id, document_id, project_id, version, chunk_index, text, enhanced_text, source_ref, embedding, embedding_dimension)
               VALUES ($1,$2,$3,1,$4,$5,$5,$6,$7::vector,$8)
               ON CONFLICT (document_id, version, chunk_index) DO NOTHING`,
              [id, c.pageId, projectId, i, c.chunks[i], c.url, embedLiteral, embedDim],
            ),
          );
        try {
          await insertRag(vec ? `[${vec.join(",")}]` : null, vec ? dim : null);
        } catch (err) {
          // 兜底：任何 embedding/维度相关的写入错误 → 退化成 NULL 向量（正文仍进库，可 BM25 检索）
          this.logger.warn(`[sources] rag_chunks 写入带向量失败，退化 NULL：${err instanceof Error ? err.message : err}`);
          await insertRag(null, null);
        }
        n++;
      }
    }
    this.logger.log(`[sources] 官网正文进 RAG: ${n} chunks`);
    return n;
  }

  /** 抓 robots.txt（失败即视为无限制，但仍受同域+白名单约束） */
  private async loadRobots(root: URL): Promise<{ disallow: string[] }> {
    try {
      const res = await this.fetchImpl(`${root.origin}/robots.txt`, {
        headers: { "User-Agent": IMPORT_USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return { disallow: [] };
      return parseRobotsTxt(await res.text());
    } catch {
      return { disallow: [] };
    }
  }

  /** 抓单页 HTML：超时 / 非 2xx / 非 html / 过大 → 返回 null（跳过） */
  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const res = await this.fetchImpl(url, {
        headers: { "User-Agent": IMPORT_USER_AGENT, Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html")) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_HTML_BYTES) return null;
      return new TextDecoder("utf-8").decode(buf);
    } catch (err) {
      this.logger.warn(`[sources] fetch failed ${url}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async finishJob(
    jobId: string,
    status: "succeeded" | "failed",
    fetched: number,
    skipped: number,
    error: string | null,
  ): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query(
        `UPDATE source_sync_jobs
            SET status = $2, pages_fetched = $3, pages_skipped = $4, error = $5, finished_at = NOW()
          WHERE id = $1`,
        [jobId, status, fetched, skipped, error],
      );
    });
  }

  /** 列出项目的来源记录 + 页面（审核工作台/调试用） */
  async listSources(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows: records } = await client.query(
        `SELECT id, kind, root_url, host, status, created_at
           FROM source_records WHERE project_id = $1 ORDER BY created_at DESC`,
        [projectId],
      );
      const { rows: pages } = await client.query(
        `SELECT id, source_record_id, url, path, title, page_type, content_hash, fetched_at
           FROM source_pages WHERE project_id = $1 ORDER BY fetched_at DESC LIMIT 100`,
        [projectId],
      );
      return { records, pages };
    });
  }
}
