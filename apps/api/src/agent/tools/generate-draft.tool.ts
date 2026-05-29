/**
 * generate_draft tool — feat-300.2 Phase 3.5
 *
 * 让 agent 在已有 evidence/context 的基础上生成草稿。用 ai-sdk generateText
 * 调当前 run 的 LanguageModelV1（来自 LlmService.create）。
 *
 * 为什么不直接委托 rag-core runGeneration：
 *   - runGeneration 设计是给老 pipeline 用的：需要 PromptBuildOutput 作 upstream
 *     + 老 OpenAI 形态的 LLMChatClient。在 agent 上下文里这两样都不自然存在。
 *   - agent 视角：调 generate_draft 时它已经通过 search_kb / search_web 拿到了
 *     evidence，并写在自己的 messages 里。再过一遍 prompt-build 是重复工作。
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

const EvidenceSchema = z.object({
  source: z.string().describe("出处标识，如 chunkId / url / noteId"),
  text: z.string().describe("evidence 原文片段"),
});

const ParamsSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe("想生成什么。如：'写一段 80 字的小红书种草文案，主推护肤功效'"),
  evidence: z
    .array(EvidenceSchema)
    .optional()
    .describe("引用的证据片段（来自 search_kb / search_web / search_notes）"),
  constraints: z
    .string()
    .optional()
    .describe("硬约束（字数 / 风格 / 必含关键词等），可来自 platform_rules"),
  /** 0-2 之间；critic 等需要保守输出时用低值，brainstorm 用高值 */
  temperature: z.number().min(0).max(2).optional(),
});

const DESCRIPTION = `根据已收集的 evidence 和 task 描述生成草稿文案。

什么时候调用：
- 已经通过 search_* 工具拿到足够 evidence
- 用户明确要"生成 / 写一段 / 起草"

什么时候不要调：
- evidence 不足时 → 先调 search_* 补足
- 已经有草稿了 → 用 refine_draft 改

返回：{ draft, citedSources[] }。citedSources 是 LLM 在文本里出现过的 source 标识，
方便后续 critic_review 校验"是否真的有依据"。`;

/**
 * 把 evidence 列表拼成可读 evidence 块，供 prompt 引用。
 * 用 [source:xxx] 形式让 LLM 学到"在生成中标注引用"。
 */
function formatEvidence(evidence: { source: string; text: string }[] | undefined): string {
  if (!evidence || evidence.length === 0) return "(无具体 evidence，请基于通用知识生成)";
  return evidence
    .map((e, i) => `[evidence-${i + 1}, source:${e.source}]\n${e.text}`)
    .join("\n\n");
}

export const buildGenerateDraftTool: AgentToolFactory = (ctx: AgentToolContext) =>
  tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ task, evidence, constraints, temperature }) => {
      const evidenceText = formatEvidence(evidence);
      const constraintsLine = constraints?.trim()
        ? `\n\n硬约束（必须满足）：${constraints.trim()}`
        : "";

      // System prompt：声明角色 + 引用规范。Memory/platform_rules 的注入在
      // AgentRunner 的 system prompt 里完成，tool 这里不重复注入，避免污染。
      const system = `你是营销文案/产品笔记的撰写助手。你的回答必须：
1) 严格基于提供的 evidence；如果 evidence 不足以支持某个论点，必须明确说明"无足够依据"。
2) 在引用 evidence 时用形如 [evidence-N] 的内联标记。
3) 用简洁、地道的中文，避免口水话；不要 emoji 除非用户明确要求。`;

      const prompt = `任务：${task}${constraintsLine}

可用的 evidence：
${evidenceText}

请输出草稿。`;

      const result = await generateText({
        model: ctx.llmModel,
        system,
        prompt,
        temperature: temperature ?? 0.7,
      });

      // 简单的 cited source 抽取：扫文本里出现的 [evidence-N] 索引，回查 source
      const citedSources = extractCitedSources(result.text, evidence ?? []);

      return {
        status: "ok" as const,
        draft: result.text,
        citedSources,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        },
      };
    },
  });

/**
 * 抽取草稿里实际引用了哪些 evidence。用于：
 *   - 反馈给 agent："你引用了 3 个 evidence 但准备了 5 个"
 *   - 给 critic_review 做 faithfulness 判断
 */
function extractCitedSources(
  draft: string,
  evidence: { source: string; text: string }[],
): string[] {
  const matches = draft.matchAll(/\[evidence-(\d+)\]/g);
  const indices = new Set<number>();
  for (const m of matches) indices.add(parseInt(m[1], 10));
  return Array.from(indices)
    .filter((i) => i >= 1 && i <= evidence.length)
    .map((i) => evidence[i - 1].source);
}
