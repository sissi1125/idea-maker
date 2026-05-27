/**
 * CostController — feat-200.4 Week 4
 *
 *   GET /projects/:projectId/cost/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 不提供细粒度（每次 generate）查询：那直接走 /generations 即可。
 */

import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { CostService } from "./cost.service";

@ApiTags("cost")
@ApiBearerAuth()
@Controller("projects/:projectId/cost")
@UseGuards(JwtAuthGuard)
export class CostController {
  constructor(private readonly cost: CostService) {}

  @Get("summary")
  async summary(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.cost.getProjectSummary(user.id, projectId, { from, to });
  }
}
