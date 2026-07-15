/**
 * ProductBriefModule — feat-400.1
 *
 * Product Brief 事实层：字段级审核 + 状态机 + 缺失/矛盾检测。
 *
 * 依赖：
 *   - AuthModule：JwtAuthGuard
 *   - DbModule 由 @Global 提供 DbService（无需在此 import）
 *
 * 导出 ProductBriefService：feat-400.2 的 Claim Map 需要读取"已确认字段"作为事实依据，
 *   通过 service 而不是自己写 SQL。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProductBriefController } from "./product-brief.controller";
import { ProductBriefService } from "./product-brief.service";
import { ProductBriefExtractor } from "./product-brief-extractor";

@Module({
  // LlmModule 是 @Global（feat-300.1），ProductBriefExtractor 直接注入 LlmService，无需 import
  imports: [AuthModule],
  controllers: [ProductBriefController],
  providers: [ProductBriefService, ProductBriefExtractor],
  exports: [ProductBriefService],
})
export class ProductBriefModule {}
