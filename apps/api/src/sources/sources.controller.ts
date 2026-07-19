/**
 * SourcesController — feat-400.1 slice 4
 *
 *   POST /projects/:projectId/sources/import-website   受限官网导入（同步跑，返回摘要）
 *   GET  /projects/:projectId/sources                  列出来源记录 + 已抓页面
 *
 * 鉴权：JwtAuthGuard；service 层再校 owner。
 */

import {
  Body, Controller, Get, Param, Post, UseGuards, BadRequestException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { SourcesService } from "./sources.service";

class ImportWebsiteDto {
  @IsString() @MaxLength(300) url!: string;
  @IsOptional() @IsInt() @Min(1) @Max(30) maxPages?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3) maxDepth?: number;
  @IsOptional() @IsBoolean() replaceExisting?: boolean;
}

@ApiTags("sources")
@ApiBearerAuth()
@Controller("projects/:projectId/sources")
@UseGuards(JwtAuthGuard)
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Post("import-website")
  async importWebsite(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: ImportWebsiteDto,
  ) {
    if (!body?.url) throw new BadRequestException("缺少 url");
    const result = await this.sources.runWebsiteImport(user.id, projectId, body);
    return { result };
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    return this.sources.listSources(user.id, projectId);
  }
}
