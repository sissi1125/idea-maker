/**
 * FeedbackLearningModule — feat-400.3
 *
 * 依赖 ProductBriefModule 导出的 ProductBriefService（接受建议时写入表达约束字段）。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProductBriefModule } from "../product-brief/product-brief.module";
import { FeedbackLearningController } from "./feedback-learning.controller";
import { FeedbackLearningService } from "./feedback-learning.service";

@Module({
  imports: [AuthModule, ProductBriefModule],
  controllers: [FeedbackLearningController],
  providers: [FeedbackLearningService],
  exports: [FeedbackLearningService],
})
export class FeedbackLearningModule {}
