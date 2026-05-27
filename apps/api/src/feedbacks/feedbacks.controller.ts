/**
 * FeedbacksController — feat-200.4 Week 4
 *
 *   POST /generations/:id/feedback  upsert（首次提交或覆盖）
 *   GET  /generations/:id/feedback  查询（不存在返回 { feedback: null }）
 *
 * 路由刻意脱离 /projects/:projectId/ 前缀：
 *   feedback 是 generation 维度的语义，projectId 在 service 层通过 generation→project 反推校验，
 *   前端只持有 generationId 就能调用（与"列表→点开→评分"的交互一致）。
 */

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { FeedbacksService } from "./feedbacks.service";
import type { FeedbackInput } from "./feedbacks.types";

@ApiTags("feedbacks")
@ApiBearerAuth()
@Controller("generations/:generationId/feedback")
@UseGuards(JwtAuthGuard)
export class FeedbacksController {
  constructor(private readonly feedbacks: FeedbacksService) {}

  @Post()
  async submit(
    @CurrentUser() user: RequestUser,
    @Param("generationId") generationId: string,
    @Body() body: FeedbackInput,
  ) {
    const feedback = await this.feedbacks.upsert(user.id, generationId, body ?? {});
    return { feedback };
  }

  @Get()
  async getOne(
    @CurrentUser() user: RequestUser,
    @Param("generationId") generationId: string,
  ) {
    const feedback = await this.feedbacks.getByGeneration(user.id, generationId);
    return { feedback };
  }
}
