import type { PgClient } from "@harness/shared-types";

/**
 * 业务层实际只依赖 PostgreSQL 的 query 能力。
 * 用最小接口同时兼容专用 pg.Client 与连接池借出的 PoolClient，避免业务代码误调用
 * connect/end/release 干预基础设施层维护的连接生命周期。
 */
export type DbClient = PgClient;
