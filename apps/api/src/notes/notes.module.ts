/**
 * NotesModule — feat-200.7 Week 7
 *
 * 笔记库：依赖 AuthModule（JwtAuthGuard）+ DbModule（全局 forRoot 已注入）。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotesController } from "./notes.controller";
import { NotesService } from "./notes.service";

@Module({
  imports: [AuthModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
