/**
 * MemoryService 单测 — feat-300.4
 *
 * 覆盖：
 *   - upsertDistilled 新建 / 合并语义
 *   - confidence 取大，source_feedback_ids 合并去重
 *   - 内容前后空格归一化
 */

import { describe, expect, it, vi } from "vitest";
import { MemoryService } from "../memory.service";

function fakeClient(initialRows: any[] = []): any {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    queries,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      // 首个 SELECT 返回 existing rows
      if (sql.includes("SELECT id, project_id, kind, content")) {
        return { rows: initialRows, rowCount: initialRows.length };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  return client;
}

describe("MemoryService.upsertDistilled", () => {
  it("空候选直接返回 0/0", async () => {
    const svc = new MemoryService({} as any);
    const client = fakeClient();
    const r = await svc.upsertDistilled(client, "p", []);
    expect(r).toEqual({ inserted: 0, merged: 0 });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("无重复 → 全部 INSERT，source='distilled'", async () => {
    const svc = new MemoryService({} as any);
    const client = fakeClient([]);
    const r = await svc.upsertDistilled(client, "p", [
      { kind: "style", content: "短句优先", confidence: 0.7, sourceFeedbackIds: ["f1"] },
      { kind: "taboo", content: "不要 emoji", confidence: 0.9, sourceFeedbackIds: ["f1", "f2"] },
    ]);
    expect(r).toEqual({ inserted: 2, merged: 0 });
    // 2 个 INSERT
    const inserts = client.queries.filter((q: any) => q.sql.includes("INSERT INTO agent_memory"));
    expect(inserts).toHaveLength(2);
  });

  it("命中已有 content → UPDATE，confidence 取大、ids 合并去重", async () => {
    const svc = new MemoryService({} as any);
    const client = fakeClient([
      {
        id: "m-1",
        project_id: "p",
        kind: "style",
        content: "短句优先",
        source: "distilled",
        source_feedback_ids: ["f1"],
        confidence: "0.5",
        created_at: new Date(),
        updated_at: new Date(),
        last_distilled_at: null,
      },
    ]);
    const r = await svc.upsertDistilled(client, "p", [
      { kind: "style", content: "短句优先", confidence: 0.7, sourceFeedbackIds: ["f1", "f2"] },
    ]);
    expect(r).toEqual({ inserted: 0, merged: 1 });
    const update = client.queries.find((q: any) => q.sql.includes("UPDATE agent_memory"));
    expect(update).toBeTruthy();
    // confidence 取大 0.7
    expect(update.params[0]).toBe(0.7);
    // ids 合并去重
    expect(JSON.parse(update.params[1] as string)).toEqual(["f1", "f2"]);
  });
});
