/**
 * NotesController — feat-200.7 Week 7
 *
 *   POST   /projects/:projectId/notes           创建
 *   GET    /projects/:projectId/notes?limit=&offset=  列表
 *   GET    /projects/:projectId/notes/:noteId   单条
 *   PATCH  /projects/:projectId/notes/:noteId   更新
 *   DELETE /projects/:projectId/notes/:noteId   删除
 *
 * 不暴露"批量删除 / 批量打 tag"——MVP 期 UI 也不需要。
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
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsArray, IsInt, IsOptional, IsString, MaxLength, Min,
} from "class-validator";
import { Type } from "class-transformer";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { NotesService } from "./notes.service";

class CreateNoteDto {
  @IsOptional() @IsString() generationId?: string | null;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(50000) content!: string;
  @IsOptional() @IsArray() tags?: string[];
}

class UpdateNoteDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(50000) content?: string;
  @IsOptional() @IsArray() tags?: string[];
}

class ListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

@ApiTags("notes")
@ApiBearerAuth()
@Controller("projects/:projectId/notes")
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateNoteDto,
  ) {
    if (!body) throw new BadRequestException("缺少 body");
    const note = await this.notes.create(user.id, projectId, body);
    return { note };
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Query() query: ListQueryDto,
  ) {
    return this.notes.list(user.id, projectId, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(":noteId")
  async getOne(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
  ) {
    const note = await this.notes.getOne(user.id, projectId, noteId);
    return { note };
  }

  @Patch(":noteId")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
    @Body() body: UpdateNoteDto,
  ) {
    const note = await this.notes.update(user.id, projectId, noteId, body);
    return { note };
  }

  @Delete(":noteId")
  @HttpCode(204)
  async delete(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
  ) {
    await this.notes.delete(user.id, projectId, noteId);
  }
}
