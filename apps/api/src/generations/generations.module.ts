/**
 * GenerationsModule — feat-200.3 Week 3
 *
 * 提供 POST /projects/:id/generate 端点 + generations 历史查询。
 * 依赖 PipelineOrchestratorModule 做实际编排。
 */

import { Module } from "@nestjs/common";
import { GenerationsService } from "./generations.service";
import { GenerationsController } from "./generations.controller";
import { PipelineOrchestratorModule } from "../pipeline-orchestrator/pipeline-orchestrator.module";
import { AuthModule } from "../auth/auth.module";
import { PlatformRulesModule } from "../platform-rules/platform-rules.module";
import { CostModule } from "../cost/cost.module";

@Module({
  imports: [PipelineOrchestratorModule, AuthModule, PlatformRulesModule, CostModule],
  providers: [GenerationsService],
  controllers: [GenerationsController],
  exports: [GenerationsService],
})
export class GenerationsModule {}
