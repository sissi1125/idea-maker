/** Agent 单测共用的最小 confirmed Grounding，避免测试绕过生产必填契约。 */
import type { AgentGroundingContext } from "../grounding/agent-grounding.types";

export function makeTestGrounding(
  overrides: Partial<AgentGroundingContext> = {},
): AgentGroundingContext {
  return {
    briefId: "brief-1",
    briefVersion: 2,
    confirmedFields: [
      {
        id: "field-name",
        group: "identity",
        key: "name",
        value: "Bloomnote",
        source: "user",
        evidenceChunkIds: [],
      },
      {
        id: "field-feature",
        group: "fact",
        key: "core_feature",
        value: "支持时间线与标签管理笔记",
        source: "document",
        evidenceChunkIds: ["chunk-a"],
      },
    ],
    approvedClaims: [],
    evidenceChunks: [
      { id: "chunk-a", text: "Bloomnote 支持时间线与标签管理笔记。" },
    ],
    platformRules: [],
    ...overrides,
  };
}
