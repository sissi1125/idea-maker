/**
 * FeedbackLearningController — feat-400.3
 *
 *   POST /projects/:projectId/feedback-learning/feedback        记录一条内容反馈
 *   POST /projects/:projectId/feedback-learning/suggest         聚合生成偏好更新建议
 *   GET  /projects/:projectId/feedback-learning/suggestions     列出建议
 *   POST /projects/:projectId/feedback-learning/suggestions/:id/accept  接受（写入表达约束）
 *   POST /projects/:projectId/feedback-learning/suggestions/:id/reject  拒绝
 */

import {
  Body, Controller, Get, Param, Post, UseGuards, BadRequestException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { FeedbackLearningService } from "./feedback-learning.service";
import { EDIT_CATEGORIES, type EditCategory } from "./edit-diff-classifier";

class RecordFeedbackDto {
  @IsOptional() @IsString() evaluationId?: string;
  @IsString() @IsIn(["adopted", "edited", "rejected"]) action!: "adopted" | "edited" | "rejected";
  @IsOptional() @IsString() @MaxLength(5000) originalText?: string;
  @IsOptional() @IsString() @MaxLength(5000) editedText?: string;
  @IsOptional() @IsString() @IsIn([...EDIT_CATEGORIES]) category?: EditCategory;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags("feedback-learning")
@ApiBearerAuth()
@Controller("projects/:projectId/feedback-learning")
@UseGuards(JwtAuthGuard)
export class FeedbackLearningController {
  constructor(private readonly svc: FeedbackLearningService) {}

  @Post("feedback")
  async record(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: RecordFeedbackDto,
  ) {
    if (!body?.action) throw new BadRequestException("缺少 action");
    return this.svc.recordFeedback(user.id, projectId, body);
  }

  @Post("suggest")
  async suggest(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return this.svc.generateSuggestions(user.id, projectId);
  }

  @Get("suggestions")
  async list(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return this.svc.listSuggestions(user.id, projectId);
  }

  @Post("suggestions/:id/accept")
  async accept(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    return this.svc.acceptSuggestion(user.id, projectId, id);
  }

  @Post("suggestions/:id/reject")
  async reject(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    return this.svc.rejectSuggestion(user.id, projectId, id);
  }
}
