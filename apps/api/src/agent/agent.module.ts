/**
 * AgentModule — feat-300.3 任务 8（汇总）
 *
 * 完整暴露 Phase 3.5 Agent 子系统：
 *   - Controller：6 个 HTTP / SSE 端点
 *   - Runner：ReAct 主循环
 *   - Repository：agent_runs / agent_steps CRUD
 *   - SSE：EventEmitter2 桥 + 心跳
 *   - ContextManager / MemoryReader / SpillStorage / AgentToolsService
 *
 * 依赖：
 *   - LlmModule (@Global) → LlmService / TavilyClient
 *   - DbModule (@Global) → DbService
 *   - AuthModule → JwtAuthGuard
 *   - PipelineModule → ProvidersService（embedding client 构造）
 *   - ProjectsModule → ProjectsService（鉴权 + settings 加载）
 *   - EventEmitterModule（app.module.ts 已全局注册）
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PipelineModule } from "../pipeline/pipeline.module";
import { ProjectsModule } from "../projects/projects.module";
import { CostModule } from "../cost/cost.module";
import { PlatformRulesModule } from "../platform-rules/platform-rules.module";
import { NotesModule } from "../notes/notes.module";

import { AgentController } from "./agent.controller";
import { AgentRunnerService } from "./agent-runner.service";
import { AgentRunsRepository } from "./agent-runs.repository";
import { AgentSseService } from "./agent-sse.service";
import { AgentToolsService } from "./agent-tools.service";
import { ContextManager } from "./context-manager";
import { MemoryReader } from "./memory-reader";
import { SpillStorage } from "./spill-storage.service";

@Module({
  imports: [AuthModule, PipelineModule, ProjectsModule, CostModule, PlatformRulesModule, NotesModule],
  controllers: [AgentController],
  providers: [
    AgentRunnerService,
    AgentRunsRepository,
    AgentSseService,
    AgentToolsService,
    ContextManager,
    MemoryReader,
    SpillStorage,
  ],
  exports: [
    AgentToolsService,
    SpillStorage,
    AgentRunsRepository,
    AgentSseService,
    // feat-300.5：EvalRunner 直接调 AgentRunnerService.run
    AgentRunnerService,
  ],
})
export class AgentModule {}
