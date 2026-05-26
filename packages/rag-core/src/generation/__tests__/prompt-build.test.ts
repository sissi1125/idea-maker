import { describe, expect, it } from "vitest";
import type {
  CitationOutput,
  EvidenceItem,
  PromptBuildInput,
  PromptBuildParams,
} from "@harness/shared-types";
import { runPromptBuild } from "../prompt-build";

const defaultParams: PromptBuildParams = {
  maxContextTokens: 2000,
  includeSourceRefs: true,
  systemPrompt: "",
  targetAudience: "",
  tone: "professional",
  query: "",
};

function makeEvidence(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidenceId: "doc1_v1_c0",
    text: "示例 evidence 内容",
    sourceRef: "产品介绍",
    documentId: "doc1",
    version: 1,
    chunkIndex: 0,
    pageNumber: null,
    score: 0.9,
    ...over,
  };
}

function makeUpstream(over: Partial<CitationOutput> = {}): CitationOutput {
  return {
    originalQuery: "产品支持哪些功能",
    evidencePack: [makeEvidence()],
    totalEvidence: 1,
    method: "chunk-citation",
    contextText: "[evidence-001] 来源：产品介绍\n产品支持 PDF/DOCX/MD 上传",
    warnings: [],
    ...over,
  };
}

function makeInput(over: Partial<PromptBuildInput> = {}): PromptBuildInput {
  return {
    methodId: "rag-template",
    params: defaultParams,
    upstream: makeUpstream(),
    ...over,
  };
}

describe("runPromptBuild - rag-template", () => {
  it("默认 system prompt 含三条核心规则", () => {
    const r = runPromptBuild(makeInput());
    expect(r.output.systemPrompt).toContain("仅基于");
    expect(r.output.systemPrompt).toContain("无法完整回答");
    expect(r.output.userPrompt).toContain("参考资料");
    expect(r.output.userPrompt).toContain("用户问题");
  });

  it("自定义 systemPrompt 覆盖默认", () => {
    const r = runPromptBuild(
      makeInput({ params: { ...defaultParams, systemPrompt: "你是测试 bot" } }),
    );
    expect(r.output.systemPrompt).toBe("你是测试 bot");
  });

  it("context 超 maxContextTokens：截断 + warning", () => {
    const longContext = "x".repeat(20000);
    const r = runPromptBuild(
      makeInput({
        params: { ...defaultParams, maxContextTokens: 100 },
        upstream: makeUpstream({ contextText: longContext }),
      }),
    );
    expect(r.warnings.some((w) => w.includes("已截断"))).toBe(true);
    expect(r.output.userPrompt).toContain("（参考资料已截断）");
  });

  it("includeSourceRefs=true：含 evidence-NNN 引用说明", () => {
    const r = runPromptBuild(makeInput());
    expect(r.output.userPrompt).toContain("evidence-NNN");
  });

  it("includeSourceRefs=false：不含引用说明", () => {
    const r = runPromptBuild(
      makeInput({ params: { ...defaultParams, includeSourceRefs: false } }),
    );
    expect(r.output.userPrompt).not.toContain("evidence-NNN");
  });

  it("fullPrompt = system + \\n\\n + user", () => {
    const r = runPromptBuild(makeInput());
    expect(r.output.fullPrompt).toBe(
      `${r.output.systemPrompt}\n\n${r.output.userPrompt}`,
    );
  });

  it("透传 evidencePack 供下游 generation/evaluation 使用", () => {
    const evidencePack = [makeEvidence({ evidenceId: "a" }), makeEvidence({ evidenceId: "b" })];
    const r = runPromptBuild(makeInput({ upstream: makeUpstream({ evidencePack }) }));
    expect(r.output.evidencePack).toEqual(evidencePack);
  });
});

describe("runPromptBuild - marketing-template", () => {
  it("含受众 + 语气 + 结构化输出要求", () => {
    const r = runPromptBuild(
      makeInput({
        methodId: "marketing-template",
        params: { ...defaultParams, targetAudience: "产品经理", tone: "活泼" },
      }),
    );
    expect(r.output.systemPrompt).toContain("产品经理");
    expect(r.output.systemPrompt).toContain("活泼");
    expect(r.output.userPrompt).toContain("结构化营销内容");
  });

  it("evidence first 原则写入 system prompt", () => {
    const r = runPromptBuild(makeInput({ methodId: "marketing-template" }));
    expect(r.output.systemPrompt).toContain("evidence first");
  });
});

describe("runPromptBuild - 错误路径 + trace", () => {
  it("空 query：抛 empty_query", () => {
    expect(() =>
      runPromptBuild(makeInput({ upstream: makeUpstream({ originalQuery: "  " }) })),
    ).toThrowError(/empty_query|为空/);
  });

  it("params.query 在 originalQuery 为空时生效", () => {
    const r = runPromptBuild(
      makeInput({
        params: { ...defaultParams, query: "手动 query" },
        upstream: makeUpstream({ originalQuery: "" }),
      }),
    );
    expect(r.output.originalQuery).toBe("手动 query");
  });

  it("trace 字段完整", () => {
    const r = runPromptBuild(makeInput());
    expect(r.trace.methodId).toBe("rag-template");
    expect(r.trace.evidenceCount).toBe(1);
    expect(r.trace.tokenEstimate).toBeGreaterThan(0);
    expect(r.trace.contextLength).toBeGreaterThan(0);
  });
});
