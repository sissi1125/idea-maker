/**
 * DbModule — feat-200.1 Week 1
 *
 * 把 DbService 标记为 Global，让 AuthModule / ProjectsModule 等不需要重复 import。
 * 这是 NestJS 的常规做法：基础设施 module（pg / redis / cache）标 @Global() 简化 DI。
 */

import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";

@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
