/**
 * MemoryController — feat-300.4
 *
 * 项目级 agent_memory 管理：
 *   GET    /projects/:projectId/memory             列表（按 confidence DESC）
 *   POST   /projects/:projectId/memory             手动新增一条偏好（source='manual'）
 *   PATCH  /projects/:projectId/memory/:memoryId   修改偏好
 *   DELETE /projects/:projectId/memory/:memoryId   删除
 *   POST   /projects/:projectId/memory/distill     手动触发一次蒸馏
 *
 * 鉴权：JwtAuthGuard 全覆盖；service 层再做 owner 校验。
 *
 * 为什么 distill 是 POST：
 *   它是"产生副作用的命令"（消耗 LLM token + 修改 agent_memory），GET 不合适。
 *   返回 { triggered, inserted, merged, processed, skipped? }，供前端 toast。
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
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { MEMORY_KINDS, type MemoryKind } from "./memory.types";
import { MemoryService } from "./memory.service";
import { MemoryDistiller } from "./memory-distiller";

class CreateMemoryDto {
  @IsString() @IsIn([...MEMORY_KINDS]) kind!: MemoryKind;
  @IsString() @MaxLength(2000) content!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
}

class UpdateMemoryDto {
  @IsOptional() @IsString() @IsIn([...MEMORY_KINDS]) kind?: MemoryKind;
  @IsOptional() @IsString() @MaxLength(2000) content?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
}

@ApiTags("memory")
@ApiBearerAuth()
@Controller("projects/:projectId/memory")
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(
    private readonly memory: MemoryService,
    private readonly distiller: MemoryDistiller,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    const items = await this.memory.list(user.id, projectId);
    return { memory: items };
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateMemoryDto,
  ) {
    if (!body) throw new BadRequestException("缺少 body");
    const item = await this.memory.create(user.id, projectId, body);
    return { memory: item };
  }

  @Patch(":memoryId")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("memoryId") memoryId: string,
    @Body() body: UpdateMemoryDto,
  ) {
    const item = await this.memory.update(user.id, projectId, memoryId, body);
    return { memory: item };
  }

  @Delete(":memoryId")
  @HttpCode(204)
  async delete(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("memoryId") memoryId: string,
  ) {
    await this.memory.delete(user.id, projectId, memoryId);
  }

  @Post("distill")
  async distill(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    const result = await this.distiller.distillForUser(user.id, projectId);
    return { result };
  }
}
