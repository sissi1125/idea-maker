/**
 * ProductBriefService 单测 — feat-400.1
 *
 * 覆盖核心事实门禁逻辑（用 fake client 做纯逻辑验证，不连真库）：
 *   - detectIssues：缺关键字段 / 未核实事实
 *   - upsertCandidateField：命中 confirmed → 只标 stale 不覆盖
 *   - editField：事实型字段缺 reason 抛错
 *   - confirmBrief：有问题时拒绝确认
 */

import { describe, expect, it, vi } from "vitest";
import { ProductBriefService } from "../product-brief.service";
import type { BriefFieldRow } from "../product-brief.types";

function field(partial: Partial<BriefFieldRow>): BriefFieldRow {
  return {
    id: partial.id ?? "f-1",
    brief_id: "b-1",
    field_group: partial.field_group ?? "fact",
    field_key: partial.field_key ?? "pricing",
    value: partial.value ?? "免费",
    source: partial.source ?? "user",
    evidence_chunk_ids: partial.evidence_chunk_ids ?? [],
    confidence: partial.confidence ?? 0.5,
    status: partial.status ?? "candidate",
    version: partial.version ?? 1,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

/** fake client：可预置某个 SELECT 的返回行 */
function fakeClient(rowsFor: (sql: string, params: unknown[]) => any[] = () => []): any {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const rows = rowsFor(sql, params);
      return { rows, rowCount: rows.length };
    }),
  };
}

const svc = () => new ProductBriefService({} as any);

describe("ProductBriefService.detectIssues", () => {
  it("缺全部关键字段 → missingRequired 报 3 条", () => {
    const issues = svc().detectIssues([]);
    expect(issues.missingRequired).toHaveLength(3);
    expect(issues.unverifiedFacts).toHaveLength(0);
  });

  it("关键字段已 confirmed → 不再算缺失", () => {
    const fields = [
      field({ field_group: "identity", field_key: "name", status: "confirmed" }),
      field({ field_group: "identity", field_key: "one_liner", status: "confirmed" }),
      field({ field_group: "positioning", field_key: "core_value", status: "confirmed" }),
    ];
    const issues = svc().detectIssues(fields);
    expect(issues.missingRequired).toHaveLength(0);
  });

  it("事实型 + 模型推断 + 无 evidence + candidate → 计入 unverifiedFacts", () => {
    const fields = [
      field({ id: "x", field_group: "fact", field_key: "limit", source: "inferred", status: "candidate", evidence_chunk_ids: [] }),
    ];
    const issues = svc().detectIssues(fields);
    expect(issues.unverifiedFacts).toEqual([
      { id: "x", group: "fact", key: "limit", source: "inferred" },
    ]);
  });

  it("有 evidence 的推断事实 → 不算未核实", () => {
    const fields = [
      field({ field_group: "fact", source: "inferred", status: "candidate", evidence_chunk_ids: ["c1"] }),
    ];
    expect(svc().detectIssues(fields).unverifiedFacts).toHaveLength(0);
  });
});

describe("ProductBriefService.getConfirmedBriefContext", () => {
  it("整体 draft Brief 不进入 Agent Grounding", async () => {
    const client = fakeClient(() => []);
    await expect(svc().getConfirmedBriefContext(client, "p")).resolves.toBeNull();
    expect(client.queries[0].sql).toContain("status = 'confirmed'");
  });

  it("只保留字段级 confirmed，排除 candidate/stale/rejected", async () => {
    const client = fakeClient((sql) => {
      if (sql.includes("FROM product_briefs")) {
        return [{ id: "b-1", project_id: "p", version: 2, status: "confirmed" }];
      }
      if (sql.includes("FROM product_brief_fields")) {
        return [
          field({ id: "confirmed", status: "confirmed" }),
          field({ id: "candidate", status: "candidate" }),
          field({ id: "stale", status: "stale" }),
          field({ id: "rejected", status: "rejected" }),
        ];
      }
      return [];
    });
    const result = await svc().getConfirmedBriefContext(client, "p");
    expect(result?.fields.map((item) => item.id)).toEqual(["confirmed"]);
  });
});

describe("ProductBriefService.upsertCandidateField", () => {
  it("命中已 confirmed 字段 → 只标 stale，不覆盖值", async () => {
    const existing = field({ id: "f-old", status: "confirmed", value: "旧值" });
    const client = fakeClient((sql) =>
      sql.includes("SELECT") && sql.includes("field_group = $2") ? [existing] : [],
    );
    const r = await svc().upsertCandidateField(client, "b-1", {
      group: "fact",
      key: "pricing",
      value: "新值",
      source: "website",
    });
    expect(r.status).toBe("stale");
    const update = client.queries.find((q: any) => q.sql.includes("SET status = 'stale'"));
    expect(update).toBeTruthy();
    // 不应有覆盖 value 的 UPDATE
    const overwrite = client.queries.find((q: any) => q.sql.includes("SET value = $2::jsonb"));
    expect(overwrite).toBeUndefined();
  });

  it("全新字段 → INSERT 一条 candidate", async () => {
    const client = fakeClient((sql) =>
      sql.includes("INSERT INTO product_brief_fields")
        ? [field({ id: "new", status: "candidate" })]
        : [],
    );
    const r = await svc().upsertCandidateField(client, "b-1", {
      group: "identity",
      key: "name",
      value: "Idea-Maker",
      source: "document",
    });
    expect(r.status).toBe("candidate");
    expect(client.queries.some((q: any) => q.sql.includes("INSERT INTO product_brief_fields"))).toBe(true);
  });
});

describe("ProductBriefService.editField", () => {
  it("编辑事实型字段但缺 reason → 抛错", async () => {
    const client = fakeClient((sql) =>
      sql.includes("WHERE id = $1") ? [field({ field_group: "fact" })] : [],
    );
    await expect(
      svc().editField(client, "f-1", "u-1", { value: "改后" }),
    ).rejects.toThrow(/修改原因/);
  });

  it("编辑非事实型字段（style）无需 reason", async () => {
    const client = fakeClient((sql) => {
      if (sql.includes("WHERE id = $1") && sql.includes("SELECT")) return [field({ field_group: "style", field_key: "tone" })];
      if (sql.includes("RETURNING")) return [field({ field_group: "style", field_key: "tone", status: "confirmed", version: 2 })];
      return [];
    });
    const r = await svc().editField(client, "f-1", "u-1", { value: "活泼" });
    expect(r.status).toBe("confirmed");
    // 写了 revision
    expect(client.queries.some((q: any) => q.sql.includes("INSERT INTO product_brief_field_revisions"))).toBe(true);
  });
});

describe("ProductBriefService.confirmBrief", () => {
  it("有缺失关键字段 → 拒绝确认整份 Brief", async () => {
    // listFields 返回空 → detectIssues 报缺失
    const client = fakeClient(() => []);
    await expect(svc().confirmBrief(client, "b-1")).rejects.toThrow(/尚不完备/);
  });
});

describe("ProductBriefService.confirmAllFields", () => {
  it("批量确认 candidate/stale，并为每个字段写 revision", async () => {
    const pending = [
      field({ id: "f-candidate", status: "candidate" }),
      field({ id: "f-stale", status: "stale" }),
      field({ id: "f-confirmed", status: "confirmed" }),
    ];
    const client = fakeClient((sql, params) => {
      if (sql.includes("WHERE brief_id = $1") && sql.includes("ORDER BY")) return pending;
      if (sql.includes("FROM product_brief_fields WHERE id = $1")) {
        return [pending.find((item) => item.id === params[0])!];
      }
      if (sql.includes("UPDATE product_brief_fields") && sql.includes("RETURNING")) {
        const source = pending.find((item) => item.id === params[0])!;
        return [{ ...source, status: "confirmed", version: source.version + 1 }];
      }
      return [];
    });

    const count = await svc().confirmAllFields(client, "b-1", "u-1");

    expect(count).toBe(2);
    const revisions = client.queries.filter((query: any) =>
      query.sql.includes("INSERT INTO product_brief_field_revisions"),
    );
    expect(revisions).toHaveLength(2);
  });
});
