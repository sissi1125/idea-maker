import { describe, expect, it, vi } from "vitest";
import type {
  EvaluationInput,
  EvaluationParams,
  EvaluationUpstream,
  EvidenceItem,
  LLMChatClient,
} from "@harness/shared-types";
import { runEvaluation } from "../evaluation";

const defaultParams: EvaluationParams = {
  scoreThreshold: 0.5,
  model: "",
  apiKey: undefined,
  baseUrl: undefined,
};

function makeEvidence(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidenceId: "doc1_v1_c0",
    text: "示例 evidence",
    sourceRef: "产品介绍",
    documentId: "doc1",
    version: 1,
    chunkIndex: 0,
    pageNumber: null,
    score: 0.8,
    ...over,
  };
}

function makeUpstream(over: Partial<EvaluationUpstream> = {}): EvaluationUpstream {
  return {
    evidencePack: [
      makeEvidence({ evidenceId: "a", score: 0.9 }),
      makeEvidence({ evidenceId: "b", score: 0.6 }),
      makeEvidence({ evidenceId: "c", score: 0.3 }),
    ],
    citedEvidenceIds: ["[1]", "[2]"],
    originalQuery: "产品功能",
    generatedContent: "基于 [1] 和 [2] 我们认为...",
    ...over,
  };
}

function makeInput(over: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    methodId: "rag-metrics-only",
    params: defaultParams,
    upstream: makeUpstream(),
    ...over,
  };
}

describe("runEvaluation - rag-metrics-only 算法指标", () => {
  it("hitRate = score >= threshold 的比例", async () => {
    // 3 evidence: 0.9 / 0.6 / 0.3，threshold=0.5 → hit=2/3
    const r = await runEvaluation(makeInput());
    expect(r.output.hitRate).toBeCloseTo(2 / 3, 4);
  });

  it("citationCoverage = cited / total", async () => {
    const r = await runEvaluation(makeInput());
    // citedEvidenceIds = ["[1]","[2]"] → 命中 a + b → 2/3
    expect(r.output.citationCoverage).toBeCloseTo(2 / 3, 4);
    expect(r.output.citedCount).toBe(2);
  });

  it("confidenceScore = mean(被引用 evidence 的 score)", async () => {
    const r = await runEvaluation(makeInput());
    // a=0.9, b=0.6 → mean = 0.75
    expect(r.output.confidenceScore).toBeCloseTo(0.75, 4);
  });

  it("citedEvidenceIds 用 [evidence-001] 长格式：也能匹配", async () => {
    const r = await runEvaluation(
      makeInput({
        upstream: makeUpstream({
          citedEvidenceIds: ["[evidence-001]", "[evidence-003]"],
        }),
      }),
    );
    expect(r.output.citedCount).toBe(2);
  });

  it("citedEvidenceIds 用 raw evidenceId：兜底匹配", async () => {
    const r = await runEvaluation(
      makeInput({
        upstream: makeUpstream({ citedEvidenceIds: ["a"] }),
      }),
    );
    expect(r.output.citedCount).toBe(1);
  });

  it("空 evidencePack：所有指标为 0", async () => {
    const r = await runEvaluation(
      makeInput({ upstream: makeUpstream({ evidencePack: [] }) }),
    );
    expect(r.output.hitRate).toBe(0);
    expect(r.output.citationCoverage).toBe(0);
    expect(r.output.confidenceScore).toBe(0);
    expect(r.warnings.some((w) => w.includes("totalEvidence = 0"))).toBe(true);
  });
});

describe("runEvaluation - warnings 触发", () => {
  it("hitRate < 0.3：warning", async () => {
    const r = await runEvaluation(
      makeInput({
        upstream: makeUpstream({
          evidencePack: [
            makeEvidence({ evidenceId: "a", score: 0.1 }),
            makeEvidence({ evidenceId: "b", score: 0.2 }),
            makeEvidence({ evidenceId: "c", score: 0.3 }),
            makeEvidence({ evidenceId: "d", score: 0.9 }),
          ],
        }),
      }),
    );
    expect(r.warnings.some((w) => w.includes("命中率偏低"))).toBe(true);
  });

  it("无引用任何 evidence：warning + level=poor", async () => {
    const r = await runEvaluation(
      makeInput({ upstream: makeUpstream({ citedEvidenceIds: [] }) }),
    );
    expect(r.warnings.some((w) => w.includes("evidence-first 原则"))).toBe(true);
    expect(r.output.level).toBe("poor");
  });

  it("evidencePackMissing=true：单独 warning + 早返回", async () => {
    const r = await runEvaluation(
      makeInput({
        upstream: makeUpstream({ evidencePack: undefined }),
        evidencePackMissing: true,
      }),
    );
    expect(r.warnings.some((w) => w.includes("未检测到 evidence pack"))).toBe(true);
  });
});

describe("runEvaluation - level 综合判定", () => {
  it("hitRate>=0.5 + coverage>=0.5 + 无 faithfulness：good", async () => {
    const r = await runEvaluation(makeInput());
    // hitRate=2/3≈0.67, coverage=2/3≈0.67, faithfulness null
    expect(r.output.level).toBe("good");
  });

  it("hitRate 略低于 0.5：level 降为 warning", async () => {
    // hit=2/5=0.4 < 0.5；coverage=3/5=0.6（达标） → warning
    const r = await runEvaluation(
      makeInput({
        upstream: makeUpstream({
          evidencePack: [
            makeEvidence({ evidenceId: "a", score: 0.9 }),
            makeEvidence({ evidenceId: "b", score: 0.8 }),
            makeEvidence({ evidenceId: "c", score: 0.4 }),
            makeEvidence({ evidenceId: "d", score: 0.4 }),
            makeEvidence({ evidenceId: "e", score: 0.4 }),
          ],
          citedEvidenceIds: ["[1]", "[2]", "[3]"],
        }),
      }),
    );
    expect(r.output.level).toBe("warning");
  });
});

describe("runEvaluation - rag-metrics-with-faithfulness", () => {
  it("有 llmClient：成功调用并填 faithfulness 字段", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              faithfulnessScore: 0.85,
              unsupportedClaims: ["示例无依据主张"],
              reason: "整体忠实度较高",
            }),
          },
        },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 80 },
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runEvaluation(
      makeInput({
        methodId: "rag-metrics-with-faithfulness",
        llmClient: client,
        defaultModel: "gpt-4o-mini",
      }),
    );
    expect(r.output.faithfulness).not.toBeNull();
    expect(r.output.faithfulness?.score).toBe(0.85);
    expect(r.output.faithfulness?.unsupportedClaims).toHaveLength(1);
  });

  it("缺 llmClient：降级 + warning", async () => {
    const r = await runEvaluation(
      makeInput({ methodId: "rag-metrics-with-faithfulness" }),
    );
    expect(r.output.faithfulness).toBeNull();
    expect(r.warnings.some((w) => w.includes("降级为纯算法"))).toBe(true);
  });

  it("LLM 非 JSON：warning 但不阻塞算法指标", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "not json" } }],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runEvaluation(
      makeInput({
        methodId: "rag-metrics-with-faithfulness",
        llmClient: client,
      }),
    );
    expect(r.output.faithfulness).toBeNull();
    expect(r.warnings.some((w) => w.includes("Faithfulness judge 调用失败"))).toBe(true);
    // 算法指标仍正常
    expect(r.output.hitRate).toBeGreaterThan(0);
  });

  it("LLM 评分 < 0.6：warning 提示忠实度低", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ faithfulnessScore: 0.4 }) } },
      ],
    });
    const client: LLMChatClient = { chat: { completions: { create: mockCreate } } };

    const r = await runEvaluation(
      makeInput({
        methodId: "rag-metrics-with-faithfulness",
        llmClient: client,
        defaultModel: "gpt-4o-mini",
      }),
    );
    expect(r.warnings.some((w) => w.includes("Faithfulness 评分偏低"))).toBe(true);
  });
});

describe("runEvaluation - trace", () => {
  it("trace 含全部指标 + faithfulnessScore（null/数字）", async () => {
    const r = await runEvaluation(makeInput());
    expect(r.trace.methodId).toBe("rag-metrics-only");
    expect(r.trace.totalEvidence).toBe(3);
    expect(r.trace.citedCount).toBe(2);
    expect(r.trace.faithfulnessScore).toBeNull();
  });
});
