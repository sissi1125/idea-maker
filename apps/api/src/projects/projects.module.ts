/**
 * ProjectsModule — feat-200.1 Week 1
 *
 * 依赖 AuthModule（导入 JwtAuthGuard）。DbService 来自全局 DbModule。
 */

import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
