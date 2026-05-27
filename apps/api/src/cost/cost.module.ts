/**
 * CostModule — feat-200.4 Week 4
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CostController } from "./cost.controller";
import { CostService } from "./cost.service";

@Module({
  imports: [AuthModule],
  providers: [CostService],
  controllers: [CostController],
  exports: [CostService],
})
export class CostModule {}
