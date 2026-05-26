/**
 * MvpDocumentsModule — feat-200.2 Week 2
 *
 * 依赖 AuthModule（JwtAuthGuard）+ IngestionModule（enqueue + 状态回填）。
 * forwardRef 处理：MvpDocumentsModule ↔ IngestionModule 双向引用
 *   - MvpDocumentsController 注入 IngestionService（上传后入队）
 *   - IngestionService 注入 MvpDocumentsService（runner 完成后回填 status）
 */

import { forwardRef, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IngestionModule } from "../ingestion/ingestion.module";
import { FileStorageService } from "./file-storage.service";
import { MvpDocumentsController } from "./mvp-documents.controller";
import { MvpDocumentsService } from "./mvp-documents.service";

@Module({
  imports: [AuthModule, forwardRef(() => IngestionModule)],
  providers: [MvpDocumentsService, FileStorageService],
  controllers: [MvpDocumentsController],
  exports: [MvpDocumentsService, FileStorageService],
})
export class MvpDocumentsModule {}
