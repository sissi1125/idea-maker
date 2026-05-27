/**
 * GenerationsService — feat-200.3 Week 3
 *
 * 职责：
 *   1. 发起一次 generate：创建 generation 记录 → 调 orchestrator → 更新记录
 *   2. 查询 generation 列表 / 单条详情
 *
 * 设计选择：
 *   - generate 是同步的（不像 ingestion 那样 setImmediate 异步），因为前端需要等结果
 *   - 后续 Week 8 如果需要 SSE 进度推送，可以把 orchestrator 改为 emit stage events
 *   - cost 累计通过 TraceContextService（ALS 自动跟踪本次请求的所有 stage 调用）
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import { PipelineOrchestratorService } from "../pipeline-orchestrator/pipeline-orchestrator.service";
import { TraceContextService } from "../common/trace-context.service";
import type { GenerationRow, GenerateResponse } from "../pipeline-orchestrator/pipeline-orchestrator.types";

@Injectable()
export class GenerationsService {
  constructor(
    private readonly db: DbService,
    private readonly orchestrator: PipelineOrchestratorService,
    private readonly tracer: TraceContextService,
  ) {}

  /**
   * 执行一次完整 generate 并持久化结果。
   * 返回 GenerateResponse（含 pipeline_trace + cost_breakdown）。
   */
  async generate(userId: string, projectId: string, query: string): Promise<GenerateResponse> {
    // 验证项目归属
    await this.verifyProjectOwnership(userId, projectId);

    const generationId = randomUUID();
    const startMs = Date.now();

    // 插入 running 状态记录
    await this.db.withClient(async (client) => {
      await client.query(
        `INSERT INTO generations (id, project_id, query, status) VALUES ($1, $2, $3, 'running')`,
        [generationId, projectId, query],
      );
    });

    let response: GenerateResponse;

    try {
      const { trace, resultNotes, retrievedChunks } = await this.orchestrator.run(query);
      const durationMs = Date.now() - startMs;
      const cost = trace.cost;

      // 更新为 succeeded
      await this.db.withClient(async (client) => {
        await client.query(
          `UPDATE generations
           SET status = 'succeeded',
               pipeline_trace = $1,
               retrieved_chunks = $2,
               result_notes = $3,
               cost_breakdown = $4,
               duration_ms = $5,
               updated_at = NOW()
           WHERE id = $6`,
          [
            JSON.stringify(trace),
            JSON.stringify(retrievedChunks),
            resultNotes,
            JSON.stringify(cost),
            durationMs,
            generationId,
          ],
        );
      });

      // 累计项目总成本
      if (cost.costUsd > 0) {
        await this.db.withClient(async (client) => {
          await client.query(
            `UPDATE projects SET total_cost_usd = total_cost_usd + $1, updated_at = NOW() WHERE id = $2`,
            [cost.costUsd, projectId],
          );
        });
      }

      response = {
        generationId,
        status: "succeeded",
        query,
        resultNotes,
        pipelineTrace: trace,
        retrievedChunks,
        costBreakdown: cost,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const cost = this.tracer.current()?.cost ?? {
        llmTokensPrompt: 0, llmTokensCompletion: 0,
        embeddingCalls: 0, retrievalCalls: 0, rerankerCalls: 0, costUsd: 0,
      };

      await this.db.withClient(async (client) => {
        await client.query(
          `UPDATE generations SET status = 'failed', error = $1, cost_breakdown = $2, duration_ms = $3, updated_at = NOW() WHERE id = $4`,
          [errorMsg, JSON.stringify(cost), durationMs, generationId],
        );
      });

      response = {
        generationId,
        status: "failed",
        query,
        resultNotes: null,
        pipelineTrace: { pipelineName: "default", pipelineVersion: "1.0.0", stages: [], totalDurationMs: durationMs, cost },
        retrievedChunks: [],
        costBreakdown: cost,
        durationMs,
        error: errorMsg,
      };
    }

    return response;
  }

  /** 列出项目的 generation 历史（最新 50 条） */
  async listByProject(userId: string, projectId: string): Promise<GenerationRow[]> {
    await this.verifyProjectOwnership(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, project_id, query, status, pipeline_trace, retrieved_chunks,
                result_notes, cost_breakdown, error, duration_ms, created_at, updated_at
         FROM generations
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [projectId],
      );
      return rows.map(this.mapRow);
    });
  }

  /** 获取单条 generation 详情 */
  async getGeneration(userId: string, projectId: string, generationId: string): Promise<GenerationRow> {
    await this.verifyProjectOwnership(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, project_id, query, status, pipeline_trace, retrieved_chunks,
                result_notes, cost_breakdown, error, duration_ms, created_at, updated_at
         FROM generations
         WHERE id = $1 AND project_id = $2`,
        [generationId, projectId],
      );
      if (rows.length === 0) {
        throw new NotFoundException("Generation 不存在");
      }
      return this.mapRow(rows[0]);
    });
  }

  private async verifyProjectOwnership(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) {
        throw new NotFoundException("项目不存在");
      }
    });
  }

  private mapRow(row: Record<string, unknown>): GenerationRow {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      query: row.query as string,
      status: row.status as string,
      pipelineTrace: row.pipeline_trace as GenerationRow["pipelineTrace"],
      retrievedChunks: row.retrieved_chunks as GenerationRow["retrievedChunks"],
      resultNotes: row.result_notes as string | null,
      costBreakdown: row.cost_breakdown as GenerationRow["costBreakdown"],
      error: row.error as string | null,
      durationMs: row.duration_ms as number | null,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}
