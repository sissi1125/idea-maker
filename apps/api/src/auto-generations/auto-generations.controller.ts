/**
 * AutoGenerationsController — feat-200.4 Week 4 + feat-200.6 patch
 *
 *   GET /projects/:projectId/documents/:documentId/auto-generations
 *     文档级历史（feat-200.4 原始端点）
 *   GET /projects/:projectId/auto-generations/latest
 *     项目级最新成功卡片（feat-200.6 patch；Chat 页 ProjectInfoCards 用）
 *
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

/**
 * 项目级 auto-gen 查询——不挂在 /documents/:documentId 下，避免路径耦合。
 *
 *   GET /projects/:projectId/auto-generations/latest
 *     返回 { items: ProjectAutoGenLatest[] }，按 card_type 取最新一条
 *     succeeded 的自动卡片，前端按 cardType='intro' | 'compete' 自行索引。
 */
@ApiTags("auto-generations")
@ApiBearerAuth()
@Controller("projects/:projectId/auto-generations")
@UseGuards(JwtAuthGuard)
export class ProjectAutoGenerationsController {
  constructor(
    private readonly autoGen: AutoGenerationsService,
    private readonly db: DbService,
  ) {}

  @Get("latest")
  async latest(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    // owner 校验：直接查 projects.owner_id
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, user.id],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
    // 并行拉"已成功"和"进行中"两条信息——前端要同时知道有没有旧摘要 + 新一轮跑没跑
    const [items, inFlight] = await Promise.all([
      this.autoGen.getLatestByProject(projectId),
      this.autoGen.getInFlightByProject(projectId),
    ]);
    return { items, inFlight };
  }
}
