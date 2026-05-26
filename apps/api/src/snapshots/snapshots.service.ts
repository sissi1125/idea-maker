/**
 * SnapshotsService — Stage snapshots + Pipeline run history 的 DB 封装。
 *
 * 把 apps/web/lib/snapshotDb.ts 的逻辑搬到 NestJS Service：
 *   - DDL 初始化（init）
 *   - upsertStageSnapshot / getLatestStageSnapshot / listAllSnapshots
 *   - insertPipelineRun / listPipelineRuns / getPipelineRun
 *
 * lifecycle 仍按"每请求 new + try/finally end"管理（pg pool 留给后续）。
 */

import { Injectable } from "@nestjs/common";
import { Client as PgClient } from "pg";

export interface StageSnapshot {
  id: string;
  stageId: string;
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: unknown | null;
  output: unknown;
  durationMs: number;
  createdAt: string;
}

export interface PipelineRunStageEntry {
  methodId: string;
  params: Record<string, unknown>;
  output: unknown;
  trace: unknown;
  durationMs: number;
  status: string;
  warnings?: string[];
}

export interface PipelineRunRecord {
  id: string;
  name: string;
  documentId?: string;
  stages: Record<string, PipelineRunStageEntry>;
  stageCount: number;
  createdAt: string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS stage_snapshots (
  id              TEXT PRIMARY KEY,
  stage_id        TEXT NOT NULL,
  method_id       TEXT NOT NULL,
  params          JSONB NOT NULL DEFAULT '{}',
  upstream_output JSONB,
  output          JSONB,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_snapshots_stage_id
  ON stage_snapshots (stage_id);

CREATE TABLE IF NOT EXISTS pipeline_run_history (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  document_id TEXT,
  stages      JSONB NOT NULL DEFAULT '{}',
  stage_count INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_history_created_at
  ON pipeline_run_history (created_at DESC);
`;

export function unwrapError(err: unknown): string {
  const unwrapped =
    err instanceof AggregateError && err.errors?.length > 0 ? err.errors[0] : err;
  const e = unwrapped as Record<string, unknown>;
  return typeof e?.message === "string" ? e.message : String(err);
}

@Injectable()
export class SnapshotsService {
  resolveConnectionString(paramCs?: string): string | null {
    const cs = typeof paramCs === "string" && paramCs.trim() ? paramCs.trim() : null;
    return cs ?? process.env.DATABASE_URL ?? null;
  }

  async init(client: PgClient): Promise<void> {
    await client.query(DDL);
  }

  // ─── Stage Snapshot CRUD ───────────────────────────────────────────────────

  async upsertStageSnapshot(
    client: PgClient,
    snap: Omit<StageSnapshot, "createdAt">,
  ): Promise<void> {
    await client.query(
      `INSERT INTO stage_snapshots
         (id, stage_id, method_id, params, upstream_output, output, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (stage_id) DO UPDATE SET
         id              = EXCLUDED.id,
         method_id       = EXCLUDED.method_id,
         params          = EXCLUDED.params,
         upstream_output = EXCLUDED.upstream_output,
         output          = EXCLUDED.output,
         duration_ms     = EXCLUDED.duration_ms,
         created_at      = NOW()`,
      [
        snap.id,
        snap.stageId,
        snap.methodId,
        JSON.stringify(snap.params),
        snap.upstreamOutput != null ? JSON.stringify(snap.upstreamOutput) : null,
        snap.output != null ? JSON.stringify(snap.output) : null,
        snap.durationMs,
      ],
    );
  }

  async getLatestStageSnapshot(
    client: PgClient,
    stageId: string,
  ): Promise<StageSnapshot | null> {
    const res = await client.query<{
      id: string;
      stage_id: string;
      method_id: string;
      params: Record<string, unknown>;
      upstream_output: unknown;
      output: unknown;
      duration_ms: number;
      created_at: Date;
    }>(
      `SELECT id, stage_id, method_id, params, upstream_output, output, duration_ms, created_at
       FROM stage_snapshots WHERE stage_id = $1 LIMIT 1`,
      [stageId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      stageId: r.stage_id,
      methodId: r.method_id,
      params: r.params,
      upstreamOutput: r.upstream_output,
      output: r.output,
      durationMs: r.duration_ms,
      createdAt: r.created_at.toISOString(),
    };
  }

  async listAllSnapshots(client: PgClient): Promise<StageSnapshot[]> {
    const res = await client.query<{
      id: string;
      stage_id: string;
      method_id: string;
      params: Record<string, unknown>;
      upstream_output: unknown;
      output: unknown;
      duration_ms: number;
      created_at: Date;
    }>(
      `SELECT id, stage_id, method_id, params, upstream_output, output, duration_ms, created_at
       FROM stage_snapshots ORDER BY created_at DESC`,
    );
    return res.rows.map((r) => ({
      id: r.id,
      stageId: r.stage_id,
      methodId: r.method_id,
      params: r.params,
      upstreamOutput: r.upstream_output,
      output: r.output,
      durationMs: r.duration_ms,
      createdAt: r.created_at.toISOString(),
    }));
  }

  // ─── Pipeline Run History CRUD ─────────────────────────────────────────────

  async insertPipelineRun(
    client: PgClient,
    run: Omit<PipelineRunRecord, "createdAt">,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pipeline_run_history (id, name, document_id, stages, stage_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        run.id,
        run.name,
        run.documentId ?? null,
        JSON.stringify(run.stages),
        run.stageCount,
      ],
    );
  }

  async listPipelineRuns(
    client: PgClient,
    limit = 50,
  ): Promise<Omit<PipelineRunRecord, "stages">[]> {
    const res = await client.query<{
      id: string;
      name: string;
      document_id: string | null;
      stage_count: number;
      created_at: Date;
    }>(
      `SELECT id, name, document_id, stage_count, created_at
       FROM pipeline_run_history ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      documentId: r.document_id ?? undefined,
      stageCount: r.stage_count,
      createdAt: r.created_at.toISOString(),
      stages: {},
    }));
  }

  async getPipelineRun(
    client: PgClient,
    id: string,
  ): Promise<PipelineRunRecord | null> {
    const res = await client.query<{
      id: string;
      name: string;
      document_id: string | null;
      stages: Record<string, PipelineRunStageEntry>;
      stage_count: number;
      created_at: Date;
    }>(
      `SELECT id, name, document_id, stages, stage_count, created_at
       FROM pipeline_run_history WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      documentId: r.document_id ?? undefined,
      stages: r.stages,
      stageCount: r.stage_count,
      createdAt: r.created_at.toISOString(),
    };
  }
}
