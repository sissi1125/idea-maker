/**
 * EvalModule — feat-300.5
 *
 * Agent 评估子系统：golden 测试集 + LLM-as-judge + trajectory match + CI 集成。
 *
 * 依赖：
 *   - AuthModule：JwtAuthGuard
 *   - ProjectsModule：owner 校验 + settings
 *   - AgentModule：AgentRunner.run（被测对象） + AgentRunsRepository（trajectory 提取）
 *   - LlmModule（@Global）：LlmService（judge LLM）
 *
 * 导出 EvalRunnerService：CLI 脚本（scripts/eval.ts）通过 NestApplicationContext
 * 实例化模块拿这个 service 直接调 run()。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { AgentModule } from "../agent/agent.module";
import { EvalController } from "./eval.controller";
import { EvalService } from "./eval.service";
import { EvalRunnerService } from "./eval-runner.service";
import { EvalRepository } from "./eval.repository";

@Module({
  imports: [AuthModule, ProjectsModule, AgentModule],
  controllers: [EvalController],
  providers: [EvalService, EvalRunnerService, EvalRepository],
  exports: [EvalRunnerService, EvalService],
})
export class EvalModule {}
