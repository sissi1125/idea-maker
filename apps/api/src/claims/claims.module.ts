/**
 * ClaimsModule — feat-400.2
 *
 * Claim Map。导出 ClaimsService 供 content-evaluation 门禁读取"已批准 Claim"。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ClaimsController } from "./claims.controller";
import { ClaimsService } from "./claims.service";

@Module({
  imports: [AuthModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
