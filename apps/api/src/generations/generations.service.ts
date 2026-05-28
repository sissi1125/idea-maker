/**
 * GenerationsService — feat-200.3 Week 3 + feat-200.4 Week 4
 *
 * 职责：
 *   1. 发起一次 generate：创建 generation 记录 → 调 orchestrator → 更新记录 → 写 cost_summary
 *   2. 查询 generation 列表（cursor 分页 + 过滤）/ 单条详情
 *   3. 提供 `runForProject`：跳过 owner 校验，供 AutoGenerations 内部触发使用
 *
 * 设计选择：
 *   - generate 是同步的（不像 ingestion 那样 setImmediate 异步），因为前端需要等结果
 *   - 后续 Week 8 如果需要 SSE 进度推送，可以把 orchestrator 改为 emit stage events
 *   - cost 累计通过 TraceContextService（ALS 自动跟踪本次请求的所有 stage 调用）
 *   - feat-200.4 在 succeeded 分支额外写 cost_summary（按 UTC day 做 ON CONFLICT upsert）
 *
 * cursor 分页设计：
 *   - 服务端语义：(created_at DESC, id DESC) 复合排序保证稳定
 *   - cursor = base64({createdAt, id})；服务端解码后用 keyset where 过滤
 *   - 不用 OFFSET：分页深处时 OFFSET 会随写入抖动且性能差
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DbService } from "../db/db.service";
import { PipelineOrchestratorService } from "../pipeline-orchestrator/pipeline-orchestrator.service";
import { TraceContextService } from "../common/trace-context.service";
import { PlatformRulesService } from "../platform-rules/platform-rules.service";
import {
  buildRuleSystemPrompt,
  validateAgainstRules,
} from "../platform-rules/rule-validator";
import type { GenerationRow, GenerateResponse } from "../pipeline-orchestrator/pipeline-orchestrator.types";

export type GenerationSource = "manual" | "auto";

export interface GenerateOptions {
  source?: GenerationSource;
  /** 跳过 owner 校验（仅供 AutoGenerationsService 等可信内部调用使用） */
  skipOwnerCheck?: boolean;
  /** feat-200.8：本次 generate 要应用的平台规则 ID 列表 */
  platformRuleIds?: string[];
}

export interface ListGenerationsOptions {
  limit?: number;
  cursor?: string;
  status?: string;
  source?: GenerationSource;
}

export interface ListGenerationsResult {
  generations: GenerationRow[];
  nextCursor: string | null;
}

@Injectable()
export class GenerationsService {
  constructor(
    private readonly db: DbService,
    private readonly orchestrator: PipelineOrchestratorService,
    private readonly tracer: TraceContextService,
    private readonly platformRules: PlatformRulesService,
  ) {}

  /**
   * 执行一次完整 generate 并持久化结果。
   * userId 可为 null 时必须配合 skipOwnerCheck=true（auto-gen 路径）。
   */
  async generate(
    userId: string | null,
    projectId: string,
    query: string,
    opts: GenerateOptions = {},
  ): Promise<GenerateResponse> {
    if (!opts.skipOwnerCheck) {
      if (!userId) {
        throw new BadRequestException("userId 缺失");
      }
      await this.verifyProjectOwnership(userId, projectId);
    }

    const source: GenerationSource = opts.source ?? "manual";
    const generationId = randomUUID();
    const startMs = Date.now();

    await this.db.withClient(async (client) => {
      await client.query(
        `INSERT INTO generations (id, project_id, query, status, source)
         VALUES ($1, $2, $3, 'running', $4)`,
        [generationId, projectId, query, source],
      );
    });

    let response: GenerateResponse;

    // feat-200.8：加载启用的平台规则——空数组时跳过注入和校验
    const rules = opts.platformRuleIds?.length
      ? await this.platformRules.listEnabledByIds(projectId, opts.platformRuleIds)
      : [];
    const ruleSystemPrompt = buildRuleSystemPrompt(rules);

    try {
      const { trace, resultNotes, retrievedChunks } = await this.orchestrator.run(query, {
        ruleSystemPrompt,
      });
      const durationMs = Date.now() - startMs;
      const cost = trace.cost;

      // feat-200.8：跑后置 validator——硬约束检查 LLM 是否真的遵守了规则
      const violations = resultNotes
        ? validateAgainstRules(resultNotes, rules)
        : [];

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

        // 累计项目总成本
        if (cost.costUsd > 0) {
          await client.query(
            `UPDATE projects SET total_cost_usd = total_cost_usd + $1, updated_at = NOW() WHERE id = $2`,
            [cost.costUsd, projectId],
          );
        }

        // 按天 upsert cost_summary（即便 costUsd=0 也累计 generations_count，便于看活跃度）
        await client.query(
          `INSERT INTO cost_summary
             (project_id, day, generations_count,
              llm_tokens_prompt, llm_tokens_completion,
              embedding_calls, retrieval_calls, reranker_calls,
              cost_usd, updated_at)
           VALUES ($1, (NOW() AT TIME ZONE 'UTC')::date, 1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (project_id, day) DO UPDATE SET
             generations_count     = cost_summary.generations_count + 1,
             llm_tokens_prompt     = cost_summary.llm_tokens_prompt + EXCLUDED.llm_tokens_prompt,
             llm_tokens_completion = cost_summary.llm_tokens_completion + EXCLUDED.llm_tokens_completion,
             embedding_calls       = cost_summary.embedding_calls + EXCLUDED.embedding_calls,
             retrieval_calls       = cost_summary.retrieval_calls + EXCLUDED.retrieval_calls,
             reranker_calls        = cost_summary.reranker_calls + EXCLUDED.reranker_calls,
             cost_usd              = cost_summary.cost_usd + EXCLUDED.cost_usd,
             updated_at            = NOW()`,
          [
            projectId,
            cost.llmTokensPrompt,
            cost.llmTokensCompletion,
            cost.embeddingCalls,
            cost.retrievalCalls,
            cost.rerankerCalls,
            cost.costUsd,
          ],
        );
      });

      response = {
        generationId,
        status: "succeeded",
        query,
        resultNotes,
        pipelineTrace: trace,
        retrievedChunks,
        costBreakdown: cost,
        durationMs,
        violations,
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
        violations: [],
      };
    }

    return response;
  }

  /**
   * cursor 分页 + 过滤。
   * - limit 默认 20，区间 [1, 100]
   * - cursor: base64({createdAt, id})；首次请求传 undefined
   * - 过滤：status / source（可选）
   */
  async listByProject(
    userId: string,
    projectId: string,
    options: ListGenerationsOptions = {},
  ): Promise<ListGenerationsResult> {
    await this.verifyProjectOwnership(userId, projectId);

    const limit = clampLimit(options.limit);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

    const params: unknown[] = [projectId];
    let sql = `SELECT id, project_id, query, status, source, pipeline_trace, retrieved_chunks,
                      result_notes, cost_breakdown, error, duration_ms, created_at, updated_at
               FROM generations
               WHERE project_id = $1`;

    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      sql += ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`;
    }
    if (options.status) {
      params.push(options.status);
      sql += ` AND status = $${params.length}`;
    }
    if (options.source) {
      params.push(options.source);
      sql += ` AND source = $${params.length}`;
    }

    // 多取一条用于判断是否还有下一页
    params.push(limit + 1);
    sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

    return this.db.withClient(async (client) => {
      const { rows } = await client.query(sql, params);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const mapped = page.map(this.mapRow);
      const nextCursor = hasMore
        ? encodeCursor({
            createdAt: (page[page.length - 1].created_at as Date).toISOString(),
            id: page[page.length - 1].id as string,
          })
        : null;
      return { generations: mapped, nextCursor };
    });
  }

  /** 获取单条 generation 详情 */
  async getGeneration(userId: string, projectId: string, generationId: string): Promise<GenerationRow> {
    await this.verifyProjectOwnership(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, project_id, query, status, source, pipeline_trace, retrieved_chunks,
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

  /** 内部用：确认 generation 存在并归属指定 user 拥有的 project，返回基本信息 */
  async assertOwnedByUser(
    userId: string,
    generationId: string,
  ): Promise<{ id: string; projectId: string }> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT g.id, g.project_id
         FROM generations g
         JOIN projects p ON p.id = g.project_id
         WHERE g.id = $1 AND p.owner_id = $2`,
        [generationId, userId],
      );
      if (rows.length === 0) {
        throw new NotFoundException("Generation 不存在");
      }
      return { id: rows[0].id as string, projectId: rows[0].project_id as string };
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
      source: (row.source as string) ?? "manual",
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

// ── helpers ─────────────────────────────────────────────────────────────────

function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return 20;
  if (limit > 100) return 100;
  return Math.floor(limit);
}

interface DecodedCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: DecodedCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string): DecodedCursor {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as DecodedCursor;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("cursor 字段缺失");
    }
    // 简单校验 ISO 时间
    if (Number.isNaN(Date.parse(parsed.createdAt))) {
      throw new Error("cursor 时间无效");
    }
    return parsed;
  } catch {
    throw new BadRequestException("cursor 参数无效");
  }
}
