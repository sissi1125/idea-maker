import { describe, expect, it } from "vitest";
import type { PreprocessInput, PreprocessParams } from "@harness/shared-types";
import { runPreprocess } from "../preprocess";

const defaultParams: PreprocessParams = {
  preserveHeadings: true,
  preserveTables: true,
  removeBoilerplate: false,
  maxChars: 0,
  pdfPageRange: "",
  preserveLayout: true,
  extractImages: false,
  // feat-experiment-4.1：sourceRefDepth=0 表示保留全部 heading 层级（默认行为）
  sourceRefDepth: 0,
};

function makeInput(over: Partial<PreprocessInput> = {}): PreprocessInput {
  return {
    methodId: "markdown-structure",
    params: defaultParams,
    doc: {
      rawContent: "# Hello\n\nworld",
      buffer: Buffer.from(""),
      mimeType: "text/markdown",
      isBinary: false,
      fileName: "test.md",
    },
    ...over,
  };
}

describe("runPreprocess - markdown-structure", () => {
  it("一级标题 + 段落：headings 收集 + sourceRef heading path", async () => {
    const result = await runPreprocess(
      makeInput({
        methodId: "markdown-structure",
        doc: {
          rawContent: "# 产品介绍\n\n这是介绍\n\n## 核心功能\n\n关键能力",
          buffer: Buffer.from(""),
          mimeType: "text/markdown",
          isBinary: false,
          fileName: "intro.md",
        },
      }),
    );
    expect(result.output.metadata.headings).toEqual(["产品介绍", "核心功能"]);
    expect(result.output.metadata.fileName).toBe("intro.md");
    // sourceRef 含 heading path
    const paragraphRefs = result.output.sourceRefs.filter((r) => r.type === "paragraph");
    expect(paragraphRefs.some((r) => r.value.includes("产品介绍"))).toBe(true);
    expect(paragraphRefs.some((r) => r.value.includes("产品介绍 > 核心功能"))).toBe(true);
  });

  it("preserveHeadings=false：cleanText 不含标题文本", async () => {
    const result = await runPreprocess(
      makeInput({
        params: { ...defaultParams, preserveHeadings: false },
        doc: {
          rawContent: "# 标题\n\n正文",
          buffer: Buffer.from(""),
          mimeType: "text/markdown",
          isBinary: false,
          fileName: "x.md",
        },
      }),
    );
    expect(result.output.cleanText).toBe("正文");
    expect(result.output.metadata.headings).toEqual(["标题"]);
  });

  it("MD 语法清洗：图片 / 链接 / 加粗 / 列表标记被剥离", async () => {
    const result = await runPreprocess(
      makeInput({
        doc: {
          rawContent: "# H\n\n- **bold** [link](https://a) ![img](x.png) `code` ~~del~~",
          buffer: Buffer.from(""),
          mimeType: "text/markdown",
          isBinary: false,
          fileName: "x.md",
        },
      }),
    );
    expect(result.output.cleanText).not.toContain("**");
    expect(result.output.cleanText).not.toContain("![");
    expect(result.output.cleanText).not.toContain("](");
    expect(result.output.cleanText).toContain("bold");
    expect(result.output.cleanText).toContain("link");
  });

  it("maxChars 截断 + warning", async () => {
    const long = "x".repeat(100);
    const result = await runPreprocess(
      makeInput({
        params: { ...defaultParams, maxChars: 20 },
        doc: {
          rawContent: long,
          buffer: Buffer.from(""),
          mimeType: "text/markdown",
          isBinary: false,
          fileName: "x.md",
        },
      }),
    );
    expect(result.output.cleanText.length).toBe(20);
    expect(result.warnings.some((w) => w.includes("截断"))).toBe(true);
  });

  it("trace 字段完整：method / compressionRatio / headingCount / sourceRefCount", async () => {
    const result = await runPreprocess(
      makeInput({
        doc: {
          rawContent: "# A\n\ntext",
          buffer: Buffer.from(""),
          mimeType: "text/markdown",
          isBinary: false,
          fileName: "x.md",
        },
      }),
    );
    expect(result.trace.method).toBe("markdown-structure");
    expect(result.trace.headingCount).toBe(1);
    expect(result.trace.sourceRefCount).toBeGreaterThan(0);
    expect(parseFloat(result.trace.compressionRatio)).toBeGreaterThan(0);
  });
});

describe("runPreprocess - plain-text", () => {
  it("空行被过滤", async () => {
    const result = await runPreprocess(
      makeInput({
        methodId: "plain-text",
        doc: {
          rawContent: "line1\n\n\nline2\n   \nline3",
          buffer: Buffer.from(""),
          mimeType: "text/plain",
          isBinary: false,
          fileName: "x.txt",
        },
      }),
    );
    expect(result.output.cleanText).toBe("line1\nline2\nline3");
    expect(result.output.sourceRefs).toEqual([]);
  });

  it("removeBoilerplate=true：短的纯符号行被过滤 + warning", async () => {
    const result = await runPreprocess(
      makeInput({
        methodId: "plain-text",
        params: { ...defaultParams, removeBoilerplate: true },
        doc: {
          rawContent: "正常内容\n123\n=======\n另一段正常内容",
          buffer: Buffer.from(""),
          mimeType: "text/plain",
          isBinary: false,
          fileName: "x.txt",
        },
      }),
    );
    expect(result.output.cleanText).not.toContain("123");
    expect(result.output.cleanText).not.toContain("=======");
    expect(result.warnings.some((w) => w.includes("样板"))).toBe(true);
  });
});

describe("runPreprocess - pdf-pages / pymupdf 错误降级", () => {
  it("pdf-pages 收到非 PDF mimeType：降级 plain-text + warning", async () => {
    const result = await runPreprocess(
      makeInput({
        methodId: "pdf-pages",
        doc: {
          rawContent: "not a pdf",
          buffer: Buffer.from("not a pdf"),
          mimeType: "text/plain",
          isBinary: false,
          fileName: "x.txt",
        },
      }),
    );
    expect(result.warnings.some((w) => w.includes("不是 PDF"))).toBe(true);
    expect(result.output.cleanText).toContain("not a pdf");
  });

  it("pymupdf 服务未启动：返回 ECONNREFUSED warning，不抛", async () => {
    const result = await runPreprocess(
      makeInput({
        methodId: "pymupdf",
        doc: {
          rawContent: "pdf-binary-base64",
          buffer: Buffer.from(""),
          mimeType: "application/pdf",
          isBinary: true,
          fileName: "x.pdf",
        },
        // 故意指向不存在的端口
        pymupdfServiceUrl: "http://localhost:1",
      }),
    );
    expect(result.output.cleanText).toBe("");
    expect(result.warnings.some((w) => w.includes("pymupdf"))).toBe(true);
  });
});

describe("runPreprocess - metadata 注入", () => {
  it("fileName 总被注入（即便算法内部没设置）", async () => {
    const result = await runPreprocess(
      makeInput({
        methodId: "plain-text",
        doc: {
          rawContent: "hello",
          buffer: Buffer.from(""),
          mimeType: "text/plain",
          isBinary: false,
          fileName: "custom-name.txt",
        },
      }),
    );
    expect(result.output.metadata.fileName).toBe("custom-name.txt");
    expect(result.output.metadata.mimeType).toBe("text/plain");
  });
});
