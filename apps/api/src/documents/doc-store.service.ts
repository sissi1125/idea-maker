/**
 * DocStoreService — 文档存储（NestJS 端）
 *
 * 复刻 apps/web/lib/docStore.ts 的语义，并把"数据文件路径"提升为可注入：
 *   - 默认指向 apps/web/data/documents.json（与 Next.js 共用同一份数据，方便双跑期）
 *   - 可通过 DOCUMENTS_DATA_FILE 环境变量覆写（Wave 4 部署架构里会指向独立目录）
 *
 * Wave 4 会把 apps/web 的 docStore.ts 删掉，统一走这里。
 */

import { Injectable } from "@nestjs/common";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

export interface DocumentRecord {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  hash: string;
  version: number;
  rawContent: string;
  isBinary: boolean;
  createdAt: string;
  updatedAt: string;
  processingStatus: "ready" | "processing" | "error";
}

export function isBinaryMimeType(mimeType: string): boolean {
  return BINARY_MIME_TYPES.has(mimeType);
}

@Injectable()
export class DocStoreService {
  /**
   * 数据文件绝对路径。
   * 默认与 apps/web 共用 apps/web/data/documents.json（双跑期同步）。
   * 通过 DOCUMENTS_DATA_FILE 环境变量可指向其他路径（部署时用）。
   */
  private readonly dataFile: string;

  constructor() {
    const fromEnv = process.env.DOCUMENTS_DATA_FILE;
    if (fromEnv) {
      this.dataFile = path.isAbsolute(fromEnv)
        ? fromEnv
        : path.resolve(process.cwd(), fromEnv);
    } else {
      // 从 apps/api 向上找到 monorepo 根，再到 apps/web/data
      // apps/api 启动时 cwd 通常是 apps/api，向上一层是 apps，再一层是 repo 根
      const repoRoot = path.resolve(process.cwd(), "..", "..");
      this.dataFile = path.join(repoRoot, "apps/web/data/documents.json");
    }
  }

  private read(): DocumentRecord[] {
    try {
      const raw = fs.readFileSync(this.dataFile, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.documents) ? parsed.documents : [];
    } catch {
      return [];
    }
  }

  private write(docs: DocumentRecord[]): void {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    fs.writeFileSync(
      this.dataFile,
      JSON.stringify({ documents: docs }, null, 2),
      "utf-8",
    );
  }

  list(): DocumentRecord[] {
    return this.read().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  create(
    fileName: string,
    mimeType: string,
    rawContent: string,
    isBinary = false,
  ): DocumentRecord {
    const docs = this.read();
    const now = new Date().toISOString();
    // hash 按内容做幂等键（与 apps/web 完全一致）
    const hash = crypto
      .createHash("sha256")
      .update(`${fileName}::${mimeType}::${rawContent}`)
      .digest("hex");
    const id = crypto.randomBytes(8).toString("hex");
    const fileSize = isBinary
      ? Buffer.from(rawContent, "base64").length
      : Buffer.byteLength(rawContent, "utf-8");

    const doc: DocumentRecord = {
      id,
      fileName,
      fileSize,
      mimeType,
      hash,
      version: 1,
      rawContent,
      isBinary,
      createdAt: now,
      updatedAt: now,
      processingStatus: "ready",
    };
    docs.push(doc);
    this.write(docs);
    return doc;
  }

  /** 返回是否删除成功（false 表示不存在）。 */
  delete(id: string): boolean {
    const docs = this.read();
    const next = docs.filter((d) => d.id !== id);
    if (next.length === docs.length) return false;
    this.write(next);
    return true;
  }
}
