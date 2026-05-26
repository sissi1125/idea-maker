import { describe, expect, it } from "vitest";
import type {
  TransformInput,
  TransformInputChunk,
  TransformParams,
} from "@harness/shared-types";
import { runTransform } from "../transform";

const defaultParams: TransformParams = {
  includeTitle: true,
  includeHeadingPath: true,
  documentTitle: "",
  keywordCount: 5,
  summaryMaxTokens: 100,
  appendToChunk: true,
};

function makeChunk(over: Partial<TransformInputChunk> = {}): TransformInputChunk {
  return {
    index: 0,
    text: "支持多格式上传",
    charStart: 0,
    charEnd: 7,
    charCount: 7,
    tokenEstimate: 2,
    sourceRef: "产品介绍 > 核心功能",
    ...over,
  };
}

function makeInput(over: Partial<TransformInput> = {}): TransformInput {
  return {
    methodId: "none",
    params: defaultParams,
    upstreamChunks: [makeChunk()],
    ...over,
  };
}

describe("runTransform - none", () => {
  it("透传：enhancedText === text，injectedPrefix 为空", () => {
    const r = runTransform(makeInput());
    expect(r.output.chunks[0].enhancedText).toBe("支持多格式上传");
    expect(r.output.chunks[0].injectedPrefix).toBe("");
    expect(r.output.transformedCount).toBe(0);
    expect(r.output.method).toBe("none");
  });

  it("保留原 chunk metadata（index / charStart / sourceRef）", () => {
    const c = makeChunk({ index: 3, charStart: 100, sourceRef: "X > Y" });
    const r = runTransform(makeInput({ upstreamChunks: [c] }));
    expect(r.output.chunks[0].index).toBe(3);
    expect(r.output.chunks[0].charStart).toBe(100);
    expect(r.output.chunks[0].sourceRef).toBe("X > Y");
  });
});

describe("runTransform - heading-context", () => {
  it("注入 documentTitle + sourceRef：enhancedText = title\\nsourceRef\\n\\ntext", () => {
    const r = runTransform(
      makeInput({
        methodId: "heading-context",
        params: { ...defaultParams, documentTitle: "产品白皮书" },
      }),
    );
    expect(r.output.chunks[0].enhancedText).toBe("产品白皮书\n产品介绍 > 核心功能\n\n支持多格式上传");
    expect(r.output.chunks[0].injectedPrefix).toBe("产品白皮书\n产品介绍 > 核心功能");
    expect(r.output.transformedCount).toBe(1);
  });

  it("includeTitle=false：只注入 sourceRef，不带 documentTitle", () => {
    const r = runTransform(
      makeInput({
        methodId: "heading-context",
        params: { ...defaultParams, documentTitle: "X", includeTitle: false },
      }),
    );
    expect(r.output.chunks[0].injectedPrefix).toBe("产品介绍 > 核心功能");
    expect(r.output.chunks[0].enhancedText).toMatch(/^产品介绍 > 核心功能\n\n/);
  });

  it("includeHeadingPath=false：只注入 documentTitle", () => {
    const r = runTransform(
      makeInput({
        methodId: "heading-context",
        params: { ...defaultParams, documentTitle: "标题", includeHeadingPath: false },
      }),
    );
    expect(r.output.chunks[0].injectedPrefix).toBe("标题");
  });

  it("sourceRef === documentTitle：去重，不重复注入", () => {
    const c = makeChunk({ sourceRef: "重复" });
    const r = runTransform(
      makeInput({
        methodId: "heading-context",
        params: { ...defaultParams, documentTitle: "重复" },
        upstreamChunks: [c],
      }),
    );
    expect(r.output.chunks[0].injectedPrefix).toBe("重复");
    // 不是 "重复\n重复"
  });

  it("所有 chunk sourceRef 为空 + documentTitle 为空：warning 提示", () => {
    const empty = makeChunk({ sourceRef: "" });
    const r = runTransform(
      makeInput({ methodId: "heading-context", upstreamChunks: [empty, empty] }),
    );
    expect(r.output.transformedCount).toBe(0);
    expect(r.warnings.some((w) => w.includes("sourceRef 均为空"))).toBe(true);
  });

  it("enhancedTokenEstimate 反映注入后的文本长度", () => {
    const r = runTransform(
      makeInput({
        methodId: "heading-context",
        params: { ...defaultParams, documentTitle: "T" },
      }),
    );
    expect(r.output.chunks[0].enhancedTokenEstimate).toBeGreaterThan(
      r.output.chunks[0].tokenEstimate,
    );
  });
});

describe("runTransform - summary-keywords", () => {
  it("提取关键词 + 拼接到 chunk 末尾", () => {
    const c = makeChunk({
      text: "产品支持多种文档格式的上传。用户可以上传 PDF、Markdown、TXT 等。文档会自动解析。",
    });
    const r = runTransform(
      makeInput({ methodId: "summary-keywords", upstreamChunks: [c] }),
    );
    expect(r.output.chunks[0].keywords.length).toBeGreaterThan(0);
    expect(r.output.chunks[0].summary.length).toBeGreaterThan(0);
    expect(r.output.chunks[0].enhancedText).toContain("关键词:");
    expect(r.output.chunks[0].enhancedText).toContain("摘要:");
  });

  it("appendToChunk=false：enhancedText === text，但 keywords/summary 仍在 chunk 字段", () => {
    const c = makeChunk({ text: "产品提供完整的文档管理能力，包含上传、版本、删除等功能。" });
    const r = runTransform(
      makeInput({
        methodId: "summary-keywords",
        params: { ...defaultParams, appendToChunk: false },
        upstreamChunks: [c],
      }),
    );
    expect(r.output.chunks[0].enhancedText).toBe(c.text);
    expect(r.output.chunks[0].keywords.length).toBeGreaterThan(0);
  });
});

describe("runTransform - trace", () => {
  it("trace 字段：method / inputChunkCount / transformedCount / avgEnhancedTokens", () => {
    const r = runTransform(
      makeInput({
        methodId: "heading-context",
        params: { ...defaultParams, documentTitle: "X" },
        upstreamChunks: [makeChunk(), makeChunk({ index: 1 })],
      }),
    );
    expect(r.trace.method).toBe("heading-context");
    expect(r.trace.inputChunkCount).toBe(2);
    expect(r.trace.transformedCount).toBe(2);
    expect(r.trace.avgEnhancedTokens).toBeGreaterThan(0);
  });
});
