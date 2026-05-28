/**
 * PlatformRulesController — feat-200.8 Week 8
 *
 *   POST   /projects/:projectId/platform-rules
 *   GET    /projects/:projectId/platform-rules
 *   GET    /projects/:projectId/platform-rules/:ruleId
 *   PATCH  /projects/:projectId/platform-rules/:ruleId
 *   DELETE /projects/:projectId/platform-rules/:ruleId
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsBoolean, IsInt, IsObject, IsOptional, IsString,
  MaxLength, Min, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { PlatformRulesService } from "./platform-rules.service";

class PlatformRuleConfigDto {
  @IsOptional() @IsInt() @Min(1) maxLength?: number;
  @IsOptional() bannedKeywords?: string[];
  @IsOptional() @IsString() mandatoryTagPattern?: string;
  @IsOptional() @IsInt() @Min(1) mandatoryTagMin?: number;
  @IsOptional() @IsString() @MaxLength(2000) styleHint?: string;
}

class CreateRuleDto {
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => PlatformRuleConfigDto)
  config?: PlatformRuleConfigDto;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateRuleDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => PlatformRuleConfigDto)
  config?: PlatformRuleConfigDto;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@ApiTags("platform-rules")
@ApiBearerAuth()
@Controller("projects/:projectId/platform-rules")
@UseGuards(JwtAuthGuard)
export class PlatformRulesController {
  constructor(private readonly rules: PlatformRulesService) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateRuleDto,
  ) {
    if (!body) throw new BadRequestException("缺少 body");
    const rule = await this.rules.create(user.id, projectId, body);
    return { rule };
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    const rules = await this.rules.list(user.id, projectId);
    return { rules };
  }

  @Get(":ruleId")
  async getOne(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("ruleId") ruleId: string,
  ) {
    const rule = await this.rules.getOne(user.id, projectId, ruleId);
    return { rule };
  }

  @Patch(":ruleId")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("ruleId") ruleId: string,
    @Body() body: UpdateRuleDto,
  ) {
    const rule = await this.rules.update(user.id, projectId, ruleId, body);
    return { rule };
  }

  @Delete(":ruleId")
  @HttpCode(204)
  async delete(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("ruleId") ruleId: string,
  ) {
    await this.rules.delete(user.id, projectId, ruleId);
  }
}
