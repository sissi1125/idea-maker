import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocStoreService } from "./doc-store.service";

@Module({
  providers: [DocStoreService],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
