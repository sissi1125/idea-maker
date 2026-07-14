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
import { AgentModule } from "./agent/agent.module";
import { MemoryModule } from "./memory/memory.module";
import { EvalModule } from "./eval/eval.module";
import { ProductBriefModule } from "./product-brief/product-brief.module";
import { SourcesModule } from "./sources/sources.module";
import { ClaimsModule } from "./claims/claims.module";
import { ContentEvaluationModule } from "./content-evaluation/content-evaluation.module";
import { FeedbackLearningModule } from "./feedback-learning/feedback-learning.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { AssetsModule } from "./assets/assets.module";
import { PostersModule } from "./posters/posters.module";
import { JobsModule } from "./jobs/jobs.module";

@Module({
  controllers: [HealthController],
  imports: [
    // 基础设施（@Global）
    CommonModule,
    DbModule,
    // 通用异步任务（@Global）：extract / 内容生成 异步化
    JobsModule,
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
    // feat-300.2 Phase 3.5：8 个 Agent tools（暴露 AgentToolsService）
    AgentModule,
    // feat-300.4 Phase 3.5：Memory 子系统（CRUD + Distiller @OnEvent('feedback.upserted')）
    MemoryModule,
    // feat-300.5 Phase 3.5：Eval 体系（golden + LLM-as-judge + trajectory match + CI 集成）
    EvalModule,
    // feat-400.1 Phase 4：Product Brief 事实层（字段级审核 + 状态机 + 缺失/矛盾检测）
    ProductBriefModule,
    // feat-400.1 slice 4：受限官网导入（robots/同域/白名单/限速 + 防 SSRF）
    SourcesModule,
    // feat-400.2：Claim Map + 确定性门禁 + 评测 Agent + human_review 队列
    ClaimsModule,
    ContentEvaluationModule,
    // feat-400.3：反馈学习（编辑归类 → 偏好更新建议 → 用户接受写入表达约束）
    FeedbackLearningModule,
    // feat-400.4：Campaign 内容包（Brief → 3 个可比较角度 + grounding + 并排硬规则检查）
    CampaignsModule,
    // feat-400.5：视觉资产 + 受限模板海报（SVG→sharp→PNG，只用已批准资产/Claim）
    AssetsModule,
    PostersModule,
  ],
})
export class AppModule {}
