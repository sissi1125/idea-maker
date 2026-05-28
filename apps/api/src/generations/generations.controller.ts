/**
 * GenerationsController — feat-200.3 Week 3 + feat-200.4 Week 4
 *
 *   POST /projects/:projectId/generate                  执行一次 RAG pipeline generate
 *   GET  /projects/:projectId/generations               列表（cursor 分页 + status/source 过滤）
 *   GET  /projects/:projectId/generations/:id           单条详情
 *
 * 设计：
 *   - generate 是同步请求（不是 202 异步），前端等完整结果返回
 *   - Week 8 如需 SSE 推送 stage 进度，加 /generate/events 端点（复用 feat-200.2 SSE 模式）
 *   - 验证：JwtAuthGuard + 项目归属检查（在 service 层做）
 *   - 列表分页：cursor + limit；不再返回固定 50 条数组
 */

import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { GenerationsService, type GenerationSource } from "./generations.service";
import type { GenerateRequest } from "../pipeline-orchestrator/pipeline-orchestrator.types";

@ApiTags("generations")
@ApiBearerAuth()
@Controller("projects/:projectId")
@UseGuards(JwtAuthGuard)
export class GenerationsController {
  constructor(private readonly generations: GenerationsService) {}

  @Post("generate")
  async generate(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: GenerateRequest,
  ) {
    return this.generations.generate(user.id, projectId, body.query, {
      source: "manual",
      platformRuleIds: body.platformRuleIds,
    });
  }

  @Get("generations")
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
    @Query("source") source?: string,
  ) {
    const result = await this.generations.listByProject(user.id, projectId, {
      cursor,
      limit: limit ? Number(limit) : undefined,
      status,
      source: source as GenerationSource | undefined,
    });
    return { generations: result.generations, nextCursor: result.nextCursor };
  }

  @Get("generations/:generationId")
  async getOne(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("generationId") generationId: string,
  ) {
    const generation = await this.generations.getGeneration(user.id, projectId, generationId);
    return { generation };
  }
}
