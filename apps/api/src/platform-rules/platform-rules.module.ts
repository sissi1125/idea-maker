/**
 * PlatformRulesModule — feat-200.8 Week 8
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlatformRulesController } from "./platform-rules.controller";
import { PlatformRulesService } from "./platform-rules.service";

@Module({
  imports: [AuthModule],
  controllers: [PlatformRulesController],
  providers: [PlatformRulesService],
  exports: [PlatformRulesService],
})
export class PlatformRulesModule {}
