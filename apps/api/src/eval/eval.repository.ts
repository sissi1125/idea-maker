/**
 * EvalRepository — feat-300.5
 *
 * 封装 eval_runs / eval_items 的 SQL，让 service 层关心业务逻辑、repo 关心字段映射。
 * 风格与 AgentRunsRepository 一致（pgClient 注入、JSONB 自己 JSON.stringify）。
 */

import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { DbClient as PgClient } from "../db/db-client";
import type {
  EvalItemResult,
  EvalRunSummary,
} from "./eval.types";

export interface EvalRunRowLite {
  id: string;
  projectId: string;
  status: "running" | "succeeded" | "failed";
  triggeredBy: string;
  gitCommit: string | null;
  gitBranch: string | null;
  baselineRunId: string | null;
  thresholdDrop: number;
  totalItems: number;
  passedItems: number;
  avgFaithfulness: number | null;
  avgCompleteness: number | null;
  avgStyle: number | null;
  avgOverall: number | null;
  createdAt: string;
  finishedAt: string | null;
}

interface DbEvalRunRow {
  id: string;
  project_id: string;
  status: string;
  triggered_by: string;
  git_commit: string | null;
  git_branch: string | null;
  baseline_run_id: string | null;
  threshold_drop: string;
  total_items: number;
  passed_items: number;
  avg_faithfulness: string | null;
  avg_completeness: string | null;
  avg_style: string | null;
  avg_overall: string | null;
  created_at: Date;
  finished_at: Date | null;
}

function mapRun(row: DbEvalRunRow): EvalRunRowLite {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as EvalRunRowLite["status"],
    triggeredBy: row.triggered_by,
    gitCommit: row.git_commit,
    gitBranch: row.git_branch,
    baselineRunId: row.baseline_run_id,
    thresholdDrop: Number(row.threshold_drop),
    totalItems: row.total_items,
    passedItems: row.passed_items,
    avgFaithfulness: row.avg_faithfulness === null ? null : Number(row.avg_faithfulness),
    avgCompleteness: row.avg_completeness === null ? null : Number(row.avg_completeness),
    avgStyle: row.avg_style === null ? null : Number(row.avg_style),
    avgOverall: row.avg_overall === null ? null : Number(row.avg_overall),
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

@Injectable()
export class EvalRepository {
  /**
   * 创建一次 eval_run 行（status='running'）。
   * baselineRunId 由 service 调用方查 latest succeeded run 后传入。
   */
  async createRun(
    pgClient: PgClient,
    input: {
      projectId: string;
      triggeredBy: string;
      gitCommit?: string | null;
      gitBranch?: string | null;
      baselineRunId?: string | null;
      thresholdDrop?: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    await pgClient.query(
      `INSERT INTO eval_runs
         (id, project_id, triggered_by, git_commit, git_branch, baseline_run_id, threshold_drop)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.projectId,
        input.triggeredBy,
        input.gitCommit ?? null,
        input.gitBranch ?? null,
        input.baselineRunId ?? null,
        input.thresholdDrop ?? 0.5,
      ],
    );
    return id;
  }

  /** 写一条 eval_item（每条 golden 的明细） */
  async appendItem(
    pgClient: PgClient,
    evalRunId: string,
    item: EvalItemResult,
  ): Promise<void> {
    const id = randomUUID();
    await pgClient.query(
      `INSERT INTO eval_items
         (id, eval_run_id, agent_run_id, golden_id, query, candidate_text,
          scores, trajectory, passed, judge_rationale, error, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)`,
      [
        id,
        evalRunId,
        item.agentRunId,
        item.goldenId,
        item.query,
        item.candidateText,
        item.scores ? JSON.stringify(item.scores) : null,
        JSON.stringify(item.trajectory),
        item.passed,
        item.judgeRationale,
        item.error,
        item.durationMs,
      ],
    );
  }

  /** 收尾：写聚合分 + status */
  async finalizeRun(
    pgClient: PgClient,
    evalRunId: string,
    summary: Omit<EvalRunSummary, "evalRunId" | "projectId" | "deltaVsBaseline" | "shouldFailCI">,
    status: "succeeded" | "failed",
    error?: string | null,
  ): Promise<void> {
    await pgClient.query(
      `UPDATE eval_runs
       SET status = $1,
           total_items = $2,
           passed_items = $3,
           avg_faithfulness = $4,
           avg_completeness = $5,
           avg_style = $6,
           avg_overall = $7,
           error = $8,
           finished_at = NOW()
       WHERE id = $9`,
      [
        status,
        summary.totalItems,
        summary.passedItems,
        summary.avgFaithfulness,
        summary.avgCompleteness,
        summary.avgStyle,
        summary.avgOverall,
        error ?? null,
        evalRunId,
      ],
    );
  }

  /** 最近一次成功 eval_run（同 project_id），用于 baseline 对比 */
  async findLatestSucceededBaseline(
    pgClient: PgClient,
    projectId: string,
  ): Promise<EvalRunRowLite | null> {
    const { rows } = await pgClient.query<DbEvalRunRow>(
      `SELECT id, project_id, status, triggered_by, git_commit, git_branch,
              baseline_run_id, threshold_drop, total_items, passed_items,
              avg_faithfulness, avg_completeness, avg_style, avg_overall,
              created_at, finished_at
       FROM eval_runs
       WHERE project_id = $1 AND status = 'succeeded'
       ORDER BY finished_at DESC NULLS LAST
       LIMIT 1`,
      [projectId],
    );
    if (rows.length === 0) return null;
    return mapRun(rows[0]);
  }

  async getRun(pgClient: PgClient, runId: string): Promise<EvalRunRowLite | null> {
    const { rows } = await pgClient.query<DbEvalRunRow>(
      `SELECT id, project_id, status, triggered_by, git_commit, git_branch,
              baseline_run_id, threshold_drop, total_items, passed_items,
              avg_faithfulness, avg_completeness, avg_style, avg_overall,
              created_at, finished_at
       FROM eval_runs WHERE id = $1`,
      [runId],
    );
    if (rows.length === 0) return null;
    return mapRun(rows[0]);
  }

  async listRecentByProject(
    pgClient: PgClient,
    projectId: string,
    limit = 20,
  ): Promise<EvalRunRowLite[]> {
    const { rows } = await pgClient.query<DbEvalRunRow>(
      `SELECT id, project_id, status, triggered_by, git_commit, git_branch,
              baseline_run_id, threshold_drop, total_items, passed_items,
              avg_faithfulness, avg_completeness, avg_style, avg_overall,
              created_at, finished_at
       FROM eval_runs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map(mapRun);
  }
}
