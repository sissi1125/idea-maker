/**
 * IngestionModule — feat-200.2 Week 2
 *
 * 串起 IngestionService（DB 读写 + 事件发射）+ IngestionJobRunner（5-stage pipeline）+ IngestionController（HTTP + SSE）。
 *
 * forwardRef 处理：
 *   - IngestionService ↔ IngestionJobRunner（service.enqueue 触发 runner.run；runner.run 调 service.update*）
 *   - IngestionModule ↔ MvpDocumentsModule（controller 注入 IngestionService；runner 注入 MvpDocumentsService 回填 status）
 *
 * 事件总线：EventEmitterModule 在 app.module 全局 forRoot 注册一次，子模块直接 inject EventEmitter2 即可。
 */

import { forwardRef, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MvpDocumentsModule } from "../mvp-documents/mvp-documents.module";
import { IngestionController } from "./ingestion.controller";
import { IngestionJobRunner } from "./ingestion-job-runner";
import { IngestionService } from "./ingestion.service";

@Module({
  imports: [AuthModule, forwardRef(() => MvpDocumentsModule)],
  providers: [IngestionService, IngestionJobRunner],
  controllers: [IngestionController],
  exports: [IngestionService],
})
export class IngestionModule {}
