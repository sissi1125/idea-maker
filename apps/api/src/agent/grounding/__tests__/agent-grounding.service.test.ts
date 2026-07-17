import { describe, expect, it, vi } from "vitest";
import { AgentGroundingService } from "../agent-grounding.service";

describe("AgentGroundingService", () => {
  it("Brief 未整体 confirmed 时返回空事实且不读取 Claims/evidence", async () => {
    const briefs = { getConfirmedBriefContext: vi.fn().mockResolvedValue(null) };
    const claims = { listApprovedWithClient: vi.fn() };
    const client = { query: vi.fn() };
    const service = new AgentGroundingService(briefs as never, claims as never);

    const result = await service.load(client as never, "p", []);

    expect(result.briefId).toBeNull();
    expect(result.confirmedFields).toEqual([]);
    expect(claims.listApprovedWithClient).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("合并 confirmed fields、approved Claims 与两类 evidence chunk", async () => {
    const briefs = {
      getConfirmedBriefContext: vi.fn().mockResolvedValue({
        brief: { id: "b1", version: 3 },
        fields: [{
          id: "f1",
          field_group: "fact",
          field_key: "feature",
          value: "时间线",
          source: "document",
          evidence_chunk_ids: ["rag-1"],
        }],
      }),
    };
    const claims = {
      listApprovedWithClient: vi.fn().mockResolvedValue([{
        id: "c1",
        text: "支持标签管理",
        claim_type: "functional",
        source_field_id: "f1",
        evidence_chunk_ids: ["web-1"],
      }]),
    };
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: "rag-1", text: "上传文档证据" },
          { id: "web-1", text: "官网证据" },
        ],
      }),
    };
    const service = new AgentGroundingService(briefs as never, claims as never);

    const result = await service.load(client as never, "p", []);

    expect(result.briefId).toBe("b1");
    expect(result.briefVersion).toBe(3);
    expect(result.confirmedFields.map((field) => field.id)).toEqual(["f1"]);
    expect(result.approvedClaims.map((claim) => claim.id)).toEqual(["c1"]);
    expect(result.evidenceChunks.map((chunk) => chunk.id)).toEqual(["rag-1", "web-1"]);
    expect(client.query.mock.calls[0][0]).toContain("source_content_chunks");
  });
});
