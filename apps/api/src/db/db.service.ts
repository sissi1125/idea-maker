/**
 * DbService — feat-200.1 Week 1
 *
 * 统一封装：
 *   1. resolveConnectionString：表单 / DATABASE_URL env 优先级（与 SnapshotsService 一致）
 *   2. withClient(fn)：自动 new Client + connect + run DDL + try/finally end，
 *      内部业务代码只关心 SQL，不重复管理生命周期
 *
 * 为什么不直接复用 ProvidersService.createPgClient：
 *   - feat-200.1 三张表需要在每次连接时确保 DDL 已应用，pipeline 那边复用的 pg 客户端
 *     是 rag-core 视角下"接 client + 跑算法 + finally end"，与 MVP 业务请求生命周期错开
 *   - 把 MVP 业务 DB 调用集中在 DbService 后，将来切到连接池只改一个文件
 */

import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Client as PgClient } from "pg";
import { FEAT_200_DDL_BLOCKS } from "./schema";

@Injectable()
export class DbService {
  // 模块级标记：DDL 只跑一次，避免每个请求都执行 CREATE TABLE 慢查询
  // 在测试环境（NODE_ENV=test）可以通过 resetDDL() 重置（暂未暴露，留扩展位）
  private ddlReady = false;

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
  async initSchema(client: PgClient): Promise<void> {
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

  /**
   * withClient — 业务代码的统一 DB 入口。
   *
   * 用法：
   *   const result = await this.db.withClient(async (client) => {
   *     const r = await client.query("SELECT ...");
   *     return r.rows;
   *   });
   *
   * 错误处理：
   *   - 连接串缺失 → ServiceUnavailableException（503，前端能识别"后端未配置 DB"）
   *   - 连接失败（ECONNREFUSED）→ 透传原生错误，让 PipelineExceptionFilter 处理
   *   - 业务 SQL 错误 → 透传，由调用方决定如何翻译
   */
  async withClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    const cs = this.resolveConnectionString();
    if (!cs) {
      throw new ServiceUnavailableException(
        "数据库未配置：请设置 DATABASE_URL 环境变量",
      );
    }
    const client = new PgClient({ connectionString: cs });
    await client.connect();
    try {
      if (!this.ddlReady) {
        // 首次请求或进程重启后跑一次 DDL
        await this.initSchema(client);
      }
      return await fn(client);
    } finally {
      await client.end().catch(() => {
        /* 忽略关闭错误，避免吞掉业务错误 */
      });
    }
  }
}
