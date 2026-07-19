/**
 * ClaimsController — feat-400.2
 *
 *   GET  /projects/:projectId/claims                  列出 Claim Map
 *   POST /projects/:projectId/claims/derive           从已确认 Brief 派生候选 Claim
 *   POST /projects/:projectId/claims                  手动新增 Claim
 *   POST /projects/:projectId/claims/:claimId/approve 批准（事实型需 evidence）
 *   POST /projects/:projectId/claims/:claimId/block   阻止
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, BadRequestException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { ClaimsService } from "./claims.service";
import { CLAIM_TYPES, RISK_LEVELS, type ClaimType, type RiskLevel } from "./claims.types";

class CreateClaimDto {
  @IsString() @MaxLength(1000) text!: string;
  @IsString() @IsIn([...CLAIM_TYPES]) claimType!: ClaimType;
  @IsOptional() @IsArray() @IsString({ each: true }) evidenceChunkIds?: string[];
  @IsOptional() @IsString() @IsIn([...RISK_LEVELS]) riskLevel?: RiskLevel;
  @IsOptional() @IsArray() @IsString({ each: true }) targetAudienceIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) scenarioIds?: string[];
}

class UpdateClaimDto {
  @IsString() @MaxLength(1000) text!: string;
  @IsString() @IsIn([...CLAIM_TYPES]) claimType!: ClaimType;
}

@ApiTags("claims")
@ApiBearerAuth()
@Controller("projects/:projectId/claims")
@UseGuards(JwtAuthGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return { claims: await this.claims.list(user.id, projectId) };
  }

  @Post("derive")
  async derive(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return { result: await this.claims.derive(user.id, projectId) };
  }

  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateClaimDto,
  ) {
    if (!body) throw new BadRequestException("缺少 body");
    return { claim: await this.claims.create(user.id, projectId, body) };
  }

  @Post(":claimId/approve")
  async approve(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("claimId") claimId: string,
  ) {
    return { claim: await this.claims.approve(user.id, projectId, claimId) };
  }

  @Post(":claimId/block")
  async block(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("claimId") claimId: string,
  ) {
    return { claim: await this.claims.block(user.id, projectId, claimId) };
  }

  @Patch(":claimId")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("claimId") claimId: string,
    @Body() body: UpdateClaimDto,
  ) {
    if (!body) throw new BadRequestException("缺少 body");
    return { claim: await this.claims.update(user.id, projectId, claimId, body) };
  }

  @Delete(":claimId")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("claimId") claimId: string,
  ) {
    await this.claims.remove(user.id, projectId, claimId);
    return { deleted: true };
  }
}
