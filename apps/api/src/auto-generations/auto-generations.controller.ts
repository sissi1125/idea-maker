/**
 * AutoGenerationsController — feat-200.4 Week 4
 *
 *   GET /projects/:projectId/documents/:documentId/auto-generations
 *
 * 前端在文档详情页看"为该文档自动生成的卡片"用。
 * 业务侧不暴露手动触发端点：触发完全由 ingestion.completed 决定，避免脏触发。
 */

import { Controller, Get, Param, UseGuards, NotFoundException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { DbService } from "../db/db.service";
import { AutoGenerationsService } from "./auto-generations.service";

@ApiTags("auto-generations")
@ApiBearerAuth()
@Controller("projects/:projectId/documents/:documentId/auto-generations")
@UseGuards(JwtAuthGuard)
export class AutoGenerationsController {
  constructor(
    private readonly autoGen: AutoGenerationsService,
    private readonly db: DbService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
  ) {
    // owner 校验：通过 projects + documents JOIN 确认文档归属
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1
         FROM documents d
         JOIN projects p ON p.id = d.project_id
         WHERE d.id = $1 AND d.project_id = $2 AND p.owner_id = $3`,
        [documentId, projectId, user.id],
      );
      if (rows.length === 0) throw new NotFoundException("文档不存在");
    });
    const items = await this.autoGen.listByDocument(documentId);
    return { items };
  }
}
