import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { HealthController } from "./health.controller";
import { PipelineModule } from "./pipeline/pipeline.module";
import { DocumentsModule } from "./documents/documents.module";
import { SnapshotsModule } from "./snapshots/snapshots.module";
import { DbModule } from "./db/db.module";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { MvpDocumentsModule } from "./mvp-documents/mvp-documents.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { GenerationsModule } from "./generations/generations.module";
import { FeedbacksModule } from "./feedbacks/feedbacks.module";
import { CostModule } from "./cost/cost.module";
import { AutoGenerationsModule } from "./auto-generations/auto-generations.module";
import { NotesModule } from "./notes/notes.module";
import { PlatformRulesModule } from "./platform-rules/platform-rules.module";
import { LlmModule } from "./llm/llm.module";

@Module({
  controllers: [HealthController],
  imports: [
    // 基础设施（@Global）
    CommonModule,
    DbModule,
    // feat-200.2：进程内事件总线，IngestionService 发 / IngestionController SSE 订阅
    EventEmitterModule.forRoot({ wildcard: false, maxListeners: 100 }),
    // 旧 RAG pipeline（feat-100.x，保留双跑）
    PipelineModule,
    DocumentsModule,
    SnapshotsModule,
    // feat-200.1 MVP 业务模块
    AuthModule,
    ProjectsModule,
    // feat-200.2 MVP 业务模块
    MvpDocumentsModule,
    IngestionModule,
    // feat-200.3 Pipeline Orchestrator + Generate
    GenerationsModule,
    // feat-200.4 Week 4
    FeedbacksModule,
    CostModule,
    AutoGenerationsModule,
    // feat-200.7 Week 7
    NotesModule,
    // feat-200.8 Week 8
    PlatformRulesModule,
    // feat-300.1 Phase 3.5：Agent LLM 底座（@Global，供后续 AgentModule 等复用）
    LlmModule,
  ],
})
export class AppModule {}
