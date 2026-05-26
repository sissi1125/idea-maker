import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocStoreService } from "./doc-store.service";

@Module({
  providers: [DocStoreService],
  exports: [DocStoreService], // PipelineModule 的 idempotency / preprocess 复用
  controllers: [DocumentsController],
})
export class DocumentsModule {}
