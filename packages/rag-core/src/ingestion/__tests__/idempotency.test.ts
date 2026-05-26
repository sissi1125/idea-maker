import { describe, expect, it } from "vitest";
import type {
  IdempotencyInput,
  IdempotencyParams,
} from "@harness/shared-types";
import { checkIdempotency } from "../idempotency";
import { PipelineError } from "../../errors";

const defaultParams: IdempotencyParams = {
  normalizeWhitespace: false,
  includeFileName: false,
  versionPolicy: "new-version",
};

function makeDoc(over: Partial<IdempotencyInput["targetDoc"]> = {}): IdempotencyInput["targetDoc"] {
  return {
    id: "doc-1",
    fileName: "a.md",
    fileSize: 100,
    mimeType: "text/markdown",
    rawContent: "hello world",
    version: 1,
    ...over,
  };
}

describe("checkIdempotency", () => {
  describe("sha256-content", () => {
    it("新文档：exists=false，recommendedAction=proceed", () => {
      const result = checkIdempotency({
        methodId: "sha256-content",
        params: defaultParams,
        targetDoc: makeDoc(),
        otherDocs: [],
      });
      expect(result.output.exists).toBe(false);
      expect(result.output.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.output.recommendedAction).toMatch(/^proceed/);
      expect(result.output.duplicateOf).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(result.trace.checkedAgainst).toBe(0);
    });

    it("内容相同的文档：exists=true，duplicateOf 指向对方", () => {
      const target = makeDoc({ id: "new", rawContent: "same body" });
      const existing = makeDoc({ id: "old", fileName: "b.md", rawContent: "same body", version: 3 });
      const result = checkIdempotency({
        methodId: "sha256-content",
        params: defaultParams,
        targetDoc: target,
        otherDocs: [existing],
      });
      expect(result.output.exists).toBe(true);
      expect(result.output.duplicateOf).toEqual({ id: "old", fileName: "b.md", version: 3 });
      // 命中时 documentId/version 指向已有文档
      expect(result.output.documentId).toBe("old");
      expect(result.output.version).toBe(3);
      expect(result.warnings).toHaveLength(1);
    });

    it("normalizeWhitespace=true：换行/缩进差异视为相同", () => {
      const a = makeDoc({ id: "a", rawContent: "hello world" });
      const b = makeDoc({ id: "b", rawContent: "hello    world\n\n" });
      const params: IdempotencyParams = { ...defaultParams, normalizeWhitespace: true };
      const result = checkIdempotency({
        methodId: "sha256-content",
        params,
        targetDoc: a,
        otherDocs: [b],
      });
      expect(result.output.exists).toBe(true);
      expect(result.trace.normalizeWhitespace).toBe(true);
    });

    it("normalizeWhitespace=false：空白差异 hash 不同", () => {
      const a = makeDoc({ id: "a", rawContent: "hello world" });
      const b = makeDoc({ id: "b", rawContent: "hello    world" });
      const result = checkIdempotency({
        methodId: "sha256-content",
        params: defaultParams,
        targetDoc: a,
        otherDocs: [b],
      });
      expect(result.output.exists).toBe(false);
    });
  });

  describe("normalized-sha256", () => {
    it("始终归一化空白，不受 normalizeWhitespace 参数影响", () => {
      const a = makeDoc({ id: "a", rawContent: "hello\n\nworld" });
      const b = makeDoc({ id: "b", rawContent: "hello world" });
      const result = checkIdempotency({
        methodId: "normalized-sha256",
        params: defaultParams, // normalizeWhitespace=false 但 method 自带归一化
        targetDoc: a,
        otherDocs: [b],
      });
      expect(result.output.exists).toBe(true);
    });
  });

  describe("file-signature", () => {
    it("内容相同但 fileName 不同：不算重复（签名含 fileName）", () => {
      const a = makeDoc({ id: "a", fileName: "intro.md", rawContent: "hi" });
      const b = makeDoc({ id: "b", fileName: "guide.md", rawContent: "hi" });
      const result = checkIdempotency({
        methodId: "file-signature",
        params: defaultParams,
        targetDoc: a,
        otherDocs: [b],
      });
      expect(result.output.exists).toBe(false);
    });

    it("fileName + size + content 完全相同：算重复", () => {
      const a = makeDoc({ id: "a", fileName: "intro.md", fileSize: 2, rawContent: "hi" });
      const b = makeDoc({ id: "b", fileName: "intro.md", fileSize: 2, rawContent: "hi" });
      const result = checkIdempotency({
        methodId: "file-signature",
        params: defaultParams,
        targetDoc: a,
        otherDocs: [b],
      });
      expect(result.output.exists).toBe(true);
    });
  });

  describe("versionPolicy 影响 recommendedAction", () => {
    const target = makeDoc({ id: "new", rawContent: "dup" });
    const existing = makeDoc({ id: "old", rawContent: "dup", version: 5 });

    it("skip-existing", () => {
      const result = checkIdempotency({
        methodId: "sha256-content",
        params: { ...defaultParams, versionPolicy: "skip-existing" },
        targetDoc: target,
        otherDocs: [existing],
      });
      expect(result.output.recommendedAction).toMatch(/^skip/);
    });

    it("replace-existing", () => {
      const result = checkIdempotency({
        methodId: "sha256-content",
        params: { ...defaultParams, versionPolicy: "replace-existing" },
        targetDoc: target,
        otherDocs: [existing],
      });
      expect(result.output.recommendedAction).toMatch(/^replace/);
    });

    it("new-version（默认）", () => {
      const result = checkIdempotency({
        methodId: "sha256-content",
        params: defaultParams,
        targetDoc: target,
        otherDocs: [existing],
      });
      expect(result.output.recommendedAction).toMatch(/^new-version/);
    });
  });

  describe("includeFileName", () => {
    it("true：内容同但 fileName 不同时不算重复", () => {
      const a = makeDoc({ id: "a", fileName: "x.md", rawContent: "body" });
      const b = makeDoc({ id: "b", fileName: "y.md", rawContent: "body" });
      const result = checkIdempotency({
        methodId: "sha256-content",
        params: { ...defaultParams, includeFileName: true },
        targetDoc: a,
        otherDocs: [b],
      });
      expect(result.output.exists).toBe(false);
    });
  });

  describe("错误路径", () => {
    it("targetDoc 缺失：抛 PipelineError(missing_document)", () => {
      expect(() =>
        checkIdempotency({
          methodId: "sha256-content",
          params: defaultParams,
          targetDoc: undefined as unknown as IdempotencyInput["targetDoc"],
          otherDocs: [],
        }),
      ).toThrowError(PipelineError);
    });
  });
});
