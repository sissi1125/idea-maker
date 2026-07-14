/**
 * ProductBriefController — feat-400.1
 *
 * 项目级 Product Brief 审核工作台后端：
 *   GET    /projects/:projectId/product-brief                     全景（容器 + 字段 + 问题清单）
 *   POST   /projects/:projectId/product-brief/fields              新增/更新一个候选字段
 *   POST   /projects/:projectId/product-brief/fields/:fieldId/confirm   确认字段
 *   PATCH  /projects/:projectId/product-brief/fields/:fieldId     编辑字段值（事实型需 reason）
 *   POST   /projects/:projectId/product-brief/fields/:fieldId/reject    拒绝字段
 *   POST   /projects/:projectId/product-brief/confirm             确认整份 Brief v(N)
 *
 * 鉴权：JwtAuthGuard 全覆盖；service 层再做 owner 校验。
 * 为什么 confirm/reject 用 POST 而非 PATCH：它们是"产生副作用 + 写审计"的命令，
 *   语义上是动作而非资源部分更新，用 POST 子路径更清晰。
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  Allow,
  IsArray,
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
import { ProductBriefService } from "./product-brief.service";
import { ProductBriefExtractor } from "./product-brief-extractor";
import {
  BRIEF_FIELD_GROUPS,
  BRIEF_FIELD_SOURCES,
  type BriefFieldGroup,
  type BriefFieldSource,
} from "./product-brief.types";

class UpsertFieldDto {
  @IsString() @IsIn([...BRIEF_FIELD_GROUPS]) group!: BriefFieldGroup;
  @IsString() @MaxLength(200) key!: string;
  // value 允许任意 JSON（字符串/数字/对象/数组）。@Allow() 必须加：
  // 全局 ValidationPipe whitelist:true 会把"无装饰器"的字段整段剥掉 → value 变 undefined。
  @Allow() value!: unknown;
  @IsOptional() @IsString() @IsIn([...BRIEF_FIELD_SOURCES]) source?: BriefFieldSource;
  @IsOptional() @IsArray() @IsString({ each: true }) evidenceChunkIds?: string[];
  @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
}

class EditFieldDto {
  @Allow() value!: unknown;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class RejectFieldDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@ApiTags("product-brief")
@ApiBearerAuth()
@Controller("projects/:projectId/product-brief")
@UseGuards(JwtAuthGuard)
export class ProductBriefController {
  constructor(
    private readonly briefs: ProductBriefService,
    private readonly extractor: ProductBriefExtractor,
  ) {}

  /**
   * 从项目文档 LLM 提取候选字段（feat-400.1 slice 2）。
   * POST 因为它是"消耗 LLM token + 写库"的命令；返回提取概要供前端 toast + 刷新工作台。
   */
  @Post("extract")
  async extract(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    const result = await this.extractor.extract(user.id, projectId);
    return { result };
  }

  @Get()
  async get(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    return this.briefs.getBrief(user.id, projectId);
  }

  @Post("fields")
  @HttpCode(201)
  async upsertField(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: UpsertFieldDto,
  ) {
    if (!body) throw new BadRequestException("缺少 body");
    const field = await this.briefs.upsertField(user.id, projectId, body);
    return { field };
  }

  @Post("fields/:fieldId/confirm")
  async confirmField(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("fieldId") fieldId: string,
  ) {
    const field = await this.briefs.confirm(user.id, projectId, fieldId);
    return { field };
  }

  @Patch("fields/:fieldId")
  async editField(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("fieldId") fieldId: string,
    @Body() body: EditFieldDto,
  ) {
    if (!body) throw new BadRequestException("缺少 body");
    const field = await this.briefs.edit(user.id, projectId, fieldId, body);
    return { field };
  }

  @Post("fields/:fieldId/reject")
  async rejectField(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("fieldId") fieldId: string,
    @Body() body: RejectFieldDto,
  ) {
    const field = await this.briefs.reject(user.id, projectId, fieldId, body?.reason);
    return { field };
  }

  @Post("confirm")
  async confirmBrief(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    const brief = await this.briefs.confirmWholeBrief(user.id, projectId);
    return { brief };
  }
}
