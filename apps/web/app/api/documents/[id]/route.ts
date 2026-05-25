import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "documents.json");

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const store = JSON.parse(raw);
    const before = store.documents.length;
    store.documents = store.documents.filter((d: { id: string }) => d.id !== id);
    if (store.documents.length === before) {
      return NextResponse.json({ error: { code: "not_found", message: `文档 ${id} 不存在` } }, { status: 404 });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
    return NextResponse.json({ deleted: id });
  } catch (err) {
    return NextResponse.json({ error: { code: "storage_error", message: String(err) } }, { status: 500 });
  }
}
