/**
 * AgentRunner 的完整 system prompt 组合器。
 *
 * 把 base + memory + platform rules + 早期摘要按固定顺序拼接，
 * 保证不同 run 之间结构稳定（trace 上看哪段在哪个位置是确定的）。
 *
 * 顺序（从上到下，越靠前 LLM 注意力越高）：
 *   1. base（角色、工作流偏好、引用规范）
 *   2. memory（用户长期偏好，跨 session）
 *   3. platform rules（硬约束，跨 session）
 *   4. 早期对话摘要（本 session 的工作记忆，由 ContextManager 在压缩时填）
 *
 * 为什么 early summary 放最后：它是"短期上下文"，离 user 当前消息最近的位置
 * 让 LLM 更容易关联。base/memory/rules 是稳定 framing，放前面。
 */

import { definePrompt } from "../types";
import {
  agentBaseSystemPrompt,
  type AgentBaseSystemInput,
} from "./agent-base.prompt";
import {
  memoryInjectionPrompt,
  type MemoryEntry,
} from "./memory-injection.prompt";
import {
  platformRulesInjectionPrompt,
  type PlatformRule,
} from "./platform-rules-injection.prompt";
import {
  projectKnowledgeInjectionPrompt,
  type ProjectKnowledgeEntry,
} from "./project-knowledge-injection.prompt";

export interface AgentSystemPromptInput extends AgentBaseSystemInput {
  memory: MemoryEntry[];
  platformRules: PlatformRule[];
  /**
   * 项目级 auto-gen 摘要（产品介绍 / 竞品分析）——v1.0 优化项 3
   * 让 agent 第一轮就有"项目整体认知"，不必再靠 search_kb 一段段拼凑。
   */
  projectKnowledge?: ProjectKnowledgeEntry[];
  /** ContextManager 压缩历史轮次后产出的摘要；无早期对话则为空 */
  contextSummary?: string;
}

export const agentSystemPrompt = definePrompt<AgentSystemPromptInput>({
  id: "agent.system",
  version: "v1",
  description:
    "AgentRunner 完整 system prompt 组合器：base + memory + platform_rules + 早期摘要",
  render: (input) => {
    const segments = [
      agentBaseSystemPrompt.render({ projectName: input.projectName }),
      // 项目知识快照紧跟 base：让 LLM 一开始就锚定到"这个项目卖什么、和谁竞争"，
      // 后续 memory / rules / 早期摘要都在这个事实基础上叠加
      projectKnowledgeInjectionPrompt.render({ entries: input.projectKnowledge ?? [] }),
      memoryInjectionPrompt.render({ memory: input.memory }),
      platformRulesInjectionPrompt.render({ rules: input.platformRules }),
      input.contextSummary?.trim()
        ? `\n\n[早期对话摘要]\n${input.contextSummary.trim()}`
        : "",
    ];

    // filter(Boolean) 把空字符串过滤掉，避免出现 "\n\n\n\n" 这种丑陋拼接
    return segments.filter(Boolean).join("\n");
  },
});
