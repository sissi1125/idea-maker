/**
 * GenerationsController — feat-200.3 Week 3
 *
 *   POST /projects/:projectId/generate          执行一次 RAG pipeline generate
 *   GET  /projects/:projectId/generations       列出历史 generations
 *   GET  /projects/:projectId/generations/:id   获取单条 generation 详情
 *
 * 设计：
 *   - generate 是同步请求（不是 202 异步），前端等完整结果返回
 *   - Week 8 如需 SSE 推送 stage 进度，加 /generate/events 端点（复用 feat-200.2 SSE 模式）
 *   - 验证：JwtAuthGuard + 项目归属检查（在 service 层做）
 */

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { GenerationsService } from "./generations.service";
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
    return this.generations.generate(user.id, projectId, body.query);
  }

  @Get("generations")
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    const generations = await this.generations.listByProject(user.id, projectId);
    return { generations };
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
