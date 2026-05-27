/**
 * FeedbacksModule — feat-200.4 Week 4
 *
 * 依赖 AuthModule（JwtAuthGuard）+ GenerationsModule（assertOwnedByUser）。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GenerationsModule } from "../generations/generations.module";
import { FeedbacksController } from "./feedbacks.controller";
import { FeedbacksService } from "./feedbacks.service";

@Module({
  imports: [AuthModule, GenerationsModule],
  providers: [FeedbacksService],
  controllers: [FeedbacksController],
  exports: [FeedbacksService],
})
export class FeedbacksModule {}
