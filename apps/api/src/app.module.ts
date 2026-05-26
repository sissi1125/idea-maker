import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PipelineModule } from "./pipeline/pipeline.module";
import { DocumentsModule } from "./documents/documents.module";
import { SnapshotsModule } from "./snapshots/snapshots.module";
import { DbModule } from "./db/db.module";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";

@Module({
  controllers: [HealthController],
  imports: [
    // 基础设施（@Global）
    CommonModule,
    DbModule,
    // 旧 RAG pipeline（feat-100.x，保留双跑）
    PipelineModule,
    DocumentsModule,
    SnapshotsModule,
    // feat-200.1 MVP 业务模块
    AuthModule,
    ProjectsModule,
  ],
})
export class AppModule {}
