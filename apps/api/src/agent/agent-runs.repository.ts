/**
 * AgentRunsRepository — feat-300.3 任务 4
 *
 * 集中所有对 agent_runs / agent_steps 表的读写。AgentRunner / Controller 都通过
 * 它操作 DB，业务逻辑不直接拼 SQL。
 *
 * **为什么单独成 repository 而不是塞进 AgentRunner**：
 *   1. 单测：mock repository 比 mock pg Client 容易得多
 *   2. SQL 集中后未来加索引 / 优化查询只动一个文件
 *   3. controller 也要查 runs/steps（GET 端点），共用同一 API
 *
 * **方法分组**：
 *   - createRun / appendStep / appendStepsFromAiSdk / updateProgress / finalize：写
 *   - getRun / getSteps / listRuns：读
 *
 * 不依赖 NestJS withClient——pgClient 通过参数传入（feat-300.3 plan §3.6 决策）：
 *   AgentRunner 持有 pgClient 整个 run，子组件复用同一连接，事务边界清晰。
 *   controller 的读端点用 DbService.withClient。
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Client as PgClient } from "pg";
import type {
  AgentRunStatus,
  AgentFinishReason,
  StepFramePayload,
} from "./agent.types";

/** 创建 run 的入参 */
export interface CreateRunInput {
  projectId: string;
  generationId?: string;
  maxSteps: number;
  budgetUsd: number;
}

/** agent_runs 一行的精简形态（API 返回 + 内部状态） */
export interface AgentRunRow {
  id: string;
  generationId: string | null;
  projectId: string;
  status: AgentRunStatus;
  maxSteps: number;
  budgetUsd: number;
  stepsUsed: number;
  costUsedUsd: number;
  finishReason: AgentFinishReason | null;
  evalScores: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** agent_steps 一行的精简形态 */
export interface AgentStepRow {
  id: string;
  runId: string;
  stepIndex: number;
  stepType: StepFramePayload["stepType"];
  toolName: string | null;
  input: unknown;
  output: unknown;
  tokenUsage: { promptTokens?: number; completionTokens?: number } | null;
  durationMs: number | null;
  createdAt: Date;
}

interface DbRunRow {
  id: string;
  generation_id: string | null;
  project_id: string;
  status: string;
  max_steps: number;
  budget_usd: string;
  steps_used: number;
  cost_used_usd: string;
  finish_reason: string | null;
  eval_scores: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

interface DbStepRow {
  id: string;
  run_id: string;
  step_index: number;
  step_type: string;
  tool_name: string | null;
  input: unknown;
  output: unknown;
  token_usage: { promptTokens?: number; completionTokens?: number } | null;
  duration_ms: number | null;
  created_at: Date;
}

@Injectable()
export class AgentRunsRepository {
  private readonly logger = new Logger(AgentRunsRepository.name);

  // ─── 写 ──────────────────────────────────────────────────────────────────

  async createRun(pgClient: PgClient, input: CreateRunInput): Promise<string> {
    const runId = randomUUID();
    await pgClient.query(
      `INSERT INTO agent_runs (id, generation_id, project_id, status, max_steps, budget_usd)
       VALUES ($1, $2, $3, 'running', $4, $5)`,
      [runId, input.generationId ?? null, input.projectId, input.maxSteps, input.budgetUsd],
    );
    return runId;
  }

  /**
   * 写一条 agent_steps。stepIndex 由调用方传入（AgentRunner 维护单调递增 counter，
   * 避免 SELECT MAX 子查询的 race condition——log-decision tool 的 TODO 已标）。
   */
  async appendStep(
    pgClient: PgClient,
    runId: string,
    step: {
      stepIndex: number;
      stepType: StepFramePayload["stepType"];
      toolName?: string;
      input?: unknown;
      output?: unknown;
      tokenUsage?: { promptTokens?: number; completionTokens?: number };
      durationMs?: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    await pgClient.query(
      `INSERT INTO agent_steps
        (id, run_id, step_index, step_type, tool_name, input, output, token_usage, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
       ON CONFLICT (run_id, step_index) DO NOTHING`,
      [
        id,
        runId,
        step.stepIndex,
        step.stepType,
        step.toolName ?? null,
        step.input !== undefined ? JSON.stringify(step.input) : null,
        step.output !== undefined ? JSON.stringify(step.output) : null,
        step.tokenUsage ? JSON.stringify(step.tokenUsage) : null,
        step.durationMs ?? null,
      ],
    );
    return id;
  }

  /**
   * v1.0 优化项 1：把 run 启动时拼接好的真实 system prompt + 输入 messages 落库。
   * 给前端「查看上下文」面板显示一字不漏的实际入参——不是再去重新渲染，
   * 而是直接看那一刻真的发给 LLM 的字符串。
   */
  async saveContextSnapshot(
    pgClient: PgClient,
    runId: string,
    systemPrompt: string,
    inputMessages: unknown,
  ): Promise<void> {
    await pgClient.query(
      `UPDATE agent_runs
       SET system_prompt = $2, input_messages = $3::jsonb
       WHERE id = $1`,
      [runId, systemPrompt, JSON.stringify(inputMessages)],
    );
  }

  /** 读 run 的真实上下文快照——给 controller 暴露端点用 */
  async getContextSnapshot(
    pgClient: PgClient,
    runId: string,
  ): Promise<{ systemPrompt: string | null; inputMessages: unknown } | null> {
    const { rows } = await pgClient.query<{
      system_prompt: string | null;
      input_messages: unknown;
    }>(
      `SELECT system_prompt, input_messages FROM agent_runs WHERE id = $1`,
      [runId],
    );
    if (rows.length === 0) return null;
    return {
      systemPrompt: rows[0].system_prompt,
      inputMessages: rows[0].input_messages,
    };
  }

  /**
   * 更新 run 进度（步数 + 累计成本）。每次 onStepFinish 调一次。
   *
   * 用单独方法而非塞进 finalize：finalize 是终态写入，updateProgress 是中间态。
   * 拆开后单测断言更清晰。
   */
  async updateProgress(
    pgClient: PgClient,
    runId: string,
    stepsUsed: number,
    costUsedUsd: number,
  ): Promise<void> {
    await pgClient.query(
      `UPDATE agent_runs
       SET steps_used = $2, cost_used_usd = $3
       WHERE id = $1`,
      [runId, stepsUsed, costUsedUsd],
    );
  }

  /**
   * 收尾：填 status / finish_reason / error / eval_scores / finished_at。
   * 调用方负责传入正确状态：succeeded ↔ finish_reason in (done/max_steps/budget/aborted)，
   * failed ↔ finish_reason='error'。
   */
  async finalize(
    pgClient: PgClient,
    runId: string,
    update: {
      status: AgentRunStatus;
      finishReason: AgentFinishReason;
      error?: string | null;
      evalScores?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await pgClient.query(
      `UPDATE agent_runs
       SET status = $2,
           finish_reason = $3,
           error = $4,
           eval_scores = $5::jsonb,
           finished_at = NOW()
       WHERE id = $1`,
      [
        runId,
        update.status,
        update.finishReason,
        update.error ?? null,
        update.evalScores ? JSON.stringify(update.evalScores) : null,
      ],
    );
  }

  // ─── 读 ──────────────────────────────────────────────────────────────────

  async getRun(pgClient: PgClient, runId: string): Promise<AgentRunRow | null> {
    const { rows } = await pgClient.query<DbRunRow>(
      `SELECT id, generation_id, project_id, status, max_steps, budget_usd,
              steps_used, cost_used_usd, finish_reason, eval_scores, error,
              created_at, finished_at
       FROM agent_runs
       WHERE id = $1`,
      [runId],
    );
    if (rows.length === 0) return null;
    return mapRun(rows[0]);
  }

  async getSteps(
    pgClient: PgClient,
    runId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<AgentStepRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const { rows } = await pgClient.query<DbStepRow>(
      `SELECT id, run_id, step_index, step_type, tool_name,
              input, output, token_usage, duration_ms, created_at
       FROM agent_steps
       WHERE run_id = $1
       ORDER BY step_index ASC
       LIMIT $2 OFFSET $3`,
      [runId, limit, offset],
    );
    return rows.map(mapStep);
  }

  /** 项目维度列出 runs；admin / 历史列表用 */
  async listRunsByProject(
    pgClient: PgClient,
    projectId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<AgentRunRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const { rows } = await pgClient.query<DbRunRow>(
      `SELECT id, generation_id, project_id, status, max_steps, budget_usd,
              steps_used, cost_used_usd, finish_reason, eval_scores, error,
              created_at, finished_at
       FROM agent_runs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [projectId, limit, offset],
    );
    return rows.map(mapRun);
  }
}

// ─── row mapper（snake_case → camelCase + number cast） ──────────────────────

function mapRun(row: DbRunRow): AgentRunRow {
  return {
    id: row.id,
    generationId: row.generation_id,
    projectId: row.project_id,
    status: row.status as AgentRunStatus,
    maxSteps: row.max_steps,
    budgetUsd: Number(row.budget_usd),
    stepsUsed: row.steps_used,
    costUsedUsd: Number(row.cost_used_usd),
    finishReason: row.finish_reason as AgentFinishReason | null,
    evalScores: row.eval_scores,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

function mapStep(row: DbStepRow): AgentStepRow {
  return {
    id: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    stepType: row.step_type as StepFramePayload["stepType"],
    toolName: row.tool_name,
    input: row.input,
    output: row.output,
    tokenUsage: row.token_usage,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}
