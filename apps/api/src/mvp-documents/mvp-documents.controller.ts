/**
 * MvpDocumentsController — feat-200.2 Week 2
 *
 *   POST   /projects/:projectId/documents          (multipart, ?category=)
 *   GET    /projects/:projectId/documents?category=
 *   GET    /projects/:projectId/documents/:docId
 *   DELETE /projects/:projectId/documents/:docId
 *
 * 上传同时自动入队 ingestion job：返回 { document, ingestionJobId }。
 * 前端拿 jobId 走 SSE 端点订阅进度。
 *
 * 注意：用 FileInterceptor 接 multipart；不接 raw JSON / base64（不是浏览器上传的形态）。
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { MvpDocumentsService } from "./mvp-documents.service";
import { IngestionService } from "../ingestion/ingestion.service";
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
} from "./mvp-documents.types";

class CategoryQuery {
  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  category?: DocumentCategory;
}

class UploadBodyDto {
  // multipart 字段：category 用 form field 传入（避免 query 与 body 重复）
  @IsIn(DOCUMENT_CATEGORIES)
  category!: DocumentCategory;
}

@ApiTags("documents")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("projects/:projectId/documents")
export class MvpDocumentsController {
  constructor(
    private readonly docs: MvpDocumentsService,
    private readonly ingestion: IngestionService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: UploadBodyDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("缺少 file 字段（multipart/form-data）");
    const document = await this.docs.create(user.id, projectId, {
      category: body.category,
      fileName: file.originalname,
      mimeType: file.mimetype || "application/octet-stream",
      buffer: file.buffer,
    });

    // 上传成功 → 立即入队 ingestion job（异步执行，不阻塞响应）
    const job = await this.ingestion.enqueue({
      projectId,
      documentId: document.id,
    });

    return { document, ingestionJobId: job.id };
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Query() q: CategoryQuery,
  ) {
    const documents = await this.docs.list(user.id, projectId, q.category);
    return { documents };
  }

  @Get(":docId")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("docId") docId: string,
  ) {
    const document = await this.docs.get(user.id, projectId, docId);
    return { document };
  }

  @Delete(":docId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("docId") docId: string,
  ) {
    await this.docs.delete(user.id, projectId, docId);
  }
}
