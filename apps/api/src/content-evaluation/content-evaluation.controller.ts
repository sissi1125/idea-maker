/**
 * ContentEvaluationController — feat-400.2
 *
 *   POST /projects/:projectId/content/evaluate                提交内容 → 门禁+评测+决策
 *   GET  /projects/:projectId/content/queue                   human_review 队列
 *   POST /projects/:projectId/content/evaluations/:id/decision 人工下结论
 *   GET  /projects/:projectId/content/evaluations             全部评测（可回放）
 */

import { Body, Controller, Get, Param, Post, UseGuards, BadRequestException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { ContentEvaluationService } from "./content-evaluation.service";

class EvaluateDto {
  @IsOptional() @IsString() @MaxLength(200) angle?: string;
  @IsOptional() @IsString() @MaxLength(200) targetAudience?: string;
  @IsOptional() @IsString() @MaxLength(500) hook?: string;
  @IsString() @MaxLength(5000) body!: string;
  @IsOptional() @IsString() @MaxLength(300) cta?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(50) claimIds?: string[];
  @IsOptional() @IsString() @MaxLength(50) platform?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) platformMaxLength?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(200) platformBannedWords?: string[];
}

class HumanDecisionDto {
  @IsString() @IsIn(["accepted", "edited", "rejected"]) decision!: "accepted" | "edited" | "rejected";
}

@ApiTags("content-evaluation")
@ApiBearerAuth()
@Controller("projects/:projectId/content")
@UseGuards(JwtAuthGuard)
export class ContentEvaluationController {
  constructor(private readonly svc: ContentEvaluationService) {}

  @Post("evaluate")
  async evaluate(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: EvaluateDto,
  ) {
    if (!body?.body) throw new BadRequestException("缺少内容正文");
    return { result: await this.svc.submitAndEvaluate(user.id, projectId, body) };
  }

  @Get("queue")
  async queue(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return this.svc.queue(user.id, projectId);
  }

  @Post("evaluations/:evalId/decision")
  async decide(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("evalId") evalId: string,
    @Body() body: HumanDecisionDto,
  ) {
    return this.svc.humanDecision(user.id, projectId, evalId, body.decision);
  }

  @Get("evaluations")
  async list(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return this.svc.listEvaluations(user.id, projectId);
  }
}
