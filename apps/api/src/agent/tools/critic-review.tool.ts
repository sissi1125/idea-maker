/**
 * critic_review tool — feat-300.2 Phase 3.5
 *
 * LLM-as-judge：对 draft 按 4 个维度打分，决定是否通过。是 ReAct 中
 * generate→critic→refine 自我修正循环的关键一环。
 *
 * 4 个维度（与 feat-300.5 离线 eval suite 共享同一套打分体系，保证一致性）：
 *   faithfulness   忠实度：草稿声明的事实是否被 evidence 支持
 *   completeness   完整度：是否覆盖了 task 要求的关键点
 *   style          风格：是否符合 memory/platform 偏好
 *   safety         安全/合规：是否违反 platform_rules 的硬约束
 *
 * 注入的"评判标准"：
 *   - platformRules：来自 agent runner（feat-300.3）从 platform_rules 表读
 *   - memoryPreferences：来自 MemoryReader（feat-300.4）
 *   本期 tool factory 接受这两个作为构造参数，AgentToolsService 暂传空数组占位；
 *   AgentRunner 落地后改成动态加载。
 *
 * 为什么用 generateObject 而不是手解 generateText：
 *   - judge 输出必须严格结构化（前端 / runtime eval / 后续 refine 决策都依赖）
 *   - ai-sdk generateObject 内置 JSON schema 校验 + 重试，比手写 try/parse 健壮
 *
 * 为什么 temperature 默认 0：
 *   - judge 决策需要稳定可复现，避免同一 draft 多次打分波动
 *   - 与 generate_draft 默认 0.7 形成对比（generation 要发散，eval 要收敛）
 */

import { tool } from "ai";
import { z } from "zod";
import { generateObject } from "ai";
import type { AgentToolContext, AgentToolFactory } from "./types";
import {
  criticReviewSystemPrompt,
  criticReviewUserPrompt,
} from "../prompts/tools/critic-review.prompt";

/**
 * 评判标准。本期 AgentToolsService 传空数组占位；feat-300.3/300.4 接 AgentRunner 时动态注入。
 */
export interface CriticCriteria {
  /** platform_rules.config 摘要：硬约束（字数 / 禁词 / 必含标签） */
  platformRules: string[];
  /** agent_memory.content 列表：用户偏好（风格 / 受众 / 禁忌） */
  memoryPreferences: string[];
  /** 通过线，0-5 分，默认 3.5（任一维度低于此值判 fail） */
  passThreshold?: number;
}

const ParamsSchema = z.object({
  draft: z.string().min(1).describe("待评审的草稿"),
  task: z.string().min(1).describe("原始 task 描述（用于判 completeness）"),
  evidence: z
    .array(z.object({ source: z.string(), text: z.string() }))
    .optional()
    .describe("draft 引用的 evidence（用于判 faithfulness）"),
});

const DESCRIPTION = `对一份 draft 按 4 个维度（faithfulness/completeness/style/safety）打分并给出修改建议。

什么时候调用：
- generate_draft 出稿后想自评再决定要不要 refine
- 用户问"质量怎么样 / 帮我看看哪里不好"
- 多版本对比时用同一标准评分

什么时候不要调：
- 已经有最新评分且 draft 没改 → 别重复打分
- draft 还在反复改 → 等稳定后再评

返回：{ scores: { faithfulness, completeness, style, safety }, passed, suggestions[] }。
passed=false 时 agent 应该用 suggestions 调 refine_draft。`;

/** LLM 输出 schema：4 维分数 + 通过标记 + 建议列表 */
const JudgeOutputSchema = z.object({
  faithfulness: z.number().min(0).max(5).describe("0-5 分，draft 声明是否被 evidence 支持"),
  completeness: z.number().min(0).max(5).describe("0-5 分，是否覆盖 task 关键点"),
  style: z.number().min(0).max(5).describe("0-5 分，是否符合风格偏好"),
  safety: z.number().min(0).max(5).describe("0-5 分，是否违反硬约束"),
  /** 命中违规时简短说明（被记录在 trace 里供 distill 用） */
  violations: z
    .array(z.string())
    .describe("命中的硬约束违规列表；若无空数组"),
  /** 给 refine 的具体建议，不要泛泛而谈 */
  suggestions: z
    .array(z.string())
    .describe("修改建议列表，每条要具体可执行；草稿优秀时空数组"),
});

export function buildCriticReviewTool(criteria: CriticCriteria): AgentToolFactory {
  return (ctx: AgentToolContext) =>
    tool({
      description: DESCRIPTION,
      parameters: ParamsSchema,
      execute: async ({ draft, task, evidence }) => {
        const passThreshold = criteria.passThreshold ?? 3.5;

        // System + user prompt 走 prompts/ 集中管理。这是与 feat-300.5 离线 eval
        // 共享的唯一一份打分规则——修改时必须 bump version 并同步评估前后 trace。
        const system = criticReviewSystemPrompt.render({
          platformRules: criteria.platformRules,
          memoryPreferences: criteria.memoryPreferences,
        });
        const prompt = criticReviewUserPrompt.render({
          task,
          draft,
          evidence: evidence ?? [],
        });

        const result = await generateObject({
          model: ctx.llmModel,
          system,
          prompt,
          schema: JudgeOutputSchema,
          temperature: 0,
        });

        const scores = {
          faithfulness: result.object.faithfulness,
          completeness: result.object.completeness,
          style: result.object.style,
          safety: result.object.safety,
        };
        // pass 规则：safety 0 直接 fail（硬约束 trumps all），其他维度全部 >= 阈值
        const passed =
          scores.safety >= passThreshold &&
          scores.faithfulness >= passThreshold &&
          scores.completeness >= passThreshold &&
          scores.style >= passThreshold;

        return {
          status: "ok" as const,
          scores,
          passed,
          violations: result.object.violations,
          suggestions: result.object.suggestions,
          promptIds: [criticReviewSystemPrompt.id, criticReviewUserPrompt.id],
          promptVersions: [criticReviewSystemPrompt.version, criticReviewUserPrompt.version],
          usage: {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
          },
        };
      },
    });
}
