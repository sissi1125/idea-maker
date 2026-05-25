import fs from "fs";
import path from "path";
import crypto from "crypto";

/** 二进制格式（PDF、DOCX）在 JSON 中以 base64 编码存储 */
const BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "application/msword",
]);

export interface DocumentRecord {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  hash: string;
  version: number;
  /**
   * 文本文件：UTF-8 字符串原文。
   * 二进制文件（PDF/DOCX）：base64 编码字符串，使用时通过 getDocumentBuffer() 解码。
   */
  rawContent: string;
  /** 标记 rawContent 是否为 base64 编码的二进制内容 */
  isBinary: boolean;
  createdAt: string;
  updatedAt: string;
  processingStatus: "ready" | "processing" | "error";
}

const DATA_FILE = path.join(process.cwd(), "data", "documents.json");

function readStore(): DocumentRecord[] {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.documents) ? parsed.documents : [];
  } catch {
    return [];
  }
}

function writeStore(docs: DocumentRecord[]): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ documents: docs }, null, 2), "utf-8");
}

export function listDocuments(): DocumentRecord[] {
  return readStore().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getDocument(id: string): DocumentRecord | undefined {
  return readStore().find((d) => d.id === id);
}

/**
 * 获取文档的原始 Buffer（适合传给 pdf-parse / mammoth 等需要二进制的库）。
 * 文本文件返回 UTF-8 Buffer，二进制文件解码 base64。
 */
export function getDocumentBuffer(doc: DocumentRecord): Buffer {
  if (doc.isBinary) {
    return Buffer.from(doc.rawContent, "base64");
  }
  return Buffer.from(doc.rawContent, "utf-8");
}

/**
 * 创建文档记录。
 * @param rawContent 文本内容（UTF-8 字符串）或 base64 编码的二进制内容
 * @param isBinary   true 时 rawContent 为 base64，false 时为 UTF-8 文本
 */
export function createDocument(
  fileName: string,
  mimeType: string,
  rawContent: string,
  isBinary = false
): DocumentRecord {
  const docs = readStore();
  // 哈希统一在 UTF-8/base64 字符串上计算，保证一致性
  const hash = crypto.createHash("sha256").update(rawContent).digest("hex");
  const existing = docs.filter((d) => d.hash === hash);
  const version = existing.length > 0 ? Math.max(...existing.map((d) => d.version)) + 1 : 1;

  const fileSize = isBinary
    ? Buffer.from(rawContent, "base64").byteLength
    : Buffer.byteLength(rawContent, "utf-8");

  const doc: DocumentRecord = {
    id: crypto.randomUUID(),
    fileName,
    fileSize,
    mimeType,
    hash,
    version,
    rawContent,
    isBinary,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processingStatus: "ready",
  };

  writeStore([...docs, doc]);
  return doc;
}

/** 判断 mimeType 是否应该以二进制方式存储 */
export function isBinaryMimeType(mimeType: string): boolean {
  return BINARY_MIME_TYPES.has(mimeType);
}

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
