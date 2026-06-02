/**
 * NotesModule — feat-200.7 Week 7
 *
 * 笔记库：依赖 AuthModule（JwtAuthGuard）+ DbModule（全局 forRoot 已注入）。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PipelineModule } from "../pipeline/pipeline.module";
import { NotesController } from "./notes.controller";
import { NotesService } from "./notes.service";

@Module({
  // feat-300.4：PipelineModule 提供 ProvidersService（embedding client 工厂）
  imports: [AuthModule, PipelineModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
