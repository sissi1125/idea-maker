import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PipelineModule } from "./pipeline/pipeline.module";
import { DocumentsModule } from "./documents/documents.module";

@Module({
  controllers: [HealthController],
  imports: [PipelineModule, DocumentsModule],
})
export class AppModule {}
