/**
 * 文档幂等性检查 - 纯算法
 *
 * 三种 hash 方案：
 *   - sha256-content:    对原始内容计算 SHA-256（normalizeWhitespace=true 时归一化空白）
 *   - normalized-sha256: 始终归一化空白再 SHA-256，适合用户编辑后重传
 *   - file-signature:    sha256(fileName + fileSize + contentHash)，同内容不同文件场景
 *
 * 设计：纯函数，文档加载 / 持久化由路由层做。
 * 这里只接收已加载的 targetDoc + otherDocs，做哈希比对，返回 result。
 */

import crypto from "crypto";
import type {
  IdempotencyInput,
  IdempotencyMethodId,
  IdempotencyResult,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizedSha256(content: string): string {
  return sha256(content.replace(/\s+/g, " ").trim());
}

function fileSignature(
  doc: { fileName: string; fileSize: number },
  content: string,
): string {
  return sha256(`${doc.fileName}:${doc.fileSize}:${sha256(content)}`);
}

/** 根据 method + normalizeWhitespace 决定算哪个 hash。供主流程和重复扫描共用，避免重复 switch。 */
function computeHash(
  method: IdempotencyMethodId,
  doc: { fileName: string; fileSize: number; rawContent: string },
  normalizeWhitespace: boolean,
): string {
  switch (method) {
    case "normalized-sha256":
      return normalizedSha256(doc.rawContent);
    case "file-signature":
      return fileSignature(doc, doc.rawContent);
    case "sha256-content":
      return normalizeWhitespace ? normalizedSha256(doc.rawContent) : sha256(doc.rawContent);
  }
}

function describeHash(method: IdempotencyMethodId, normalizeWhitespace: boolean): string {
  switch (method) {
    case "normalized-sha256":
      return "对空白归一化后的内容计算 SHA-256";
    case "file-signature":
      return "基于 fileName + fileSize + contentHash 生成复合签名";
    case "sha256-content":
      return normalizeWhitespace
        ? "对空白归一化后的内容计算 SHA-256"
        : "对原始内容计算 SHA-256";
  }
}

export function checkIdempotency(input: IdempotencyInput): IdempotencyResult {
  const { methodId, params, targetDoc, otherDocs } = input;
  const { normalizeWhitespace, includeFileName, versionPolicy } = params;

  if (!targetDoc) {
    throw new PipelineError("missing_document", "未提供目标文档");
  }

  const hash = computeHash(methodId, targetDoc, normalizeWhitespace);
  const hashDescription = describeHash(methodId, normalizeWhitespace);

  // O(n) 扫描；dev 阶段文档数量少可接受。
  // 生产应在 DB 预存 hash 列并加索引，那时 listDocuments 也不该走内存。
  const duplicates = otherDocs.filter((d) => {
    const otherHash = computeHash(methodId, d, normalizeWhitespace);
    if (includeFileName) return otherHash === hash && d.fileName === targetDoc.fileName;
    return otherHash === hash;
  });

  const exists = duplicates.length > 0;
  const duplicate = duplicates[0];

  let recommendedAction: string;
  if (!exists) {
    recommendedAction = "proceed — 新文档，可继续 ingestion pipeline";
  } else if (versionPolicy === "skip-existing") {
    recommendedAction = `skip — 相同内容已存在 (${duplicate.fileName} v${duplicate.version})`;
  } else if (versionPolicy === "replace-existing") {
    recommendedAction = `replace — 将替换已有版本 (${duplicate.fileName} v${duplicate.version})`;
  } else {
    recommendedAction = `new-version — 将创建新版本 (${duplicate.fileName} 当前 v${duplicate.version})`;
  }

  return {
    output: {
      fileName: targetDoc.fileName,
      fileSize: targetDoc.fileSize,
      mimeType: targetDoc.mimeType,
      hash,
      exists,
      documentId: exists ? duplicate.id : targetDoc.id,
      version: exists ? duplicate.version : targetDoc.version,
      recommendedAction,
      ...(exists && {
        duplicateOf: {
          id: duplicate.id,
          fileName: duplicate.fileName,
          version: duplicate.version,
        },
      }),
    },
    trace: {
      method: methodId,
      hashDescription,
      normalizeWhitespace,
      includeFileName,
      versionPolicy,
      checkedAgainst: otherDocs.length,
      duplicatesFound: duplicates.length,
    },
    warnings: exists
      ? [`发现 ${duplicates.length} 个内容相同的文档，策略: ${versionPolicy}`]
      : [],
  };
}
