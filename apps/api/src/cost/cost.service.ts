/**
 * CostService — feat-200.4 Week 4
 *
 * 查询职责：从 cost_summary 表按日期范围查询项目级成本汇总。
 *
 * 写入由谁负责：
 *   - GenerationsService 在 generate 成功后做 ON CONFLICT upsert（按 UTC day）
 *   - 这里只读，不维护写入路径，避免双写脏数据
 *
 * 日期范围语义：
 *   - 默认查最近 30 天（含今日，UTC）
 *   - from/to 都按 UTC 解析；前端如需本地时区展示，自己转
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DbService } from "../db/db.service";
import type { CostDailyRow, CostSummaryResponse } from "./cost.types";

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 180;

@Injectable()
export class CostService {
  constructor(private readonly db: DbService) {}

  async getProjectSummary(
    userId: string,
    projectId: string,
    options: { from?: string; to?: string } = {},
  ): Promise<CostSummaryResponse> {
    const { from, to } = resolveRange(options);

    await this.verifyProjectOwnership(userId, projectId);

    const daily = await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT day, generations_count, llm_tokens_prompt, llm_tokens_completion,
                embedding_calls, retrieval_calls, reranker_calls, cost_usd
         FROM cost_summary
         WHERE project_id = $1 AND day >= $2 AND day <= $3
         ORDER BY day ASC`,
        [projectId, from, to],
      );
      return rows.map(mapDailyRow);
    });

    const totals = daily.reduce(
      (acc, row) => ({
        generationsCount:    acc.generationsCount    + row.generationsCount,
        llmTokensPrompt:     acc.llmTokensPrompt     + row.llmTokensPrompt,
        llmTokensCompletion: acc.llmTokensCompletion + row.llmTokensCompletion,
        embeddingCalls:      acc.embeddingCalls      + row.embeddingCalls,
        retrievalCalls:      acc.retrievalCalls      + row.retrievalCalls,
        rerankerCalls:       acc.rerankerCalls       + row.rerankerCalls,
        costUsd:             acc.costUsd             + row.costUsd,
      }),
      {
        generationsCount: 0, llmTokensPrompt: 0, llmTokensCompletion: 0,
        embeddingCalls: 0, retrievalCalls: 0, rerankerCalls: 0, costUsd: 0,
      },
    );

    return { projectId, range: { from, to }, totals, daily };
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
}

// ── helpers ─────────────────────────────────────────────────────────────────

function resolveRange(options: { from?: string; to?: string }): { from: string; to: string } {
  const today = utcDate(new Date());
  const to = options.to ? parseDate(options.to, "to") : today;
  const from = options.from
    ? parseDate(options.from, "from")
    : addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) {
    throw new BadRequestException("from 必须早于或等于 to");
  }
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new BadRequestException(`查询区间不能超过 ${MAX_RANGE_DAYS} 天`);
  }
  return { from, to };
}

/** 仅接受 YYYY-MM-DD 字符串，避免时区歧义 */
function parseDate(raw: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException(`${field} 必须为 YYYY-MM-DD`);
  }
  if (Number.isNaN(Date.parse(raw + "T00:00:00Z"))) {
    throw new BadRequestException(`${field} 不是合法日期`);
  }
  return raw;
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return utcDate(d);
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  return Math.round(ms / 86_400_000);
}

function mapDailyRow(row: Record<string, unknown>): CostDailyRow {
  // pg 把 DATE 返回成 Date 对象（local midnight）；统一格式化为 UTC YYYY-MM-DD
  const dayRaw = row.day;
  const day = dayRaw instanceof Date ? formatDateUtc(dayRaw) : String(dayRaw).slice(0, 10);
  return {
    day,
    generationsCount: Number(row.generations_count ?? 0),
    llmTokensPrompt: Number(row.llm_tokens_prompt ?? 0),
    llmTokensCompletion: Number(row.llm_tokens_completion ?? 0),
    embeddingCalls: Number(row.embedding_calls ?? 0),
    retrievalCalls: Number(row.retrieval_calls ?? 0),
    rerankerCalls: Number(row.reranker_calls ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
  };
}

function formatDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
