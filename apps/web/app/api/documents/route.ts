import { NextRequest, NextResponse } from "next/server";
import { listDocuments, createDocument, isBinaryMimeType } from "@/lib/docStore";

export async function GET() {
  try {
    const docs = listDocuments();
    // rawContent 可能很大，列表接口只返回 metadata，不含原始内容
    return NextResponse.json({
      documents: docs.map(({ // eslint-disable-next-line @typescript-eslint/no-unused-vars
      rawContent: _unused, ...meta }) => meta),
    });
  } catch (err) {
    return NextResponse.json({ error: { code: "storage_error", message: String(err) } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    let fileName = "pasted-text.txt";
    let mimeType = "text/plain";
    let rawContent = "";
    let isBinary = false;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const text = form.get("text");

      if (file && file instanceof File) {
        fileName = file.name;
        mimeType = file.type || "application/octet-stream";

        if (isBinaryMimeType(mimeType)) {
          // 二进制文件（PDF/DOCX）：转 base64 存储，避免 text() 乱码
          const arrayBuffer = await file.arrayBuffer();
          rawContent = Buffer.from(arrayBuffer).toString("base64");
          isBinary = true;
        } else {
          rawContent = await file.text();
        }
      } else if (typeof text === "string") {
        rawContent = text;
        const nameField = form.get("fileName");
        fileName = typeof nameField === "string" && nameField ? nameField : "pasted-text.txt";
      } else {
        return NextResponse.json(
          { error: { code: "invalid_input", message: "需要 file 或 text 字段" } },
          { status: 400 }
        );
      }
    } else {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.text !== "string") {
        return NextResponse.json(
          { error: { code: "invalid_input", message: "需要 text 字段" } },
          { status: 400 }
        );
      }
      rawContent = body.text;
      fileName = body.fileName ?? "pasted-text.txt";
      mimeType = body.mimeType ?? "text/plain";
    }

    if (!rawContent.trim()) {
      return NextResponse.json(
        { error: { code: "empty_content", message: "文档内容不能为空" } },
        { status: 400 }
      );
    }

    const doc = createDocument(fileName, mimeType, rawContent, isBinary);
    // 响应中不返回 rawContent（可能很大）
    const { // eslint-disable-next-line @typescript-eslint/no-unused-vars
      rawContent: _unused, ...meta } = doc;
    return NextResponse.json({ document: meta }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: { code: "storage_error", message: String(err) } }, { status: 500 });
  }
}
