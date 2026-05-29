/**
 * LlmModule — feat-300.1 Phase 3.5
 *
 * 把 LlmService + TavilyClient 暴露成可注入的 provider，供后续 AgentModule /
 * MemoryModule / EvalModule 复用。无 controller——它是底座，不直接对外。
 *
 * 标 @Global() 让所有业务模块无需在 imports 显式声明就能注入，避免 8 个 tool
 * 文件每个都要 import LlmModule 的样板。
 */

import { Global, Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { TavilyClient } from "./tavily.client";

@Global()
@Module({
  providers: [LlmService, TavilyClient],
  exports: [LlmService, TavilyClient],
})
export class LlmModule {}
