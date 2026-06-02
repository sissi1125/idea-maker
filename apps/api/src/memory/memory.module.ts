/**
 * MemoryModule — feat-300.4
 *
 * agent_memory 子系统：CRUD + Distiller（feedback → LLM → memory）。
 *
 * 依赖：
 *   - AuthModule：JwtAuthGuard
 *   - LlmModule（@Global）：LlmService
 *   - ProjectsModule：ProjectsService（手动触发 distill 的 owner 校验）
 *   - EventEmitterModule（app.module.ts 全局）：@OnEvent('feedback.upserted')
 *
 * 导出 MemoryService：未来 EvalRunner / AgentTracePanel 后端可能需要直接读 memory，
 * 通过 service 而不是自己写 SQL。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { MemoryController } from "./memory.controller";
import { MemoryService } from "./memory.service";
import { MemoryDistiller } from "./memory-distiller";

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [MemoryController],
  providers: [MemoryService, MemoryDistiller],
  exports: [MemoryService],
})
export class MemoryModule {}
