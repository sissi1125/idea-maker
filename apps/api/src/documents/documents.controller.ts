/**
 * DocumentsController — /documents
 *
 * 复刻 apps/web/app/api/documents/{,[id]}/route.ts 的行为：
 *   GET    /documents       列表（不返回 rawContent）
 *   POST   /documents       上传文本 / 二进制（multipart）/ 纯文本 JSON
 *   DELETE /documents/:id   删除
 *
 * 使用 Express 原生 Request 拿 multipart（不上 multer interceptor 也行：
 *  我们直接读 req.body / req.file 即可，因为 apps/web 的现行行为支持 raw JSON & multipart 两种）。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { DocStoreService, isBinaryMimeType } from "./doc-store.service";
import { PipelineError } from "@harness/rag-core";

@ApiTags("documents")
@Controller("documents")
export class DocumentsController {
  constructor(private readonly store: DocStoreService) {}

  @Get()
  list() {
    const docs = this.store.list();
    return {
      documents: docs.map((d) => {
        const { rawContent: _r, ...meta } = d;
        void _r;
        return meta;
      }),
    };
  }

  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file"))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const contentType = req.headers["content-type"] ?? "";
    let fileName = "pasted-text.txt";
    let mimeType = "text/plain";
    let rawContent = "";
    let isBinary = false;

    if (file) {
      // multipart with file
      fileName = file.originalname;
      mimeType = file.mimetype || "application/octet-stream";
      if (isBinaryMimeType(mimeType)) {
        rawContent = file.buffer.toString("base64");
        isBinary = true;
      } else {
        rawContent = file.buffer.toString("utf-8");
      }
    } else if (typeof contentType === "string" && contentType.includes("multipart/form-data")) {
      // multipart with pasted text 字段
      const text = body.text;
      if (typeof text !== "string") {
        throw new PipelineError("empty_text", "需要 file 或 text 字段");
      }
      rawContent = text;
      const nameField = body.fileName;
      fileName = typeof nameField === "string" && nameField ? nameField : "pasted-text.txt";
    } else {
      // raw JSON
      if (typeof body.text !== "string") {
        throw new PipelineError("empty_text", "需要 text 字段");
      }
      rawContent = body.text;
      fileName = typeof body.fileName === "string" ? body.fileName : "pasted-text.txt";
      mimeType = typeof body.mimeType === "string" ? body.mimeType : "text/plain";
    }

    if (!rawContent.trim()) {
      throw new PipelineError("empty_text", "文档内容不能为空");
    }

    const doc = this.store.create(fileName, mimeType, rawContent, isBinary);
    const { rawContent: _u, ...meta } = doc;
    return { document: meta };
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    const ok = this.store.delete(id);
    if (!ok) {
      throw new NotFoundException(`文档 ${id} 不存在`);
    }
    return { deleted: id };
  }
}
