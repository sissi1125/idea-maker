/**
 * JobsService — PostgreSQL 持久化后台任务队列。
 *
 * API 请求只写 async_jobs；worker 用 FOR UPDATE SKIP LOCKED 抢任务，并通过
 * worker_id + lease + heartbeat 标记所有权。进程重启后，过期 lease 会自动回到 queued。
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { hostname } from "os";
import { DbService } from "../db/db.service";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobPayload = Record<string, unknown>;

export interface JobRow {
  id: string;
  project_id: string;
  kind: string;
  ref_id: string | null;
  status: JobStatus;
  result: unknown;
  error: string | null;
  attempt_count: number;
  max_attempts: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

interface ClaimedJob extends JobRow {
  payload: JobPayload;
}

interface RegisteredHandler {
  concurrency: number;
  execute: (payload: JobPayload, job: ClaimedJob) => Promise<unknown>;
}

const CLAIM_RETURNING_COLS = `j.id, j.project_id, j.kind, j.ref_id, j.status, j.payload,
  j.result, j.error, j.attempt_count, j.max_attempts, j.created_at, j.started_at, j.finished_at`;

/** 环境变量只接受正整数，避免并发上限或租约被非法值关闭。 */
function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class JobsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly leaseMs = positiveInt(process.env.JOB_LEASE_MS, 60_000);
  private readonly heartbeatMs = Math.min(
    positiveInt(process.env.JOB_HEARTBEAT_MS, 20_000),
    Math.max(1_000, Math.floor(this.leaseMs / 2)),
  );
  private readonly pollMs = positiveInt(process.env.JOB_POLL_MS, 500);
  private readonly shutdownGraceMs = positiveInt(process.env.JOB_SHUTDOWN_GRACE_MS, 10_000);
  private readonly handlers = new Map<string, RegisteredHandler>();
  private readonly activeByKind = new Map<string, number>();
  private readonly activeTasks = new Set<Promise<void>>();
  private pollTimer: NodeJS.Timeout | null = null;
  private cycleRunning = false;
  private bootstrapped = false;
  private stopping = false;

  constructor(private readonly db: DbService) {}

  /**
   * 业务模块在启动期注册可恢复 handler。handler 只接收已持久化 payload，不能依赖请求闭包。
   */
  registerHandler(
    kind: string,
    execute: RegisteredHandler["execute"],
    options?: { concurrency?: number },
  ): void {
    if (this.handlers.has(kind)) throw new Error(`后台任务 handler 重复注册: ${kind}`);
    const envKey = `JOB_CONCURRENCY_${kind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const concurrency = positiveInt(
      process.env[envKey],
      options?.concurrency ?? positiveInt(process.env.JOB_CONCURRENCY_DEFAULT, 1),
    );
    this.handlers.set(kind, { concurrency, execute });
    if (this.bootstrapped) this.scheduleCycle();
  }

  /** 建立 queued 任务；payload 是进程重启后重建业务调用的最小输入。 */
  async create(
    projectId: string,
    kind: string,
    refId?: string,
    payload: JobPayload = {},
    maxAttempts = 3,
  ): Promise<string> {
    if (!this.handlers.has(kind)) throw new Error(`后台任务 handler 未注册: ${kind}`);
    const boundedMaxAttempts = Math.max(1, Math.min(10, Math.trunc(maxAttempts)));
    const id = randomUUID();
    await this.db.withClient((client) =>
      client.query(
        `INSERT INTO async_jobs
           (id, project_id, kind, ref_id, status, payload, max_attempts, available_at)
         VALUES ($1,$2,$3,$4,'queued',$5::jsonb,$6,NOW())`,
        [id, projectId, kind, refId ?? null, JSON.stringify(payload), boundedMaxAttempts],
      ),
    );
    this.scheduleCycle();
    return id;
  }

  /** 所有模块完成初始化后再开始抢任务，确保恢复任务对应的 handler 已注册。 */
  onApplicationBootstrap(): void {
    this.bootstrapped = true;
    this.pollTimer = setInterval(() => this.scheduleCycle(), this.pollMs);
    this.pollTimer.unref?.();
    this.scheduleCycle();
  }

  /**
   * worker 单轮调度。公开是为了用确定性测试验证 claim/concurrency；HTTP 层不暴露它。
   */
  async runWorkerCycle(): Promise<number> {
    if (this.stopping || this.cycleRunning) return 0;
    this.cycleRunning = true;
    let claimedCount = 0;
    try {
      for (const [kind, registered] of this.handlers) {
        while ((this.activeByKind.get(kind) ?? 0) < registered.concurrency) {
          const job = await this.claimNext(kind, registered.concurrency);
          if (!job) break;
          claimedCount += 1;
          this.startClaimedJob(job, registered);
        }
      }
    } finally {
      this.cycleRunning = false;
    }
    return claimedCount;
  }

  /** 前端轮询：带 owner 校验（project 必须属于 userId）。 */
  async get(userId: string, projectId: string, jobId: string): Promise<JobRow> {
    return this.db.withClient(async (client) => {
      const { rows: own } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (own.length === 0) throw new NotFoundException("项目不存在");
      const { rows } = await client.query<JobRow>(
        `SELECT id, project_id, kind, ref_id, status, result, error, attempt_count,
                max_attempts, created_at, started_at, finished_at
           FROM async_jobs WHERE id = $1 AND project_id = $2`,
        [jobId, projectId],
      );
      if (rows.length === 0) throw new NotFoundException("任务不存在");
      return rows[0];
    });
  }

  /** 抢占前按 kind 取事务 advisory lock，让跨实例并发计数与 claim 原子化。 */
  private async claimNext(kind: string, concurrency: number): Promise<ClaimedJob | null> {
    return this.db.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`async-job:${kind}`]);
        // 崩溃 worker 的 lease 到期后重排；超过最大尝试次数则直接终结。
        await client.query(
          `UPDATE async_jobs
              SET status = CASE WHEN attempt_count < max_attempts THEN 'queued' ELSE 'failed' END,
                  error = CASE WHEN attempt_count < max_attempts THEN error
                               ELSE COALESCE(error, '任务租约过期且已达到最大重试次数') END,
                  worker_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                  available_at = NOW(), updated_at = NOW(),
                  finished_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE NOW() END
            WHERE kind = $1 AND status = 'running'
              AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())`,
          [kind],
        );
        const { rows: counts } = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM async_jobs
            WHERE kind = $1 AND status = 'running' AND lease_expires_at > NOW()`,
          [kind],
        );
        if (Number(counts[0]?.count ?? 0) >= concurrency) {
          await client.query("COMMIT");
          return null;
        }
        const { rows } = await client.query<ClaimedJob>(
          `WITH candidate AS (
             SELECT id FROM async_jobs
              WHERE kind = $1 AND status = 'queued' AND available_at <= NOW()
                AND attempt_count < max_attempts
              ORDER BY created_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
           )
           UPDATE async_jobs j
              SET status = 'running', worker_id = $2,
                  lease_expires_at = NOW() + ($3 * interval '1 millisecond'),
                  heartbeat_at = NOW(), attempt_count = attempt_count + 1,
                  started_at = COALESCE(started_at, NOW()), finished_at = NULL,
                  error = NULL, updated_at = NOW()
             FROM candidate
            WHERE j.id = candidate.id
          RETURNING ${CLAIM_RETURNING_COLS}`,
          [kind, this.workerId, this.leaseMs],
        );
        await client.query("COMMIT");
        return rows[0] ?? null;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  }

  /** 启动已认领任务，并维持本进程的按 kind 活跃计数。 */
  private startClaimedJob(job: ClaimedJob, registered: RegisteredHandler): void {
    this.activeByKind.set(job.kind, (this.activeByKind.get(job.kind) ?? 0) + 1);
    const task = this.executeClaimedJob(job, registered).finally(() => {
      this.activeByKind.set(job.kind, Math.max(0, (this.activeByKind.get(job.kind) ?? 1) - 1));
      this.activeTasks.delete(task);
      this.scheduleCycle();
    });
    this.activeTasks.add(task);
  }

  /** handler 执行期间续租；只有仍持有 worker_id 的实例能完成或重排任务。 */
  private async executeClaimedJob(job: ClaimedJob, registered: RegisteredHandler): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.extendLease(job.id).catch((error) =>
        this.logger.warn(`[jobs] heartbeat failed job=${job.id}: ${(error as Error).message}`),
      );
    }, this.heartbeatMs);
    heartbeat.unref?.();
    try {
      const result = await registered.execute(job.payload ?? {}, job);
      await this.complete(job.id, result ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[jobs] ${job.id} attempt=${job.attempt_count} failed: ${message}`);
      await this.failOrRetry(job, message);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** 心跳只更新当前 worker 持有的 running 行，防止旧 worker 延长新 owner 的 lease。 */
  private async extendLease(jobId: string): Promise<void> {
    await this.db.withClient((client) => client.query(
      `UPDATE async_jobs
          SET heartbeat_at = NOW(),
              lease_expires_at = NOW() + ($3 * interval '1 millisecond'), updated_at = NOW()
        WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [jobId, this.workerId, this.leaseMs],
    ));
  }

  /** 成功结果只允许由仍持有 lease 的 worker 落库。 */
  private async complete(jobId: string, result: unknown): Promise<void> {
    await this.db.withClient((client) => client.query(
      `UPDATE async_jobs
          SET status = 'succeeded', result = $3::jsonb, error = NULL, finished_at = NOW(),
              worker_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = NOW()
        WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [jobId, this.workerId, JSON.stringify(result)],
    ));
  }

  /** 可重试失败回到 queued 并指数退避；最后一次失败才暴露终态 failed。 */
  private async failOrRetry(job: ClaimedJob, error: string): Promise<void> {
    const retryDelayMs = Math.min(30_000, 1_000 * 2 ** Math.max(0, job.attempt_count - 1));
    await this.db.withClient((client) => client.query(
      `UPDATE async_jobs
          SET status = CASE WHEN attempt_count < max_attempts THEN 'queued' ELSE 'failed' END,
              error = $3, worker_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
              available_at = CASE WHEN attempt_count < max_attempts
                THEN NOW() + ($4 * interval '1 millisecond') ELSE available_at END,
              finished_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE NOW() END,
              updated_at = NOW()
        WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [job.id, this.workerId, error, retryDelayMs],
    ));
  }

  /** 合并同一 tick 的唤醒，避免每次 enqueue/完成都重入 worker cycle。 */
  private scheduleCycle(): void {
    if (!this.bootstrapped || this.stopping || this.cycleRunning) return;
    setImmediate(() => {
      void this.runWorkerCycle().catch((error) =>
        this.logger.error(`[jobs] worker cycle failed: ${(error as Error).message}`),
      );
    });
  }

  /** 优雅退出：停止 claim，等待宽限期；未完成的本 worker 任务释放为 queued。 */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.activeTasks.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.activeTasks]),
        new Promise((resolve) => setTimeout(resolve, this.shutdownGraceMs)),
      ]);
    }
    await this.db.withClient((client) => client.query(
      `UPDATE async_jobs
          SET status = 'queued', worker_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
              available_at = NOW(), finished_at = NULL, updated_at = NOW()
        WHERE worker_id = $1 AND status = 'running'`,
      [this.workerId],
    )).catch((error) =>
      this.logger.warn(`[jobs] shutdown lease release failed: ${(error as Error).message}`),
    );
  }
}
