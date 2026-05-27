/**
 * PipelineOrchestratorModule — feat-200.3 Week 3
 *
 * 把 pipeline-orchestrator service 注册到 DI 容器。
 * 依赖 PipelineModule（ProvidersService）和 CommonModule（TraceContextService）。
 */

import { Module } from "@nestjs/common";
import { PipelineOrchestratorService } from "./pipeline-orchestrator.service";
import { PipelineModule } from "../pipeline/pipeline.module";

@Module({
  imports: [PipelineModule],
  providers: [PipelineOrchestratorService],
  exports: [PipelineOrchestratorService],
})
export class PipelineOrchestratorModule {}
