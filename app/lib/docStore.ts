import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface DocumentRecord {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  hash: string;
  version: number;
  rawContent: string;
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

export function createDocument(
  fileName: string,
  mimeType: string,
  rawContent: string
): DocumentRecord {
  const docs = readStore();
  const hash = crypto.createHash("sha256").update(rawContent).digest("hex");
  const existing = docs.filter((d) => d.hash === hash);
  const version = existing.length > 0 ? Math.max(...existing.map((d) => d.version)) + 1 : 1;

  const doc: DocumentRecord = {
    id: crypto.randomUUID(),
    fileName,
    fileSize: Buffer.byteLength(rawContent, "utf-8"),
    mimeType,
    hash,
    version,
    rawContent,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processingStatus: "ready",
  };

  writeStore([...docs, doc]);
  return doc;
}

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
