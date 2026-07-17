/**
 * AgentRunner 的完整 system prompt 组合器。
 *
 * 把 base + Product Brief Grounding + memory + platform rules + 早期摘要按固定顺序拼接，
 * 保证不同 run 之间结构稳定（trace 上看哪段在哪个位置是确定的）。
 *
 * 顺序（从上到下，越靠前 LLM 注意力越高）：
 *   1. base（角色、工作流偏好、引用规范）
 *   2. Product Brief Grounding（本 run 的事实裁决层）
 *   3. memory（用户长期偏好，跨 session）
 *   4. platform rules（硬约束，跨 session）
 *   5. 早期对话摘要（本 session 的工作记忆，由 ContextManager 在压缩时填）
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
import { briefGroundingInjectionPrompt } from "./brief-grounding-injection.prompt";
import type { AgentGroundingContext } from "../../grounding/agent-grounding.types";

export interface AgentSystemPromptInput extends AgentBaseSystemInput {
  memory: MemoryEntry[];
  platformRules: PlatformRule[];
  /** Product Brief 是事实裁决层；outer Agent 与 nested tools 必须共享同一份对象。 */
  grounding: AgentGroundingContext;
  /** ContextManager 压缩历史轮次后产出的摘要；无早期对话则为空 */
  contextSummary?: string;
}

export const agentSystemPrompt = definePrompt<AgentSystemPromptInput>({
  id: "agent.system",
  version: "v5",
  description:
    "AgentRunner 完整 system prompt：base + Brief Grounding + memory + platform_rules + 摘要",
  render: (input) => {
    const segments = [
      agentBaseSystemPrompt.render({ projectName: input.projectName }),
      // Product Brief 紧跟 base，优先于偏好和平台表达规则。
      briefGroundingInjectionPrompt.render({ grounding: input.grounding }),
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
