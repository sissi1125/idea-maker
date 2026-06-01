/**
 * EvalController — feat-300.5
 *
 *   POST /projects/:projectId/eval/run                      触发一次 eval（同步返回 summary）
 *   GET  /projects/:projectId/eval/runs?limit=              最近 eval runs 列表
 *   GET  /projects/:projectId/eval/runs/:runId              单条详情
 *   POST /projects/:projectId/eval/golden/from-feedback/:generationId
 *                                                           把一条 feedback 升级成 golden
 *
 * 注意：POST /eval/run 是同步阻塞（30 条 golden ≈ 60s+），未来加 SSE 进度推流（feat-300.7）。
 * 客户端调用时务必设大 timeout。
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { EvalRunnerService } from "./eval-runner.service";
import { EvalService } from "./eval.service";

class RunEvalDto {
  @IsOptional() @IsString() @IsIn(["manual", "cli", "ci", "cron"]) triggeredBy?: "manual" | "cli" | "ci" | "cron";
  @IsOptional() @IsString() gitCommit?: string;
  @IsOptional() @IsString() gitBranch?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(5) thresholdDrop?: number;
  @IsOptional() @IsArray() ids?: string[];
  @IsOptional() @IsArray() tags?: string[];
}

class ListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

@ApiTags("eval")
@ApiBearerAuth()
@Controller("projects/:projectId/eval")
@UseGuards(JwtAuthGuard)
export class EvalController {
  constructor(
    private readonly runner: EvalRunnerService,
    private readonly svc: EvalService,
  ) {}

  @Post("run")
  @HttpCode(200)
  async run(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: RunEvalDto,
  ) {
    const summary = await this.runner.run({
      userId: user.id,
      projectId,
      triggeredBy: body?.triggeredBy,
      gitCommit: body?.gitCommit ?? null,
      gitBranch: body?.gitBranch ?? null,
      thresholdDrop: body?.thresholdDrop,
      filter: { ids: body?.ids, tags: body?.tags },
    });
    return { summary };
  }

  @Get("runs")
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Query() query: ListQueryDto,
  ) {
    const runs = await this.svc.listRecentRuns(user.id, projectId, query.limit ?? 20);
    return { runs };
  }

  @Get("runs/:runId")
  async getOne(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    const run = await this.svc.getRun(user.id, projectId, runId);
    return { run };
  }

  @Post("golden/from-feedback/:generationId")
  @HttpCode(201)
  async promoteFromFeedback(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("generationId") generationId: string,
  ) {
    const result = await this.svc.promoteFeedbackToGolden(user.id, projectId, generationId);
    return result;
  }
}
