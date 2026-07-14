/**
 * SourcesModule — feat-400.1 slice 4
 *
 * 受限官网导入。导出 SourcesService 供 ProductBriefExtractor 读取官网正文分片
 * （作为 website 来源的候选事实 evidence）。
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AssetsModule } from "../assets/assets.module";
import { SourcesController } from "./sources.controller";
import { SourcesService } from "./sources.service";

@Module({
  imports: [AuthModule, AssetsModule],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
