/**
 * AutoGenerationsModule — feat-200.4 Week 4
 *
 * 监听 ingestion.completed → 自动调 GenerationsService.generate（source=auto）
 * 依赖 GenerationsModule + AuthModule（owner 校验）
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GenerationsModule } from "../generations/generations.module";
import { AutoGenerationsController } from "./auto-generations.controller";
import { AutoGenerationsService } from "./auto-generations.service";

@Module({
  imports: [AuthModule, GenerationsModule],
  providers: [AutoGenerationsService],
  controllers: [AutoGenerationsController],
  exports: [AutoGenerationsService],
})
export class AutoGenerationsModule {}
