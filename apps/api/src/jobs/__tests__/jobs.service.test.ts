import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DDL_ASYNC_JOBS } from "../../db/schema";
import { JobsService, type JobPayload } from "../jobs.service";

interface QueryCall {
  sql: string;
  params?: ReadonlyArray<unknown>;
}

/** 创建可按 SQL 路由结果的 DbService mock，保留完整调用顺序供租约协议断言。 */
function makeDb(route: (sql: string, params?: ReadonlyArray<unknown>) => unknown[] = () => []) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: ReadonlyArray<unknown>) => {
      calls.push({ sql, params });
      const rows = route(sql, params);
      return { rows, rowCount: rows.length };
    }),
  };
  return {
    db: { withClient: <T>(fn: (value: typeof client) => Promise<T>) => fn(client) } as any,
    calls,
  };
}

/** 等待后台 promise 完成，避免测试依赖固定 sleep。 */
async function flushBackground(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function claimedJob(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    project_id: "project-1",
    kind: "brief_extract",
    ref_id: null,
    status: "running",
    payload: { userId: "user-1", projectId: "project-1" },
    result: null,
    error: null,
    attempt_count: 1,
    max_attempts: 3,
    created_at: new Date(),
    started_at: new Date(),
    finished_at: null,
    ...over,
  };
}

describe("JobsService PostgreSQL worker", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.JOB_CONCURRENCY_DEFAULT;
    delete process.env.JOB_CONCURRENCY_BRIEF_EXTRACT;
    delete process.env.JOB_LEASE_MS;
    delete process.env.JOB_HEARTBEAT_MS;
    delete process.env.JOB_SHUTDOWN_GRACE_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it("create 持久化 payload 和最大尝试次数，不保存请求闭包", async () => {
    const { db, calls } = makeDb();
    const service = new JobsService(db);
    service.registerHandler("brief_extract", async () => null);

    await service.create(
      "project-1",
      "brief_extract",
      undefined,
      { userId: "user-1", projectId: "project-1" },
    );

    const insertion = calls.find((call) => call.sql.includes("INSERT INTO async_jobs"));
    expect(insertion?.params?.[4]).toBe(JSON.stringify({
      userId: "user-1",
      projectId: "project-1",
    }));
    expect(insertion?.params?.[5]).toBe(3);
  });

  it("用 advisory lock + SKIP LOCKED 认领，并由持有 lease 的 worker 完成", async () => {
    let returnedClaim = false;
    const { db, calls } = makeDb((sql) => {
      if (sql.includes("COUNT(*) AS count")) return [{ count: "0" }];
      if (sql.includes("WITH candidate") && !returnedClaim) {
        returnedClaim = true;
        return [claimedJob()];
      }
      return [];
    });
    const service = new JobsService(db);
    const handler = vi.fn(async (payload: JobPayload) => ({ projectId: payload.projectId }));
    service.registerHandler("brief_extract", handler, { concurrency: 1 });

    expect(await service.runWorkerCycle()).toBe(1);
    await flushBackground();

    expect(handler).toHaveBeenCalledWith(
      { userId: "user-1", projectId: "project-1" },
      expect.objectContaining({ id: "job-1", attempt_count: 1 }),
    );
    expect(calls.some((call) => call.sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("RETURNING j.id, j.project_id"))).toBe(true);
    expect(calls.some((call) =>
      call.sql.includes("lease_expires_at IS NULL OR lease_expires_at <= NOW()"),
    )).toBe(true);
    const completion = calls.find((call) => call.sql.includes("status = 'succeeded'"));
    expect(completion?.sql).toContain("worker_id = $2");
    expect(completion?.params?.[2]).toBe(JSON.stringify({ projectId: "project-1" }));
  });

  it("本进程达到 kind 并发上限时不再 claim", async () => {
    let claimNumber = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { db, calls } = makeDb((sql) => {
      if (sql.includes("COUNT(*) AS count")) return [{ count: "0" }];
      if (sql.includes("WITH candidate")) return [claimedJob({ id: `job-${++claimNumber}` })];
      return [];
    });
    const service = new JobsService(db);
    service.registerHandler("brief_extract", async () => gate, { concurrency: 1 });

    expect(await service.runWorkerCycle()).toBe(1);
    expect(await service.runWorkerCycle()).toBe(0);
    expect(calls.filter((call) => call.sql.includes("WITH candidate"))).toHaveLength(1);
    release();
    await flushBackground();
  });

  it("数据库中同 kind 活跃数达到上限时，跨实例也不会继续 claim", async () => {
    const { db, calls } = makeDb((sql) => {
      if (sql.includes("COUNT(*) AS count")) return [{ count: "1" }];
      return [];
    });
    const service = new JobsService(db);
    service.registerHandler("brief_extract", async () => null, { concurrency: 1 });

    expect(await service.runWorkerCycle()).toBe(0);
    expect(calls.some((call) => call.sql.includes("WITH candidate"))).toBe(false);
    expect(calls.map((call) => call.sql)).toContain("COMMIT");
  });

  it("长任务按 heartbeat 周期续租，且 SQL 校验 worker 所有权", async () => {
    vi.useFakeTimers();
    process.env.JOB_LEASE_MS = "2000";
    process.env.JOB_HEARTBEAT_MS = "1000";
    let returnedClaim = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { db, calls } = makeDb((sql) => {
      if (sql.includes("COUNT(*) AS count")) return [{ count: "0" }];
      if (sql.includes("WITH candidate") && !returnedClaim) {
        returnedClaim = true;
        return [claimedJob()];
      }
      return [];
    });
    const service = new JobsService(db);
    service.registerHandler("brief_extract", async () => gate);

    await service.runWorkerCycle();
    await vi.advanceTimersByTimeAsync(1_000);

    const heartbeat = calls.find((call) => call.sql.includes("SET heartbeat_at = NOW()"));
    expect(heartbeat?.sql).toContain("worker_id = $2 AND status = 'running'");
    expect(heartbeat?.params?.[2]).toBe(2_000);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("失败但未达 max_attempts 时回到 queued 并指数退避", async () => {
    let returnedClaim = false;
    const { db, calls } = makeDb((sql) => {
      if (sql.includes("COUNT(*) AS count")) return [{ count: "0" }];
      if (sql.includes("WITH candidate") && !returnedClaim) {
        returnedClaim = true;
        return [claimedJob({ attempt_count: 2 })];
      }
      return [];
    });
    const service = new JobsService(db);
    service.registerHandler("brief_extract", async () => { throw new Error("provider timeout"); });

    await service.runWorkerCycle();
    await flushBackground();

    const retry = calls.find((call) => call.sql.includes("attempt_count < max_attempts") && call.params?.[2] === "provider timeout");
    expect(retry?.sql).toContain("THEN 'queued' ELSE 'failed'");
    expect(retry?.params?.[3]).toBe(2_000);
  });

  it("优雅退出停止 claim，并释放仍由当前 worker 持有的任务 lease", async () => {
    process.env.JOB_SHUTDOWN_GRACE_MS = "1";
    const { db, calls } = makeDb();
    const service = new JobsService(db);
    service.registerHandler("brief_extract", async () => null);

    await service.beforeApplicationShutdown();

    expect(await service.runWorkerCycle()).toBe(0);
    expect(calls.some((call) =>
      call.sql.includes("SET status = 'queued'") && call.sql.includes("WHERE worker_id = $1"),
    )).toBe(true);
  });

  it("旧表迁移先补 available_at，再创建 claim 索引", () => {
    expect(DDL_ASYNC_JOBS.indexOf("ADD COLUMN IF NOT EXISTS available_at"))
      .toBeLessThan(DDL_ASYNC_JOBS.indexOf("idx_async_jobs_claim"));
  });
});
