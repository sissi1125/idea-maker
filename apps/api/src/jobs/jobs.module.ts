/**
 * JobsModule — 通用异步任务。@Global 让各业务模块直接注入 JobsService。
 */

import { Global, Module } from "@nestjs/common";
import { JobsService } from "./jobs.service";

@Global()
@Module({
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
