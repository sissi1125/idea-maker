/**
 * AuthModule — feat-200.1 Week 1
 *
 * 把 AuthService 和 JwtAuthGuard 暴露给其他模块（ProjectsModule 需要 guard）。
 */

import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Module({
  providers: [AuthService, JwtAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
