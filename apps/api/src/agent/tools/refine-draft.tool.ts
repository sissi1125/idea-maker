/**
 * refine_draft tool — feat-300.2 Phase 3.5
 *
 * 拿 critic_review 的反馈或用户/自己指出的问题，把 draft 改一遍。
 * 与 generate_draft 共享同一个 llmModel，prompt 形态不同：
 *   generate = 从 0 出 draft
 *   refine   = 接收原稿 + 反馈，输出"按反馈修改后的版本"
 *
 * 为什么单独成 tool 而不是让 generate_draft 接收 previousDraft 参数：
 *   1. 工具语义清晰：agent 通过 tool 名就能知道做什么，description 也更聚焦
 *   2. tool 调用记录里看到 refine 的次数 = 自我修正的次数，是质量指标
 *   3. critic→refine 循环是 ReAct 的标志性 emergent 行为，独立 tool 更好观察
 */

import { tool } from "ai";
import { z } from "zod";
import { generateText } from "ai";
import type { AgentToolContext, AgentToolFactory } from "./types";
import {
  refineDraftSystemPrompt,
  refineDraftUserPrompt,
  type RefineIntensity,
} from "../prompts/tools/refine-draft.prompt";

const ParamsSchema = z.object({
  draft: z.string().min(1).describe("待修改的原稿"),
  feedback: z
    .string()
    .min(1)
    .describe("修改意见。来自 critic_review.suggestions[] 或用户原话或自我反思"),
  /** 修改幅度提示 */
  intensity: z
    .enum(["minor", "moderate", "rewrite"])
    .optional()
    .describe("minor=局部润色 / moderate=结构调整 / rewrite=整体重写。默认 moderate"),
  temperature: z.number().min(0).max(2).optional(),
});

const DESCRIPTION = `按指定 feedback 修改一份已有 draft。

什么时候调用：
- critic_review 返回 passed=false → 用 critic.suggestions 当 feedback
- 用户说"改一下 / 调一下 / 加点 X / 去掉 Y" → 用用户原话当 feedback
- 自我反思觉得草稿哪里不对 → 用反思文字当 feedback

什么时候不要调：
- 没有 draft 时 → 用 generate_draft
- 反复 refine 3 次还没过 → 应该停下来 log_decision 说明原因，或调 search_* 补 evidence

返回：{ revisedDraft, changes }。changes 是 LLM 自评的改动摘要。`;

export const buildRefineDraftTool: AgentToolFactory = (ctx: AgentToolContext) =>
  tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ draft, feedback, intensity, temperature }) => {
      const effectiveIntensity: RefineIntensity = intensity ?? "moderate";
      const system = refineDraftSystemPrompt.render({ intensity: effectiveIntensity });
      const prompt = refineDraftUserPrompt.render({ draft, feedback });

      const result = await generateText({
        model: ctx.llmModel,
        system,
        prompt,
        // refine 默认 temperature 比 generate 低，避免改稿时再随机出新东西
        temperature: temperature ?? 0.4,
      });

      const { revisedDraft, changes } = splitOutput(result.text);

      return {
        status: "ok" as const,
        revisedDraft,
        changes,
        promptIds: [refineDraftSystemPrompt.id, refineDraftUserPrompt.id],
        promptVersions: [refineDraftSystemPrompt.version, refineDraftUserPrompt.version],
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        },
      };
    },
  });

/**
 * 解析 "正文 \n===CHANGES=== \n 一句话总结" 的输出。
 * LLM 不严格遵守时降级：全文当 revisedDraft，changes 为 null。
 */
function splitOutput(text: string): { revisedDraft: string; changes: string | null } {
  const idx = text.indexOf("===CHANGES===");
  if (idx === -1) return { revisedDraft: text.trim(), changes: null };
  return {
    revisedDraft: text.slice(0, idx).trim(),
    changes: text.slice(idx + "===CHANGES===".length).trim() || null,
  };
}
