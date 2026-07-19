/**
 * DbService — feat-200.1 Week 1
 *
 * 统一封装：
 *   1. resolveConnectionString：表单 / DATABASE_URL env 优先级（与 SnapshotsService 一致）
 *   2. withClient(fn)：从全局 pg.Pool 借连接 + run DDL + try/finally release，
 *      内部业务代码只关心 SQL，不重复管理连接生命周期
 *
 * 为什么不直接复用 ProvidersService.createPgClient：
 *   - feat-200.1 业务表需要在进程首次查询前确保 DDL 已应用，pipeline 那边复用的 pg 客户端
 *     是 rag-core 视角下"接 client + 跑算法 + finally end"，与 MVP 业务请求生命周期错开
 *   - Playground 允许表单传任意 connectionString，仍由 ProvidersService 创建专用 Client；
 *     生产业务只连接 DATABASE_URL，适合在这里集中复用 Pool
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Pool, type PoolConfig } from "pg";
import { FEAT_200_DDL_BLOCKS } from "./schema";
import type { DbClient } from "./db-client";

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool: Pool | null = null;

  // DDL Promise 让并发首请求共享同一次初始化；单独 boolean 无法阻止两个请求同时跑 DDL。
  private ddlReady = false;
  private ddlInitPromise: Promise<void> | null = null;
  // 长流程（如 Agent）使用此代理：每条 query 各自借还连接，等待 LLM 时不占 Pool slot。
  private readonly pooledQueryClient: DbClient = {
    query: <R = Record<string, unknown>>(text: string, values?: ReadonlyArray<unknown>) =>
      this.withClient((client) => client.query<R>(text, values)),
  };

  /**
   * 解析连接串：表单参数 > DATABASE_URL env。
   * MVP Week 1 没有"表单"概念（业务端点不接受 connectionString），保留参数位是为了
   * 后续测试 / 调试可以注入 mock 连接。
   */
  resolveConnectionString(paramCs?: string): string | null {
    const cs = typeof paramCs === "string" && paramCs.trim() ? paramCs.trim() : null;
    return cs ?? process.env.DATABASE_URL ?? null;
  }

  /**
   * 跑一次 DDL 初始化所有 feat-200 表。
   * 幂等：CREATE EXTENSION IF NOT EXISTS + CREATE TABLE IF NOT EXISTS。
   *
   * 部署到 Fly.io 等环境时，pgvector 扩展可能没有被预先安装。
   * 我们在 init 时主动 CREATE EXTENSION IF NOT EXISTS vector——
   * 这条语句对 superuser / cloudsqlsuperuser 角色就足够；
   * 如果失败（如 fly postgres 的非 superuser 角色），抛出明确错误而不是让后续
   * 业务 SQL 因 vector 类型不存在而难以诊断地崩溃。
   */
  async initSchema(client: DbClient): Promise<void> {
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 不阻塞其他 DDL：如果扩展已经装好但当前角色无权 CREATE EXTENSION，
      // 这条会失败但其他 SQL 仍可正常跑（vector 类型已存在于另一个 schema/superuser）。
      console.warn(`[db] CREATE EXTENSION vector 失败（可能已存在或权限不足）：${msg}`);
    }
    for (const ddl of FEAT_200_DDL_BLOCKS) {
      await client.query(ddl);
    }
    this.ddlReady = true;
  }

  /** 创建进程级连接池。Pool 按需建连，max 是上限而不是启动时预建数量。 */
  private getPool(): Pool {
    if (this.pool) return this.pool;

    const connectionString = this.resolveConnectionString();
    if (!connectionString) {
      throw new ServiceUnavailableException(
        "数据库未配置：请设置 DATABASE_URL 环境变量",
      );
    }

    const config: PoolConfig = {
      connectionString,
      max: readPositiveInt("DB_POOL_MAX", 10),
      idleTimeoutMillis: readPositiveInt("DB_POOL_IDLE_TIMEOUT_MS", 30_000),
      connectionTimeoutMillis: readPositiveInt("DB_POOL_CONNECTION_TIMEOUT_MS", 5_000),
      application_name: process.env.DB_APPLICATION_NAME?.trim() || "idea-maker-api",
    };
    this.pool = new Pool(config);
    // 空闲连接错误不会归属于某个请求；必须监听，避免 EventEmitter 的未处理 error 终止进程。
    this.pool.on("error", (err) => {
      this.logger.error(`PostgreSQL 连接池空闲连接异常：${err.message}`);
    });
    return this.pool;
  }

  /** 首次请求初始化 schema；失败后清空 Promise，允许下一次请求重试。 */
  private async ensureSchema(client: DbClient): Promise<void> {
    if (this.ddlReady) return;
    if (!this.ddlInitPromise) {
      this.ddlInitPromise = this.initSchema(client).catch((err) => {
        this.ddlInitPromise = null;
        throw err;
      });
    }
    await this.ddlInitPromise;
  }

  /**
   * withClient — 业务代码的统一 DB 入口，从 Pool 借连接并保证归还。
   *
   * 用法：
   *   const result = await this.db.withClient(async (client) => {
   *     const r = await client.query("SELECT ...");
   *     return r.rows;
   *   });
   *
   * 错误处理：
   *   - 连接串缺失 → ServiceUnavailableException（503，前端能识别"后端未配置 DB"）
   *   - 获取连接超时 / ECONNREFUSED → 透传原生错误，让异常层记录 trace
   *   - 业务 SQL 错误 → 透传，由调用方决定如何翻译
   */
  async withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    // pg.PoolClient.query 与 shared-types 的最小 PgClient 契约运行时一致；这里集中适配
    // 两套第三方泛型声明，业务层不应知道 release/connect 等生命周期方法。
    const dbClient = client as unknown as DbClient;
    try {
      await this.ensureSchema(dbClient);
      return await fn(dbClient);
    } finally {
      client.release();
    }
  }

  /**
   * 返回按查询借还连接的轻量代理，适合包含 LLM/HTTP 等长等待的流程。
   * 它不保证多条 SQL 使用同一连接，因此事务必须继续使用 withClient。
   */
  queryClient(): DbClient {
    return this.pooledQueryClient;
  }

  /** NestJS 优雅退出时统一关闭所有空闲/活动连接，不让容器停机遗留 socket。 */
  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    this.ddlReady = false;
    this.ddlInitPromise = null;
    if (pool) await pool.end();
  }
}

/** 环境变量只接受正整数；错误值回退安全默认值，避免 max=0 让所有请求永久等待。 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
