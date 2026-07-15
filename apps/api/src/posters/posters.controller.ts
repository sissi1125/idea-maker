/**
 * PostersController — feat-400.5
 *
 *   GET  /projects/:projectId/posters/templates       可用模板（id + 尺寸 + 字数上限）
 *   POST /projects/:projectId/posters/render           出图（先硬规则检查，通过才渲染真实 PNG）
 *   GET  /projects/:projectId/posters                  列表
 *   GET  /projects/:projectId/posters/:id/png          下载 PNG
 */

import {
  Body, Controller, Get, Param, Post, Res, StreamableFile, UseGuards, BadRequestException,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsHexColor, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { PostersService } from "./posters.service";
import { POSTER_TEMPLATES, POSTER_TEMPLATE_IDS } from "./poster-render";

class RenderPosterDto {
  @IsString() @IsIn(POSTER_TEMPLATE_IDS) templateId!: string;
  @IsString() @MaxLength(80) title!: string;
  @IsOptional() @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsString() claimId?: string;
  @IsOptional() @IsString() logoAssetId?: string;
  @IsOptional() @IsString() bgImageAssetId?: string;
  @IsOptional() @IsHexColor() bgColor?: string;
  @IsOptional() @IsHexColor() fgColor?: string;
}

class AutoPosterDto {
  @IsString() claimId!: string;
}

@ApiTags("posters")
@ApiBearerAuth()
@Controller("projects/:projectId/posters")
@UseGuards(JwtAuthGuard)
export class PostersController {
  constructor(private readonly posters: PostersService) {}

  @Get("templates")
  templates() {
    return {
      templates: POSTER_TEMPLATE_IDS.map((id) => {
        const t = POSTER_TEMPLATES[id];
        return { id, width: t.width, height: t.height, limits: t.limits };
      }),
    };
  }

  @Post("render")
  async render(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: RenderPosterDto,
  ) {
    if (!body?.templateId) throw new BadRequestException("缺少 templateId");
    const result = await this.posters.render(user.id, projectId, body);
    return { result };
  }

  /** 自动出图（3.7）：给卖点 id，自动用 产品名+卖点+官网图 出海报 */
  @Post("auto")
  async auto(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: AutoPosterDto,
  ) {
    if (!body?.claimId) throw new BadRequestException("缺少 claimId");
    const result = await this.posters.autoRender(user.id, projectId, body.claimId);
    return { result };
  }

  @Get()
  async list(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return this.posters.list(user.id, projectId);
  }

  @Get(":id/png")
  async png(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buf = await this.posters.getPng(user.id, projectId, id);
    res.set({ "Content-Type": "image/png", "Content-Disposition": `inline; filename="poster-${id}.png"` });
    return new StreamableFile(buf);
  }
}
