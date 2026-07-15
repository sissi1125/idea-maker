/**
 * ContentEvaluationModule — feat-400.2
 *
 * 确定性门禁 + 评测 Agent + 决策器 + human_review 队列。
 * LlmModule 是 @Global，EvaluationAgent 直接注入 LlmService。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentEvaluationController } from "./content-evaluation.controller";
import { ContentEvaluationService } from "./content-evaluation.service";
import { EvaluationAgent } from "./evaluation-agent";

@Module({
  imports: [AuthModule],
  controllers: [ContentEvaluationController],
  providers: [ContentEvaluationService, EvaluationAgent],
  exports: [ContentEvaluationService],
})
export class ContentEvaluationModule {}
