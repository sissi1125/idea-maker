/**
 * AssetsController — feat-400.5
 *
 *   POST   /projects/:projectId/assets            上传（multipart，字段名 file；body: kind,label）
 *   GET    /projects/:projectId/assets            列表
 *   POST   /projects/:projectId/assets/:id/approve  批准（海报只能用已批准资产）
 */

import {
  BadRequestException, Body, Controller, Get, Param, Post, Res, StreamableFile, UploadedFile,
  UseGuards, UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { AssetsService, ASSET_KINDS, type AssetKind } from "./assets.service";

class UploadAssetDto {
  @IsString() @IsIn([...ASSET_KINDS]) kind!: AssetKind;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
}

@ApiTags("assets")
@ApiBearerAuth()
@Controller("projects/:projectId/assets")
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadAssetDto,
  ) {
    if (!file) throw new BadRequestException("缺少文件（字段名 file）");
    if (!body?.kind) throw new BadRequestException("缺少 kind");
    const asset = await this.assets.upload(user.id, projectId, {
      kind: body.kind,
      label: body.label,
      fileName: file.originalname,
      mime: file.mimetype,
      buffer: file.buffer,
    });
    return { asset };
  }

  @Get()
  async list(@CurrentUser() user: RequestUser, @Param("projectId") projectId: string) {
    return { assets: await this.assets.list(user.id, projectId) };
  }

  @Post(":id/approve")
  async approve(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    return { asset: await this.assets.approve(user.id, projectId, id) };
  }

  /** 资产图片字节（前端缩略图） */
  @Get(":id/file")
  async file(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, mime } = await this.assets.getFile(user.id, projectId, id);
    res.set({ "Content-Type": mime });
    return new StreamableFile(buffer);
  }
}
