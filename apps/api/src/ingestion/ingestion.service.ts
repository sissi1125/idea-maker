/**
 * IngestionService — feat-200.2 Week 2
 *
 * 职责：
 *   - enqueue(projectId, documentId)：插一行 ingestion_jobs（status=queued）+ 触发 runner
 *   - getJob(...)：取单个 job（含 owner 校验）
 *   - listByDocument / listByProject：查询
 *   - updateProgress / markFailed / markSucceeded：runner 写回口
 *
 * 不直接做 5-stage pipeline 调用（那是 IngestionJobRunner 的事）。
 */

import { forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DbService } from "../db/db.service";
import { IngestionJobRunner } from "./ingestion-job-runner";
import {
  INGESTION_EVENT,
  type IngestionJobRow,
  type IngestionProgressEvent,
  type IngestionCompletedEvent,
  type IngestionFailedEvent,
  type IngestionStage,
  type IngestionStageOutput,
  type IngestionStageOutputs,
  type IngestionStatus,
} from "./ingestion.types";

interface DbJobRow {
  id: string;
  project_id: string;
  document_id: string;
  status: string;
  progress: number;
  current_stage: string | null;
  chunks_done: number;
  chunks_total: number;
  cost_usd: string;
  error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
  stage_outputs: IngestionStageOutputs | null;
}

function mapJob(row: DbJobRow): IngestionJobRow {
  return {
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    status: row.status as IngestionStatus,
    progress: row.progress,
    currentStage: row.current_stage as IngestionStage | null,
    chunksDone: row.chunks_done,
    chunksTotal: row.chunks_total,
    costUsd: Number(row.cost_usd),
    error: row.error,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    stageOutputs: row.stage_outputs ?? {},
  };
}

const SELECT_COLS = `id, project_id, document_id, status, progress, current_stage,
  chunks_done, chunks_total, cost_usd, error, started_at, finished_at, created_at, updated_at,
  stage_outputs`;

@Injectable()
export class IngestionService {
  constructor(
    private readonly db: DbService,
    private readonly events: EventEmitter2,
    @Inject(forwardRef(() => IngestionJobRunner))
    private readonly runner: IngestionJobRunner,
  ) {}

  /**
   * 创建 job 行 + 异步触发 runner。
   * 返回立刻可用的 jobId，前端可马上订阅 SSE。
   */
  async enqueue(input: {
    projectId: string;
    documentId: string;
  }): Promise<IngestionJobRow> {
    const id = randomUUID();
    const job = await this.db.withClient(async (client) => {
      const res = await client.query<DbJobRow>(
        `INSERT INTO ingestion_jobs
           (id, project_id, document_id, status, progress)
         VALUES ($1, $2, $3, 'queued', 0)
         RETURNING ${SELECT_COLS}`,
        [id, input.projectId, input.documentId],
      );
      return mapJob(res.rows[0]);
    });

    // setImmediate 让 enqueue 立刻返回 HTTP，runner 在下一个 tick 真正开始跑
    // 进程崩溃 → job 留在 queued 状态，需 cron 扫描重跑（Week 8 加）
    setImmediate(() => {
      this.runner.run(job.id).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ingestion-runner] job=${job.id} 未捕获错误`, msg);
      });
    });

    return job;
  }

  /**
   * 取单 job（强制 owner 校验）。
   * 通过 documents → projects 双层 JOIN 防越权。
   */
  async getJob(
    ownerId: string,
    projectId: string,
    jobId: string,
  ): Promise<IngestionJobRow> {
    return this.db.withClient(async (client) => {
      const res = await client.query<DbJobRow>(
        `SELECT ${SELECT_COLS.split(", ").map((c) => `j.${c}`).join(", ")}
         FROM ingestion_jobs j
         INNER JOIN projects p ON p.id = j.project_id
         WHERE j.id = $1 AND j.project_id = $2 AND p.owner_id = $3
         LIMIT 1`,
        [jobId, projectId, ownerId],
      );
      if (res.rows.length === 0) throw new NotFoundException("任务不存在");
      return mapJob(res.rows[0]);
    });
  }

  /** 内部用：runner 取 job 不做 owner 校验。 */
  async getJobInternal(jobId: string): Promise<IngestionJobRow> {
    return this.db.withClient(async (client) => {
      const res = await client.query<DbJobRow>(
        `SELECT ${SELECT_COLS} FROM ingestion_jobs WHERE id = $1 LIMIT 1`,
        [jobId],
      );
      if (res.rows.length === 0) throw new NotFoundException("任务不存在");
      return mapJob(res.rows[0]);
    });
  }

  async listByProject(
    ownerId: string,
    projectId: string,
  ): Promise<IngestionJobRow[]> {
    return this.db.withClient(async (client) => {
      // owner 校验：先确认项目归属
      const projectCheck = await client.query<{ id: string }>(
        `SELECT id FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1`,
        [projectId, ownerId],
      );
      if (projectCheck.rows.length === 0) {
        throw new NotFoundException("项目不存在");
      }
      const res = await client.query<DbJobRow>(
        `SELECT ${SELECT_COLS}
         FROM ingestion_jobs WHERE project_id = $1
         ORDER BY created_at DESC LIMIT 100`,
        [projectId],
      );
      return res.rows.map(mapJob);
    });
  }

  /**
   * Runner 写回口：更新进度 / stage。
   * 同时发 EventEmitter 事件供 SSE 流订阅。
   */
  async updateProgress(
    jobId: string,
    patch: {
      status?: IngestionStatus;
      progress?: number;
      currentStage?: IngestionStage | null;
      chunksDone?: number;
      chunksTotal?: number;
      costUsd?: number;
    },
  ): Promise<IngestionJobRow> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    if (patch.status !== undefined) {
      sets.push(`status = $${p++}`);
      values.push(patch.status);
    }
    if (patch.progress !== undefined) {
      sets.push(`progress = $${p++}`);
      values.push(patch.progress);
    }
    if (patch.currentStage !== undefined) {
      sets.push(`current_stage = $${p++}`);
      values.push(patch.currentStage);
    }
    if (patch.chunksDone !== undefined) {
      sets.push(`chunks_done = $${p++}`);
      values.push(patch.chunksDone);
    }
    if (patch.chunksTotal !== undefined) {
      sets.push(`chunks_total = $${p++}`);
      values.push(patch.chunksTotal);
    }
    if (patch.costUsd !== undefined) {
      sets.push(`cost_usd = $${p++}`);
      values.push(patch.costUsd);
    }
    sets.push(`updated_at = NOW()`);
    values.push(jobId);

    const job = await this.db.withClient(async (client) => {
      const res = await client.query<DbJobRow>(
        `UPDATE ingestion_jobs SET ${sets.join(", ")}
         WHERE id = $${p}
         RETURNING ${SELECT_COLS}`,
        values,
      );
      if (res.rows.length === 0) throw new NotFoundException("任务不存在");
      return mapJob(res.rows[0]);
    });

    const event: IngestionProgressEvent = {
      jobId: job.id,
      projectId: job.projectId,
      documentId: job.documentId,
      status: job.status,
      progress: job.progress,
      currentStage: job.currentStage,
      chunksDone: job.chunksDone,
      chunksTotal: job.chunksTotal,
    };
    this.events.emit(INGESTION_EVENT.progress, event);
    return job;
  }

  /**
   * Runner 在每个 stage 完成时调一次，把摘要写进 stage_outputs JSONB。
   *
   * 用 jsonb_set 而不是整列替换，保证并发安全（虽然单 runner 串行，但写法更稳）；
   * 缺省 stage_outputs 为 NULL 时先 COALESCE 成 '{}' 再 set。
   * 不发 SSE 事件——progress 事件已足够前端轮询触发拉取详情。
   */
  async setStageOutput(
    jobId: string,
    stage: IngestionStage,
    output: IngestionStageOutput,
  ): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query(
        `UPDATE ingestion_jobs
         SET stage_outputs = jsonb_set(
               COALESCE(stage_outputs, '{}'::jsonb),
               $1::text[],
               $2::jsonb,
               true
             ),
             updated_at = NOW()
         WHERE id = $3`,
        [`{${stage}}`, JSON.stringify(output), jobId],
      );
    });
  }

  /** runner 标记任务开始（写 started_at）。 */
  async markStarted(jobId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query(
        `UPDATE ingestion_jobs
         SET status = 'running', started_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [jobId],
      );
    });
  }

  async markSucceeded(jobId: string): Promise<IngestionJobRow> {
    const job = await this.db.withClient(async (client) => {
      const res = await client.query<DbJobRow>(
        `UPDATE ingestion_jobs
         SET status = 'succeeded', progress = 100, finished_at = NOW(), updated_at = NOW(),
             current_stage = NULL
         WHERE id = $1
         RETURNING ${SELECT_COLS}`,
        [jobId],
      );
      if (res.rows.length === 0) throw new NotFoundException("任务不存在");
      return mapJob(res.rows[0]);
    });
    const event: IngestionCompletedEvent = {
      jobId: job.id,
      projectId: job.projectId,
      documentId: job.documentId,
      chunksTotal: job.chunksTotal,
      costUsd: job.costUsd,
    };
    this.events.emit(INGESTION_EVENT.completed, event);
    return job;
  }

  async markFailed(
    jobId: string,
    stage: IngestionStage | null,
    error: string,
  ): Promise<IngestionJobRow> {
    const job = await this.db.withClient(async (client) => {
      const res = await client.query<DbJobRow>(
        `UPDATE ingestion_jobs
         SET status = 'failed', error = $1, current_stage = $2,
             finished_at = NOW(), updated_at = NOW()
         WHERE id = $3
         RETURNING ${SELECT_COLS}`,
        [error, stage, jobId],
      );
      if (res.rows.length === 0) throw new NotFoundException("任务不存在");
      return mapJob(res.rows[0]);
    });
    const event: IngestionFailedEvent = {
      jobId: job.id,
      projectId: job.projectId,
      documentId: job.documentId,
      stage,
      error,
    };
    this.events.emit(INGESTION_EVENT.failed, event);
    return job;
  }
}
