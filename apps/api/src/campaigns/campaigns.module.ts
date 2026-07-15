/**
 * CampaignsModule — feat-400.4
 *
 * LlmModule 是 @Global，直接注入 LlmService。硬规则检查/决策复用 content-evaluation 的纯函数。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentEvaluationModule } from "../content-evaluation/content-evaluation.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  imports: [AuthModule, ContentEvaluationModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
