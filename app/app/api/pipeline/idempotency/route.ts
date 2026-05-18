/**
 * RAG Pipeline Stage 1 - 文档幂等性检查 (Document Idempotency)
 *
 * 作用：在正式 ingestion 前判断这份文档是否已经处理过，避免重复入库、
 * 浪费 embedding 费用或产生脏数据。
 *
 * 在 pipeline 中的位置：
 *   文档上传 → [幂等性检查] → 预处理 → 分块 → 向量化 → 存储
 *
 * 支持三种 hash 方案，各有适用场景：
 *   - sha256-content:    最常用，直接对原始内容计算哈希
 *   - normalized-sha256: 忽略空白差异，适合用户编辑后重传的场景
 *   - file-signature:    结合文件名+大小+内容，适合同内容不同文件的场景
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getDocument, listDocuments } from "@/lib/docStore";

/** 对任意字符串计算 SHA-256，返回 hex 字符串 */
function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * 归一化后计算 SHA-256。
 * 把连续空白（空格、换行、Tab）压缩为单个空格再哈希，
 * 使"只改了换行"的文档与原文被视为相同内容。
 */
function normalizedSha256(content: string): string {
  return sha256(content.replace(/\s+/g, " ").trim());
}

/**
 * 文件签名 = sha256(fileName + fileSize + contentHash)。
 * 当同一内容可能来自不同文件名时，加入文件元信息增强区分度。
 * 适合企业知识库场景，文件名本身带有业务语义。
 */
function fileSignature(doc: { fileName: string; fileSize: number }, content: string): string {
  return sha256(`${doc.fileName}:${doc.fileSize}:${sha256(content)}`);
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { methodId, params, pipelineRun } = body as {
      methodId: string;
      params: Record<string, unknown>;
      pipelineRun: { selectedDocumentId: string | null };
    };

    // 确保用户已选择文档，否则无法进行哈希计算
    if (!pipelineRun?.selectedDocumentId) {
      return NextResponse.json(
        { error: { code: "missing_document", message: "未选择文档，请先在文档库选择一个文档版本" } },
        { status: 400 }
      );
    }

    const doc = getDocument(pipelineRun.selectedDocumentId);
    if (!doc) {
      return NextResponse.json(
        { error: { code: "document_not_found", message: `文档 ${pipelineRun.selectedDocumentId} 不存在` } },
        { status: 404 }
      );
    }

    // 从 params 解构配置项，提供安全的默认值
    const normalizeWhitespace = Boolean(params?.normalizeWhitespace);
    const includeFileName = Boolean(params?.includeFileName);
    const versionPolicy = (params?.versionPolicy as string) ?? "new-version";

    // 根据选择的 method 计算哈希值
    let hash: string;
    let hashDescription: string;

    switch (methodId) {
      case "normalized-sha256":
        hash = normalizedSha256(doc.rawContent);
        hashDescription = "对空白归一化后的内容计算 SHA-256";
        break;
      case "file-signature":
        hash = fileSignature(doc, doc.rawContent);
        hashDescription = "基于 fileName + fileSize + contentHash 生成复合签名";
        break;
      default: // sha256-content
        // normalizeWhitespace 参数允许 sha256-content 方法也支持归一化
        hash = normalizeWhitespace ? normalizedSha256(doc.rawContent) : sha256(doc.rawContent);
        hashDescription = normalizeWhitespace
          ? "对空白归一化后的内容计算 SHA-256"
          : "对原始内容计算 SHA-256";
    }

    /**
     * 遍历文档库，对每个其他文档用相同方法计算哈希后比较。
     * 注意：这里是 O(n) 扫描，在 dev 阶段文档数量少时可接受；
     * 生产环境应在数据库里存储预计算的 hash 字段并加索引。
     */
    const allDocs = listDocuments();
    const duplicates = allDocs.filter((d) => {
      if (d.id === doc.id) return false; // 排除自身

      const otherHash =
        methodId === "file-signature"
          ? fileSignature(d, d.rawContent)
          : methodId === "normalized-sha256"
          ? normalizedSha256(d.rawContent)
          : normalizeWhitespace
          ? normalizedSha256(d.rawContent)
          : sha256(d.rawContent);

      // includeFileName=true 时，文件名也必须一致才算重复
      if (includeFileName) return otherHash === hash && d.fileName === doc.fileName;
      return otherHash === hash;
    });

    const exists = duplicates.length > 0;
    const duplicate = duplicates[0];

    /**
     * 根据 versionPolicy 给出推荐动作，让后续 stage 或用户决定如何处理。
     * 这里只是建议，不直接操作数据库——保持 stage 职责单一。
     */
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

    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      output: {
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        hash,
        exists,
        documentId: exists ? duplicate.id : doc.id,
        version: exists ? duplicate.version : doc.version,
        recommendedAction,
        // 仅当发现重复时才返回 duplicateOf，避免 output 结构混乱
        ...(exists && {
          duplicateOf: { id: duplicate.id, fileName: duplicate.fileName, version: duplicate.version },
        }),
      },
      trace: {
        method: methodId,
        hashDescription,
        normalizeWhitespace,
        includeFileName,
        versionPolicy,
        durationMs,
        checkedAgainst: allDocs.length - 1,
        duplicatesFound: duplicates.length,
      },
      warnings: exists
        ? [`发现 ${duplicates.length} 个内容相同的文档，策略: ${versionPolicy}`]
        : [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "internal_error", message: String(err) } },
      { status: 500 }
    );
  }
}
