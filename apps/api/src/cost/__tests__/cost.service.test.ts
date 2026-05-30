/**
 * CostService.recordGeneration 单测：
 *  - SQL 入参形态
 *  - ON CONFLICT 子句正确（accumulate vs replace）
 *  - 不依赖 DbService（pgClient 通过参数注入）
 */

import { describe, expect, it, vi } from "vitest";
import { CostService } from "../cost.service";

function makeCostService() {
  // db: DbService 仅用于 getProjectSummary，recordGeneration 直接用 pgClient 参数
  return new CostService({} as never);
}

describe("CostService.recordGeneration", () => {
  it("INSERT INTO cost_summary 含 ON CONFLICT 子句 + 累加各字段", async () => {
    const pg = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const svc = makeCostService();
    await svc.recordGeneration(pg as never, "proj-1", {
      llmTokensPrompt: 100,
      llmTokensCompletion: 50,
      embeddingCalls: 2,
      retrievalCalls: 1,
      rerankerCalls: 1,
      costUsd: 0.0123,
    });
    const [sql, args] = pg.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO cost_summary/);
    expect(sql).toMatch(/ON CONFLICT \(project_id, day\) DO UPDATE/);
    // 关键：累加而非替换（否则同一天多次 generate 会丢数据）
    expect(sql).toMatch(/generations_count\s*=\s*cost_summary\.generations_count\s*\+\s*1/);
    expect(sql).toMatch(/cost_usd\s*=\s*cost_summary\.cost_usd\s*\+\s*EXCLUDED\.cost_usd/);
    expect(args).toEqual(["proj-1", 100, 50, 2, 1, 1, 0.0123]);
  });

  it("day 取 UTC 当天（NOW() AT TIME ZONE 'UTC'）", async () => {
    const pg = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const svc = makeCostService();
    await svc.recordGeneration(pg as never, "p", {
      llmTokensPrompt: 0,
      llmTokensCompletion: 0,
      embeddingCalls: 0,
      retrievalCalls: 0,
      rerankerCalls: 0,
      costUsd: 0,
    });
    const [sql] = pg.query.mock.calls[0];
    // 防跨时区脏数据：必须用 UTC 而不是 CURRENT_DATE（local）
    expect(sql).toMatch(/NOW\(\)\s*AT\s*TIME\s*ZONE\s*'UTC'/);
  });

  it("costUsd=0 也写入（追踪'活跃度'用）", async () => {
    const pg = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const svc = makeCostService();
    await svc.recordGeneration(pg as never, "p", {
      llmTokensPrompt: 0,
      llmTokensCompletion: 0,
      embeddingCalls: 0,
      retrievalCalls: 0,
      rerankerCalls: 0,
      costUsd: 0,
    });
    expect(pg.query).toHaveBeenCalledOnce();
  });
});
