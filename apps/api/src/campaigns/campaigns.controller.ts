/**
 * CampaignsController — feat-400.4
 *
 *   POST /projects/:projectId/campaigns                          创建 Campaign Brief
 *   GET  /projects/:projectId/campaigns                          列出
 *   GET  /projects/:projectId/campaigns/:id                      详情（角度 + 每个的硬规则检查/去向）
 *   POST /projects/:projectId/campaigns/:id/generate             生成 3 个可比较角度
 *   POST /projects/:projectId/campaigns/:id/variants             手写一个角度
 *   POST /projects/:projectId/campaigns/:id/variants/:vid/regenerate  重新生成单个角度
 */

import {
  Body, Controller, Get, HttpCode, Param, Post, UseGuards, BadRequestException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { CampaignsService } from "./campaigns.service";
import { JobsService } from "../jobs/jobs.service";

class CreateCampaignDto {
  @IsString() @IsIn(["launch", "feature_update", "acquisition", "messaging"])
  goal!: "launch" | "feature_update" | "acquisition" | "messaging";
  @IsOptional() @IsString() @MaxLength(200) targetAudience?: string;
  @IsOptional() @IsString() @MaxLength(200) scenario?: string;
  @IsOptional() @IsString() @MaxLength(50) platform?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5000) maxLength?: number;
  @IsOptional() @IsString() @MaxLength(200) cta?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) allowedClaimIds?: string[];
  @IsOptional() @IsString() @MaxLength(500) avoidNotes?: string;
}

class ManualVariantDto {
  @IsOptional() @IsString() @MaxLength(100) angle?: string;
  @IsOptional() @IsString() @MaxLength(300) hook?: string;
  @IsString() @MaxLength(3000) body!: string;
  @IsOptional() @IsString() @MaxLength(200) cta?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) claimIds?: string[];
}

@ApiTags("campaigns")
@ApiBearerAuth()
@Controller("projects/:projectId/campaigns")
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(
    private readonly svc: CampaignsService,
    private readonly jobs: JobsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateCampaignDto,
  ) {
    if (!body?.goal) throw new BadRequestException("缺少 goal");
    return this.svc.createCampaign(user.id, projectId, body);
  }

  @Get()
  async list(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return this.svc.listCampaigns(user.id, projectId);
  }

  @Get(":id")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    return this.svc.getCampaign(user.id, projectId, id);
  }

  @Post(":id/generate")
  @HttpCode(202)
  async generate(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    // 异步：立即返回 jobId，后台跑 LLM（防生产网关 30~60s 超时掐断）
    return this.svc.startGenerate(user.id, projectId, id);
  }

  @Get(":id/generate/jobs/:jobId")
  async generateJob(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ) {
    return { job: await this.jobs.get(user.id, projectId, jobId) };
  }

  @Post(":id/variants")
  async addVariant(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Body() body: ManualVariantDto,
  ) {
    if (!body?.body) throw new BadRequestException("缺少正文");
    return this.svc.addManualVariant(user.id, projectId, id, body);
  }

  @Post(":id/variants/:vid/regenerate")
  async regenerate(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Param("vid") vid: string,
  ) {
    return this.svc.regenerateVariant(user.id, projectId, id, vid);
  }

  /** 采纳一个角度（3.6 消费出口） */
  @Post(":id/variants/:vid/adopt")
  async adopt(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Param("vid") vid: string,
  ) {
    return this.svc.setAdopted(user.id, projectId, id, vid, true);
  }
}
