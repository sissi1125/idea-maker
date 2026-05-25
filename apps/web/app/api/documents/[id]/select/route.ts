import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/docStore";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) {
    return NextResponse.json(
      { error: { code: "not_found", message: `文档 ${id} 不存在` } },
      { status: 404 }
    );
  }
  return NextResponse.json({ document: doc });
}
