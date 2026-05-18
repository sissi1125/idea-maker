import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getDocument, listDocuments } from "@/lib/docStore";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizedSha256(content: string): string {
  return sha256(content.replace(/\s+/g, " ").trim());
}

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

    const normalizeWhitespace = Boolean(params?.normalizeWhitespace);
    const includeFileName = Boolean(params?.includeFileName);
    const versionPolicy = (params?.versionPolicy as string) ?? "new-version";

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
        hash = normalizeWhitespace ? normalizedSha256(doc.rawContent) : sha256(doc.rawContent);
        hashDescription = normalizeWhitespace
          ? "对空白归一化后的内容计算 SHA-256"
          : "对原始内容计算 SHA-256";
    }

    // Check for duplicates across all documents
    const allDocs = listDocuments();
    const duplicates = allDocs.filter((d) => {
      if (d.id === doc.id) return false;
      const otherHash = methodId === "file-signature"
        ? fileSignature(d, d.rawContent)
        : methodId === "normalized-sha256"
        ? normalizedSha256(d.rawContent)
        : normalizeWhitespace
        ? normalizedSha256(d.rawContent)
        : sha256(d.rawContent);
      if (includeFileName) return otherHash === hash && d.fileName === doc.fileName;
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
        ...(exists && { duplicateOf: { id: duplicate.id, fileName: duplicate.fileName, version: duplicate.version } }),
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
