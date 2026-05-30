/**
 * AgentModule — feat-300.2 Phase 3.5
 *
 * 暴露 AgentToolsService（8 个 tool 的 factory 工厂）。
 * 依赖 LlmModule（@Global，自动注入 TavilyClient）。
 *
 * feat-300.3 起会在本模块里加 AgentRunnerService / AgentSseController；本期只到 tools 层。
 */

import { Module } from "@nestjs/common";
import { AgentToolsService } from "./agent-tools.service";
import { SpillStorage } from "./spill-storage.service";

@Module({
  providers: [AgentToolsService, SpillStorage],
  exports: [AgentToolsService, SpillStorage],
})
export class AgentModule {}
