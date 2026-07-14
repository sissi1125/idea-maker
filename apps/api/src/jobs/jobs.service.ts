/**
 * JobsService — 通用异步任务（验收反馈：LLM 长请求异步化）
 *
 * 用法：
 *   const jobId = await jobs.create(projectId, 'brief_extract')
 *   jobs.runInBackground(jobId, async () => { ...跑 LLM...; return result })   // 不 await
 *   // 前端轮询 jobs.get(userId, projectId, jobId)
 *
 * 设计要点：run 不阻塞 HTTP，错误落 async_jobs.error 而非冒泡（参考 agent startInBackground）。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobRow {
  id: string;
  project_id: string;
  kind: string;
  ref_id: string | null;
  status: JobStatus;
  result: unknown;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly db: DbService) {}

  /** 建一个 queued 任务，返回 jobId */
  async create(projectId: string, kind: string, refId?: string): Promise<string> {
    const id = randomUUID();
    await this.db.withClient((client) =>
      client.query(
        `INSERT INTO async_jobs (id, project_id, kind, ref_id, status) VALUES ($1,$2,$3,$4,'queued')`,
        [id, projectId, kind, refId ?? null],
      ),
    );
    return id;
  }

  /**
   * 后台执行 work()，不阻塞调用方。成功写 result，失败写 error。
   * 关键：不 await 返回的 promise（调用方立即返回 jobId 给前端）。
   */
  runInBackground(jobId: string, work: () => Promise<unknown>): void {
    void (async () => {
      await this.patch(jobId, { status: "running" });
      try {
        const result = await work();
        await this.patch(jobId, { status: "succeeded", result: result ?? null, finished: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[jobs] ${jobId} failed: ${msg}`);
        await this.patch(jobId, { status: "failed", error: msg, finished: true });
      }
    })();
  }

  private async patch(
    jobId: string,
    p: { status?: JobStatus; result?: unknown; error?: string; finished?: boolean },
  ): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (p.status !== undefined) { sets.push(`status = $${i++}`); vals.push(p.status); }
    if (p.result !== undefined) { sets.push(`result = $${i++}::jsonb`); vals.push(JSON.stringify(p.result)); }
    if (p.error !== undefined) { sets.push(`error = $${i++}`); vals.push(p.error); }
    if (p.finished) sets.push(`finished_at = NOW()`);
    if (sets.length === 0) return;
    vals.push(jobId);
    await this.db.withClient((client) =>
      client.query(`UPDATE async_jobs SET ${sets.join(", ")} WHERE id = $${i}`, vals),
    );
  }

  /** 前端轮询：带 owner 校验（project 必须属于 userId） */
  async get(userId: string, projectId: string, jobId: string): Promise<JobRow> {
    return this.db.withClient(async (client) => {
      const { rows: own } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (own.length === 0) throw new NotFoundException("项目不存在");
      const { rows } = await client.query<JobRow>(
        `SELECT id, project_id, kind, ref_id, status, result, error, created_at, finished_at
           FROM async_jobs WHERE id = $1 AND project_id = $2`,
        [jobId, projectId],
      );
      if (rows.length === 0) throw new NotFoundException("任务不存在");
      return rows[0];
    });
  }
}
