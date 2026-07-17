/**
 * generate_draft tool — feat-300.2 Phase 3.5
 *
 * 让 agent 在服务端 Confirmed Product Brief Grounding 的基础上生成草稿。用 ai-sdk generateText
 * 调当前 run 的 LanguageModelV1（来自 LlmService.create）。
 *
 * 为什么不直接委托 rag-core runGeneration：
 *   - runGeneration 设计是给老 pipeline 用的：需要 PromptBuildOutput 作 upstream
 *     + 老 OpenAI 形态的 LLMChatClient。在 agent 上下文里这两样都不自然存在。
 *   - tool 参数中的 evidence 可能被 outer Agent 漏传或污染，因此正式生成只读取
 *     AgentRunner 在服务端构造的 Grounding Context。
 *   - 真正能复用的是 rag-core 的"prompt 模板 IP"——本期未抽离，作为 TODO。
 *     feat-300.4 之后把 rag-core/generation 里的 system/user prompt template 抽
 *     成纯函数，generate_draft 改成调那些模板再走 ai-sdk，就完成完整委托。
 *
 * 现状是"半委托"：rag-core 的 generation 逻辑保留供老 pipeline 跑双跑模式；
 * agent 走这条更轻的路径，便于和 ReAct 循环融合。
 */

import { tool } from "ai";
import { z } from "zod";
import { generateText } from "ai";
import type { AgentToolContext, AgentToolFactory } from "./types";
import {
  generateDraftSystemPrompt,
  generateDraftUserPrompt,
} from "../prompts/tools/generate-draft.prompt";
import { buildServerGroundingEvidence } from "../grounding/agent-grounding-format";
import { hasConfirmedProductFacts } from "../grounding/agent-grounding.types";
import {
  groundingBlockReasons,
  removeConfiguredBannedKeywords,
  validateGroundedDraft,
} from "../grounding/agent-grounding-validation";

const ParamsSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe("想生成什么。如：'为当前产品写一段 80 字的小红书介绍'"),
  constraints: z
    .string()
    .optional()
    .describe("硬约束（字数 / 风格 / 必含关键词等），可来自 platform_rules"),
  /** 0-2 之间；critic 等需要保守输出时用低值，brainstorm 用高值 */
  temperature: z.number().min(0).max(2).optional(),
});

const DESCRIPTION = `根据服务端 Confirmed Product Brief Grounding 和 task 描述生成草稿文案。

什么时候调用：
- 当前项目已有 Confirmed Product Brief
- 用户明确要"生成 / 写一段 / 起草"

什么时候不要调：
- Product Brief 不完整时 → 提示用户先确认 Brief，不要自行补事实
- 已经有草稿了 → 用 refine_draft 改

返回：通过时 { status: "ok", draft, citedSources[] }。事实/引用失败时只返回 blocked 原因；
仅平台规则失败且事实已通过时额外返回 candidateDraft，供 refine_draft 定向修订，不能直接交付。`;

export const buildGenerateDraftTool: AgentToolFactory = (ctx: AgentToolContext) =>
  tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ task, constraints, temperature }) => {
      // outer Agent 可能漏传 evidence；服务端 Grounding 才是不可删除的事实输入。
      if (!hasConfirmedProductFacts(ctx.grounding)) {
        return {
          status: "insufficient_context" as const,
          message: "产品信息不足：请先确认 Product Brief 后再生成内容。",
        };
      }
      const serverEvidence = buildServerGroundingEvidence(ctx.grounding);
      const system = generateDraftSystemPrompt.render({ grounding: ctx.grounding });
      const prompt = generateDraftUserPrompt.render({
        task,
        evidence: serverEvidence,
        constraints,
      });

      const result = await generateText({
        model: ctx.llmModel,
        system,
        prompt,
        // Grounded 营销生成优先稳定遵循事实与规则，默认温度从 0.7 收敛到 0.4。
        temperature: temperature ?? 0.4,
      });

      let draftText = result.text;
      let validation = validateGroundedDraft(draftText, ctx.grounding);
      let removedKeywords: string[] = [];
      if (
        !validation.citationMissing &&
        validation.unsupportedHardFacts.length === 0 &&
        validation.ruleViolations.length > 0 &&
        validation.ruleViolations.every((violation) => violation.type === "banned_keyword")
      ) {
        const normalized = removeConfiguredBannedKeywords(draftText, ctx.grounding);
        draftText = normalized.text;
        removedKeywords = normalized.removedKeywords;
        validation = validateGroundedDraft(draftText, ctx.grounding);
      }
      if (!validation.passed) {
        // 只有平台表达违规时，正文的事实与引用已经通过，可安全交给 refine 修订。
        // 缺引用或含无依据硬事实时仍隐藏正文，防止 outer Agent 直接复制幻觉内容。
        const factsPassed =
          !validation.citationMissing && validation.unsupportedHardFacts.length === 0;
        return {
          status: "blocked" as const,
          reasons: groundingBlockReasons(validation),
          ...(factsPassed && validation.ruleViolations.length > 0
            ? { candidateDraft: draftText, nextAction: "调用 refine_draft 修复平台违规" }
            : {}),
          citedSources: validation.citedSources,
          unsupportedHardFacts: validation.unsupportedHardFacts,
          ruleViolations: validation.ruleViolations,
          promptIds: [generateDraftSystemPrompt.id, generateDraftUserPrompt.id],
          promptVersions: [generateDraftSystemPrompt.version, generateDraftUserPrompt.version],
          usage: {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
          },
        };
      }

      return {
        status: "ok" as const,
        draft: draftText,
        citedSources: validation.citedSources,
        ...(removedKeywords.length > 0 ? { normalizations: { removedKeywords } } : {}),
        // 记 prompt 版本号给 agent_steps trace，便于回放调试
        promptIds: [generateDraftSystemPrompt.id, generateDraftUserPrompt.id],
        promptVersions: [generateDraftSystemPrompt.version, generateDraftUserPrompt.version],
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        },
      };
    },
  });
