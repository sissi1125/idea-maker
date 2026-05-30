/**
 * AgentRunsRepository 单测：SQL 入参形态 + row mapper + 边界。
 *
 * 用 mock pgClient.query，不依赖真实 DB。
 */

import { describe, expect, it, vi } from "vitest";
import { AgentRunsRepository } from "../agent-runs.repository";

function makePg(rows: unknown[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

describe("AgentRunsRepository.createRun", () => {
  it("INSERT 入参形态 + 返回新 uuid", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    const runId = await repo.createRun(pg as never, {
      projectId: "p-1",
      generationId: "g-1",
      maxSteps: 12,
      budgetUsd: 0.2,
    });
    expect(runId).toMatch(/^[\da-f-]{36}$/);
    const [sql, args] = pg.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO agent_runs/);
    expect(args).toEqual([runId, "g-1", "p-1", 12, 0.2]);
  });

  it("generationId 为空时传 null", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    await repo.createRun(pg as never, {
      projectId: "p",
      maxSteps: 8,
      budgetUsd: 0.1,
    });
    expect(pg.query.mock.calls[0][1][1]).toBeNull();
  });
});

describe("AgentRunsRepository.appendStep", () => {
  it("基本参数形态", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    const id = await repo.appendStep(pg as never, "r-1", {
      stepIndex: 0,
      stepType: "tool_call",
      toolName: "search_kb",
      input: { query: "护肤" },
      output: { chunks: [] },
      tokenUsage: { promptTokens: 100, completionTokens: 50 },
      durationMs: 1200,
    });
    expect(id).toMatch(/^[\da-f-]{36}$/);
    const [, args] = pg.query.mock.calls[0];
    expect(args[0]).toBe(id);
    expect(args[1]).toBe("r-1");
    expect(args[2]).toBe(0);
    expect(args[3]).toBe("tool_call");
    expect(args[4]).toBe("search_kb");
    expect(JSON.parse(args[5])).toEqual({ query: "护肤" });
    expect(JSON.parse(args[6])).toEqual({ chunks: [] });
    expect(JSON.parse(args[7])).toEqual({ promptTokens: 100, completionTokens: 50 });
    expect(args[8]).toBe(1200);
  });

  it("可选字段全空时正确传 null", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    await repo.appendStep(pg as never, "r", { stepIndex: 0, stepType: "reasoning" });
    const [, args] = pg.query.mock.calls[0];
    expect(args[4]).toBeNull(); // tool_name
    expect(args[5]).toBeNull(); // input
    expect(args[6]).toBeNull(); // output
    expect(args[7]).toBeNull(); // token_usage
    expect(args[8]).toBeNull(); // duration_ms
  });

  it("SQL 含 ON CONFLICT 防重复 step_index 并发", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    await repo.appendStep(pg as never, "r", { stepIndex: 0, stepType: "reasoning" });
    const [sql] = pg.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(run_id, step_index\) DO NOTHING/);
  });
});

describe("AgentRunsRepository.updateProgress + finalize", () => {
  it("updateProgress 传步数 + 累计成本", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    await repo.updateProgress(pg as never, "r", 5, 0.075);
    const [sql, args] = pg.query.mock.calls[0];
    expect(sql).toMatch(/steps_used = \$2/);
    expect(args).toEqual(["r", 5, 0.075]);
  });

  it("finalize 写终态 + finished_at NOW()", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    await repo.finalize(pg as never, "r", {
      status: "succeeded",
      finishReason: "done",
      evalScores: { faithfulness: 4.5 },
    });
    const [sql, args] = pg.query.mock.calls[0];
    expect(sql).toMatch(/finished_at = NOW\(\)/);
    expect(args[0]).toBe("r");
    expect(args[1]).toBe("succeeded");
    expect(args[2]).toBe("done");
    expect(args[3]).toBeNull(); // error
    expect(JSON.parse(args[4])).toEqual({ faithfulness: 4.5 });
  });

  it("finalize 失败时 error 入库 + 无 evalScores", async () => {
    const pg = makePg();
    const repo = new AgentRunsRepository();
    await repo.finalize(pg as never, "r", {
      status: "failed",
      finishReason: "error",
      error: "Internal error: abc123",
    });
    const [, args] = pg.query.mock.calls[0];
    expect(args[3]).toBe("Internal error: abc123");
    expect(args[4]).toBeNull();
  });
});

describe("AgentRunsRepository.getRun + getSteps + listRunsByProject", () => {
  it("getRun: 命中行映射为 camelCase + numeric cast", async () => {
    const pg = makePg([
      {
        id: "r",
        generation_id: "g",
        project_id: "p",
        status: "succeeded",
        max_steps: 12,
        budget_usd: "0.200000",
        steps_used: 5,
        cost_used_usd: "0.075000",
        finish_reason: "done",
        eval_scores: null,
        error: null,
        created_at: new Date("2026-05-30"),
        finished_at: new Date("2026-05-30"),
      },
    ]);
    const repo = new AgentRunsRepository();
    const run = await repo.getRun(pg as never, "r");
    expect(run).not.toBeNull();
    expect(run!.id).toBe("r");
    expect(run!.budgetUsd).toBe(0.2);
    expect(run!.costUsedUsd).toBe(0.075);
    expect(run!.finishReason).toBe("done");
  });

  it("getRun: 未命中返 null", async () => {
    const pg = makePg([]);
    const repo = new AgentRunsRepository();
    const run = await repo.getRun(pg as never, "x");
    expect(run).toBeNull();
  });

  it("getSteps: 默认 limit=200，按 step_index ASC", async () => {
    const pg = makePg([
      {
        id: "s1",
        run_id: "r",
        step_index: 0,
        step_type: "reasoning",
        tool_name: null,
        input: { x: 1 },
        output: { y: 2 },
        token_usage: null,
        duration_ms: 100,
        created_at: new Date(),
      },
    ]);
    const repo = new AgentRunsRepository();
    const steps = await repo.getSteps(pg as never, "r");
    expect(steps).toHaveLength(1);
    expect(steps[0].stepIndex).toBe(0);
    expect(steps[0].durationMs).toBe(100);
    const [sql, args] = pg.query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY step_index ASC/);
    expect(args[1]).toBe(200);
  });

  it("getSteps: limit 上限 500 + 下限 1", async () => {
    const pg = makePg([]);
    const repo = new AgentRunsRepository();
    await repo.getSteps(pg as never, "r", { limit: 10000 });
    expect(pg.query.mock.calls[0][1][1]).toBe(500);
    pg.query.mockClear();
    await repo.getSteps(pg as never, "r", { limit: 0 });
    expect(pg.query.mock.calls[0][1][1]).toBe(1);
  });

  it("listRunsByProject: 入参带项目 + 默认 limit", async () => {
    const pg = makePg([]);
    const repo = new AgentRunsRepository();
    await repo.listRunsByProject(pg as never, "p-1");
    const [, args] = pg.query.mock.calls[0];
    expect(args[0]).toBe("p-1");
    expect(args[1]).toBe(20);
  });
});
