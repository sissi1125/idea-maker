/**
 * ProjectsController — feat-200.1 Week 1
 *
 *   GET    /projects                列出当前用户的项目
 *   POST   /projects                建项目
 *   GET    /projects/:id            取单个项目
 *   PATCH  /projects/:id            部分更新（name/emoji/description）
 *   DELETE /projects/:id            删除项目（FK 级联会清掉 settings）
 *
 *   GET    /projects/:id/settings   取项目设置
 *   PUT    /projects/:id/settings   覆盖式更新项目设置
 *
 * 全部走 JwtAuthGuard，user.id 从 req.user 取。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ProjectsService } from "./projects.service";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";

class CreateProjectDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  emoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  emoji?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(40) provider?: string | null;
  @IsOptional() @IsString() @MaxLength(2048) encryptedApiKey?: string | null;
  @IsOptional() @IsString() @MaxLength(80) model?: string | null;
  // temperature 0~2（OpenAI 上限），实际项目大多在 0~1
  @IsOptional() @IsNumber() @Min(0) @Max(2) temperature?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(32768) maxTokens?: number | null;
  @IsOptional() @IsString() @MaxLength(20) thinkingDepth?: string | null;
  @IsOptional() @IsString() @MaxLength(40) retrievalMode?: string | null;
}

@ApiTags("projects")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    const items = await this.projects.list(user.id);
    return { projects: items };
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateProjectDto) {
    const project = await this.projects.create(user.id, body);
    return { project };
  }

  @Get(":id")
  async get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    const project = await this.projects.get(user.id, id);
    return { project };
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: UpdateProjectDto,
  ) {
    const project = await this.projects.update(user.id, id, body);
    return { project };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.projects.delete(user.id, id);
  }

  @Get(":id/settings")
  async getSettings(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ) {
    const settings = await this.projects.getSettings(user.id, id);
    return { settings };
  }

  @Put(":id/settings")
  async updateSettings(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: UpdateSettingsDto,
  ) {
    const settings = await this.projects.updateSettings(user.id, id, body);
    return { settings };
  }
}
