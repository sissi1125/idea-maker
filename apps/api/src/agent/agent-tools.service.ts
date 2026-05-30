/**
 * AgentToolsService — feat-300.2 Phase 3.5
 *
 * 把 8 个 tool factory 集中绑定 NestJS 依赖（TavilyClient + 后续的 NotesService 等），
 * 对外暴露 `build(ctx) → ToolSet`，供 AgentRunner（feat-300.3）在每次 run 启动时
 * 实例化绑定该 run 上下文的工具集。
 *
 * 设计要点：
 *   - service 内不持有任何"当前 run"的状态——上下文走 ctx 参数注入，service 是无状态的
 *   - 8 个 tool 中：
 *       * 4 个直接走 ctx（search_kb / search_notes / search_history / log_decision /
 *         generate_draft / refine_draft）
 *       * 2 个需要预先绑定 NestJS 服务（search_web → TavilyClient，
 *         critic_review → 评判标准）
 *   - critic_review 的 criteria 在本期取默认空数组（platformRules / memoryPreferences）；
 *     feat-300.3 接 AgentRunner 后，由 runner 在 build() 调用时按当前 run 读 platform_rules
 *     表和 agent_memory 表填充。当前签名预留 criteria 入参以方便未来切换。
 */

import { Injectable } from "@nestjs/common";
import type { Tool } from "ai";
import { TavilyClient } from "../llm/tavily.client";
import { SpillStorage } from "./spill-storage.service";
import {
  AGENT_TOOL_NAMES,
  type AgentToolContext,
  type AgentToolName,
} from "./tools/types";
import { buildSearchKbTool } from "./tools/search-kb.tool";
import { buildSearchNotesTool } from "./tools/search-notes.tool";
import { buildSearchHistoryTool } from "./tools/search-history.tool";
import { buildSearchWebTool } from "./tools/search-web.tool";
import { buildGenerateDraftTool } from "./tools/generate-draft.tool";
import { buildRefineDraftTool } from "./tools/refine-draft.tool";
import { buildCriticReviewTool, type CriticCriteria } from "./tools/critic-review.tool";
import { buildLogDecisionTool } from "./tools/log-decision.tool";

export type AgentToolSet = Record<AgentToolName, Tool>;

export interface BuildToolsOptions {
  /** critic_review 的评判标准；不传则空数组占位（feat-300.3+ AgentRunner 填充） */
  criticCriteria?: CriticCriteria;
}

@Injectable()
export class AgentToolsService {
  constructor(
    private readonly tavilyClient: TavilyClient,
    private readonly spillStorage: SpillStorage,
  ) {}

  /**
   * 根据 ctx 构造一套绑定该 run 的 8 个 tool。AgentRunner 每次新建 run 时调一次。
   *
   * 为什么不在 module 启动时缓存：tool 闭包绑定了 ctx.pgClient / ctx.llmModel /
   * ctx.runId 等"per-run"实例。缓存会导致 run 之间状态污染。
   */
  build(ctx: AgentToolContext, opts: BuildToolsOptions = {}): AgentToolSet {
    const criteria: CriticCriteria = opts.criticCriteria ?? {
      platformRules: [],
      memoryPreferences: [],
    };

    // 4 个 search tool 都绑定 SpillStorage 闭包（大输出自动落盘）
    return {
      [AGENT_TOOL_NAMES.searchKb]: buildSearchKbTool(this.spillStorage)(ctx),
      [AGENT_TOOL_NAMES.searchNotes]: buildSearchNotesTool(this.spillStorage)(ctx),
      [AGENT_TOOL_NAMES.searchHistory]: buildSearchHistoryTool(this.spillStorage)(ctx),
      [AGENT_TOOL_NAMES.searchWeb]: buildSearchWebTool(this.tavilyClient, this.spillStorage)(ctx),
      [AGENT_TOOL_NAMES.generateDraft]: buildGenerateDraftTool(ctx),
      [AGENT_TOOL_NAMES.refineDraft]: buildRefineDraftTool(ctx),
      [AGENT_TOOL_NAMES.criticReview]: buildCriticReviewTool(criteria)(ctx),
      [AGENT_TOOL_NAMES.logDecision]: buildLogDecisionTool(ctx),
    };
  }
}
