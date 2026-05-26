/**
 * JwtAuthGuard — feat-200.1 Week 1
 *
 * 提取 Authorization: Bearer <token> → 验签 → 把 { id, email } 写入 req.user。
 * 后续 controller 通过 @CurrentUser() 装饰器读出。
 *
 * 为什么不用 @nestjs/passport：
 *   - passport 在 NestJS 里需要装 strategy + 模块连接，配置噪声大
 *   - JWT verify 本身一行代码，AuthService 已封好；guard 只是个胶水
 *   - 保持依赖最少（MVP 原则）
 */

import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import type { RequestUser } from "./auth.types";

interface AuthedRequest extends Request {
  user?: RequestUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      throw new UnauthorizedException("缺少或格式错误的 Authorization 头");
    }
    const payload = this.auth.verifyToken(match[1]);
    req.user = { id: payload.sub, email: payload.email };
    return true;
  }
}

/**
 * @CurrentUser() 装饰器：从 req.user 取 RequestUser。
 * 用法：
 *   @Get("me")
 *   me(@CurrentUser() user: RequestUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.user;
  },
);
