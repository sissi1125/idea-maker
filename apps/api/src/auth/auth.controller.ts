/**
 * AuthController — feat-200.1 Week 1
 *
 *   POST /auth/register   { email, password, displayName? }
 *   POST /auth/login      { email, password }
 *   GET  /auth/me         (Bearer token)
 *
 * 校验：用 class-validator (全局 ValidationPipe 已开)。
 * 返回结构：{ user, token } 给前端一次拿全；GET /me 不返 token（前端已有）。
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { CurrentUser, JwtAuthGuard } from "./jwt-auth.guard";
import type { RequestUser } from "./auth.types";

class RegisterDto {
  @IsEmail({}, { message: "email 格式不合法" })
  email!: string;

  // 密码最小 8 位，给"邮箱+密码"账户一个基本门槛（MVP 不强制大小写/数字混合）
  @IsString()
  @MinLength(8, { message: "密码至少 8 位" })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  @HttpCode(201)
  async register(@Body() body: RegisterDto) {
    const user = await this.auth.register(
      body.email,
      body.password,
      body.displayName,
    );
    const token = this.auth.signToken({ id: user.id, email: user.email });
    return { user, token };
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: LoginDto) {
    const user = await this.auth.login(body.email, body.password);
    const token = this.auth.signToken({ id: user.id, email: user.email });
    return { user, token };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: RequestUser) {
    // guard 已保证 user 存在
    const full = await this.auth.findById(user.id);
    if (!full) {
      // 用户被删除但 token 还有效 → 视为 404
      throw new NotFoundException("用户不存在");
    }
    return { user: full };
  }
}
