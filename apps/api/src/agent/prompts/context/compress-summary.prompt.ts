/**
 * ContextManager 的"早期对话压缩成摘要" prompt。
 *
 * 触发场景：messages 数组超过 token 阈值（默认 8000）或轮次阈值（默认 12 轮），
 * 把最早的 N 条（保留最近 6 轮不动）丢给 LLM 总结成自然语言段落。
 *
 * 设计要点：
 *   - 显式要求"以第三人称视角"——避免摘要写成"我之前说...你回答..."搅混当前会话身份
 *   - 强调"保留 evidence 引用 ID"——LLM 要在后续轮次里继续用 [evidence-N]，引用链不能断
 *   - 输出长度 200-400 字硬约束——再长就失去压缩意义，再短信息不够
 *
 * temperature 在 ContextManager 调用时统一传 0（不允许发散），与 critic 同思路。
 */

import { definePrompt } from "../types";

export interface CompressSummarySystemInput {
  /** 摘要的目标语言；当前固定中文，预留 i18n */
  _reserved?: never;
}

export interface CompressSummaryUserInput {
  /** 待压缩的轮次拼成的字符串。调用方负责拼接（避免在 prompt 层做 message 格式化逻辑） */
  earlyTurns: string;
  /** 待压缩的轮次数，让 LLM 知道这是从 N 轮浓缩 */
  turnCount: number;
}

export const compressSummarySystemPrompt = definePrompt<CompressSummarySystemInput>({
  id: "context.compress_summary.system",
  version: "v1",
  description: "ContextManager 把早期对话压缩成摘要的 system prompt",
  render: () => `你是对话摘要助手。任务：把一段多轮对话压缩成简洁的第三人称摘要，供后续 agent 参考。

要求：
1) 用第三人称（"用户问了 X，助手用 tool Y 给出了 Z"），不要写"我...你..."
2) 保留所有 evidence 引用编号（[evidence-N]），后续轮次会继续用
3) 保留关键决策（用户改变需求、明确否定某选项等）
4) 长度 200-400 字
5) 用中文，纯文本，不用 markdown 标题`,
});

export const compressSummaryUserPrompt = definePrompt<CompressSummaryUserInput>({
  id: "context.compress_summary.user",
  version: "v1",
  description: "ContextManager 压缩 user prompt：包含原始 N 轮对话",
  render: ({ earlyTurns, turnCount }) => `以下是早期 ${turnCount} 轮对话，请压缩成 200-400 字的摘要：

${earlyTurns}

请输出摘要。`,
});
