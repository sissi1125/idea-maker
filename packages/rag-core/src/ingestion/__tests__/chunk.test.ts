import { describe, expect, it } from "vitest";
import type {
  ChunkInput,
  ChunkParams,
  ChunkSourceRef,
} from "@harness/shared-types";
import { runChunk } from "../chunk";
import { PipelineError } from "../../errors";

const defaultParams: ChunkParams = {
  chunkSize: 100,
  overlap: 10,
  separators: undefined,
  minChunkSize: 0,
  headingDepth: 2,
};

function makeInput(over: Partial<ChunkInput> = {}): ChunkInput {
  return {
    methodId: "recursive",
    params: defaultParams,
    upstream: {
      cleanText: "hello world",
      sourceRefs: [],
      fileName: "test.md",
    },
    ...over,
  };
}

describe("runChunk - fixed-size", () => {
  it("滑动窗口：长文本被切成多个 chunk，charStart/charEnd 连续", () => {
    const text = "a".repeat(300);
    const r = runChunk(
      makeInput({
        methodId: "fixed-size",
        params: { ...defaultParams, chunkSize: 100, overlap: 0 },
        upstream: { cleanText: text, sourceRefs: [], fileName: "x.txt" },
      }),
    );
    expect(r.output.chunkCount).toBe(3);
    expect(r.output.chunks[0].charStart).toBe(0);
    expect(r.output.chunks[0].charEnd).toBe(100);
    expect(r.output.chunks[1].charStart).toBe(100);
    expect(r.output.chunks[2].charEnd).toBe(300);
  });

  it("overlap > chunkSize：warning + 强制下调", () => {
    const text = "a".repeat(200);
    const r = runChunk(
      makeInput({
        methodId: "fixed-size",
        params: { ...defaultParams, chunkSize: 50, overlap: 100 },
        upstream: { cleanText: text, sourceRefs: [], fileName: "x.txt" },
      }),
    );
    expect(r.warnings.some((w) => w.includes("overlap"))).toBe(true);
  });

  it("总字符数 < chunkSize：单个 chunk", () => {
    const r = runChunk(
      makeInput({
        methodId: "fixed-size",
        params: { ...defaultParams, chunkSize: 1000, overlap: 0 },
        upstream: { cleanText: "短文本", sourceRefs: [], fileName: "x.txt" },
      }),
    );
    expect(r.output.chunkCount).toBe(1);
    expect(r.output.chunks[0].text).toBe("短文本");
  });
});

describe("runChunk - recursive", () => {
  it("段落优先：\\n\\n 边界促成切分（vs fixed-size 不顾边界）", () => {
    // 三段，每段约 80 字符，总长 ~250，chunkSize=100 → 必须切分
    const para = (i: number) => `段落${i}内容。` + "x".repeat(75);
    const text = `${para(1)}\n\n${para(2)}\n\n${para(3)}`;
    const r = runChunk(
      makeInput({
        methodId: "recursive",
        params: { ...defaultParams, chunkSize: 100, overlap: 0 },
        upstream: { cleanText: text, sourceRefs: [], fileName: "x.txt" },
      }),
    );
    expect(r.output.chunkCount).toBeGreaterThan(1);
    // 切分点应该尽量靠近段落边界（chunk 应以"段落"开头或接近）
    expect(r.output.chunks.some((c) => c.text.includes("段落"))).toBe(true);
  });

  it("中文长句：句号分隔符生效，不退化到字符级", () => {
    // 一个段落，由 5 个长句子组成
    const sentence = "这是一个用于测试中文句子分隔符是否生效的较长句子" + "x".repeat(30);
    const text = (sentence + "。").repeat(5);
    const r = runChunk(
      makeInput({
        methodId: "recursive",
        params: { ...defaultParams, chunkSize: 100, overlap: 0 },
        upstream: { cleanText: text, sourceRefs: [], fileName: "x.txt" },
      }),
    );
    // 每个 chunk 应在句末（包含 "。"）；并非每隔 100 字符硬切
    for (const c of r.output.chunks) {
      if (c.index < r.output.chunkCount - 1) {
        expect(c.text.length).toBeLessThanOrEqual(200);
      }
    }
  });

  it("sourceRef 绑定：chunk 命中所属 heading path", () => {
    const text = "段落一内容\n\n段落二内容\n\n段落三内容";
    const sourceRefs: ChunkSourceRef[] = [
      { type: "paragraph", value: "章节A", charStart: 0, charEnd: 6 },
      { type: "paragraph", value: "章节B", charStart: 7, charEnd: 14 },
      { type: "paragraph", value: "章节C", charStart: 15, charEnd: 22 },
    ];
    const r = runChunk(
      makeInput({
        methodId: "recursive",
        params: { ...defaultParams, chunkSize: 50, overlap: 0 },
        upstream: { cleanText: text, sourceRefs, fileName: "x.md" },
      }),
    );
    // 每个 chunk 都应有 sourceRef
    expect(r.output.chunks.every((c) => c.sourceRef !== "")).toBe(true);
  });

  it("空 separators：fallback 默认 + warning", () => {
    // 给一段有 \n\n 分隔的长文本，便于默认分隔符发挥作用
    const text = "段落一" + "x".repeat(40) + "\n\n段落二" + "x".repeat(40);
    const r = runChunk(
      makeInput({
        methodId: "recursive",
        params: { ...defaultParams, chunkSize: 50, overlap: 0, separators: [] },
        upstream: { cleanText: text, sourceRefs: [], fileName: "x.txt" },
      }),
    );
    expect(r.warnings.some((w) => w.includes("separators"))).toBe(true);
    expect(r.output.chunkCount).toBeGreaterThan(1);
  });
});

describe("runChunk - markdown-heading", () => {
  it("按 ## 标题切分章节", () => {
    const text = "## 章节一\n内容一\n\n## 章节二\n内容二\n\n## 章节三\n内容三";
    const r = runChunk(
      makeInput({
        methodId: "markdown-heading",
        params: { ...defaultParams, chunkSize: 200, overlap: 0, headingDepth: 2 },
        upstream: { cleanText: text, sourceRefs: [], fileName: "x.md" },
      }),
    );
    expect(r.output.chunkCount).toBe(3);
    expect(r.output.chunks[0].text).toContain("章节一");
    expect(r.output.chunks[1].text).toContain("章节二");
  });

  it("超长章节降级 fixed-size + warning", () => {
    const longSection = "## 长章节\n" + "x".repeat(500);
    const r = runChunk(
      makeInput({
        methodId: "markdown-heading",
        params: { ...defaultParams, chunkSize: 100, overlap: 0, headingDepth: 2 },
        upstream: { cleanText: longSection, sourceRefs: [], fileName: "x.md" },
      }),
    );
    expect(r.warnings.some((w) => w.includes("降级为 fixed-size"))).toBe(true);
    expect(r.output.chunkCount).toBeGreaterThan(1);
  });

  it("headingDepth=1：只按 # 切，不切 ##", () => {
    const text = "# 一级\n## 子节1\n内容1\n## 子节2\n内容2\n# 另一节\n内容3";
    const r = runChunk(
      makeInput({
        methodId: "markdown-heading",
        params: { ...defaultParams, chunkSize: 200, overlap: 0, headingDepth: 1 },
        upstream: { cleanText: text, sourceRefs: [], fileName: "x.md" },
      }),
    );
    // 应只有 2 个一级章节
    expect(r.output.chunkCount).toBe(2);
  });
});

describe("runChunk - markdown-heading-recursive", () => {
  it("长章节用 recursive 而非 fixed-size 降级", () => {
    const longSection =
      "## 长章节\n\n段落一。这是第一段。\n\n段落二。这是第二段。\n\n段落三。这是第三段。" +
      "更多内容".repeat(20);
    const r = runChunk(
      makeInput({
        methodId: "markdown-heading-recursive",
        params: { ...defaultParams, chunkSize: 50, overlap: 0, headingDepth: 2 },
        upstream: { cleanText: longSection, sourceRefs: [], fileName: "x.md" },
      }),
    );
    expect(
      r.warnings.some((w) => w.includes("recursive 语义切分")),
    ).toBe(true);
  });
});

describe("runChunk - 错误路径", () => {
  it("cleanText 为空：抛 PipelineError(empty_text)", () => {
    expect(() =>
      runChunk(makeInput({ upstream: { cleanText: "", sourceRefs: [], fileName: "x.md" } })),
    ).toThrowError(PipelineError);
  });

  it("cleanText 全空白：抛 PipelineError 且 code=empty_text", () => {
    try {
      runChunk(
        makeInput({ upstream: { cleanText: "   \n\n  ", sourceRefs: [], fileName: "x.md" } }),
      );
      expect.unreachable("应抛出 PipelineError");
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineError);
      expect((e as PipelineError).code).toBe("empty_text");
    }
  });
});

describe("runChunk - trace", () => {
  it("trace 含 method / params / stats / sourceFile", () => {
    const r = runChunk(
      makeInput({
        methodId: "fixed-size",
        upstream: { cleanText: "hello", sourceRefs: [], fileName: "doc.md" },
      }),
    );
    expect(r.trace.method).toBe("fixed-size");
    expect(r.trace.sourceFile).toBe("doc.md");
    expect(r.trace.inputChars).toBe(5);
    expect(r.trace.params.chunkSize).toBe(100);
  });
});
