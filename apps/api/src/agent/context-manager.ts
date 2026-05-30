/**
 * ContextManager — feat-300.3 任务 2
 *
 * 处理 multi-turn 对话 messages 数组持续增长可能爆 context window 的问题。
 * 详细设计见 docs/agent/ARCHITECTURE.md §C 和 feat-300.3-plan.md §3.7。
 *
 * 两层策略：
 *   1. 滑动窗口：保留最近 KEEP_RECENT_TURNS 轮完整 messages
 *   2. 摘要压缩：窗口外的早期轮次 → 调 LLM 总结成自然语言段落，注入 system prompt
 *
 * **触发时机**（AgentRunner 在每轮 ReAct 入口调 shouldCompress）：
 *   - token 估算 > TOKEN_THRESHOLD（默认 8000）
 *   - OR messages 数 > MESSAGE_COUNT_THRESHOLD（默认 12 条）
 *   任一满足触发压缩。OR 而非 AND 是为防"少量超长 messages"和"大量短 messages"
 *   两种边界都失控。
 *
 * **与 Memory（L2）的区别**（面试考点）：
 *   ContextManager 处理"本次会话内"的工作记忆；Memory 是"跨会话"的长期偏好。
 *
 * **Token 估算**：字符近似（feat-300.3 plan 决策）。中文 1.5、英文 4 字符/token。
 * 10% 误差对触发阈值判断无影响。
 */

import { Logger } from "@nestjs/common";
import { generateText, type LanguageModelV1 } from "ai";
import type { ChatMessage } from "./agent.types";
import {
  compressSummarySystemPrompt,
  compressSummaryUserPrompt,
} from "./prompts/context/compress-summary.prompt";

/** Token 估算 + 压缩触发阈值 */
export const TOKEN_THRESHOLD = 8000;
export const MESSAGE_COUNT_THRESHOLD = 12;

/** 滑动窗口保留的最近轮次数（user + assistant 算两轮） */
export const KEEP_RECENT_TURNS = 6;

export interface CompressResult {
  /** LLM 总结出的早期对话摘要 */
  summary: string;
  /** 保留下来的近期 messages（用作新的 messages 数组继续 ReAct） */
  trimmedMessages: ChatMessage[];
  /** 本次压缩消耗 token，给 CostTracker 累计 */
  usage: { promptTokens: number; completionTokens: number };
  /** 被压缩进摘要的轮次数（trace 里记录便于回放） */
  compressedTurnCount: number;
}

export class ContextManager {
  private readonly logger = new Logger(ContextManager.name);

  /**
   * 估算 messages 数组 token 数。
   *
   * 中文按 1.5 字符/token，英文按 4 字符/token，二者用字符分类计算。
   * 实测对智谱/OpenAI 系列模型偏差 < 10%，对 budget 触发判断够用。
   *
   * 不依赖 tiktoken 包：5MB 二进制依赖 + 国产模型不准，性价比低。
   */
  estimateTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const m of messages) {
      total += this.estimateContentTokens(m.content);
      // role 字段 + 框架开销固定加 4 token/条
      total += 4;
    }
    return total;
  }

  private estimateContentTokens(text: string): number {
    let chinese = 0;
    let other = 0;
    for (const ch of text) {
      // 简化判定：CJK Unified Ideographs + 全角标点 + 假名 算"中文字符"
      if (/[一-鿿　-〿＀-￯぀-ヿ]/.test(ch)) {
        chinese++;
      } else {
        other++;
      }
    }
    return Math.ceil(chinese / 1.5 + other / 4);
  }

  /** 判断是否触发压缩。OR 语义：token 超 或 轮数超。 */
  shouldCompress(messages: ChatMessage[]): boolean {
    if (messages.length > MESSAGE_COUNT_THRESHOLD) return true;
    if (this.estimateTokens(messages) > TOKEN_THRESHOLD) return true;
    return false;
  }

  /**
   * 调 LLM 压缩窗口外的早期 messages 为自然语言摘要。
   *
   * 保留最近 KEEP_RECENT_TURNS 轮不动（不论 token 数）。
   * 早期部分序列化成"role: content"格式喂给 LLM，让其按 compressSummaryPrompt
   * 输出第三人称摘要。
   *
   * **temperature=0**：压缩需稳定可复现，多次跑相同 messages 不应得到不同摘要。
   *
   * 容错：如果 messages.length <= KEEP_RECENT_TURNS，直接返回原数组 + 空摘要，
   * 不触发 LLM 调用。
   */
  async compress(messages: ChatMessage[], model: LanguageModelV1): Promise<CompressResult> {
    if (messages.length <= KEEP_RECENT_TURNS) {
      return {
        summary: "",
        trimmedMessages: messages,
        usage: { promptTokens: 0, completionTokens: 0 },
        compressedTurnCount: 0,
      };
    }

    const splitAt = messages.length - KEEP_RECENT_TURNS;
    const toCompress = messages.slice(0, splitAt);
    const kept = messages.slice(splitAt);

    const earlyTurns = toCompress
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const system = compressSummarySystemPrompt.render({});
    const prompt = compressSummaryUserPrompt.render({
      earlyTurns,
      turnCount: toCompress.length,
    });

    this.logger.debug(
      `ContextManager.compress: compressing ${toCompress.length} early turns, keeping ${kept.length} recent`,
    );

    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0,
    });

    return {
      summary: result.text.trim(),
      trimmedMessages: kept,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
      },
      compressedTurnCount: toCompress.length,
    };
  }

  /**
   * 把压缩出的摘要追加到 system prompt 末尾。
   *
   * 与 agentSystemPrompt composer 配合：composer 已经支持 contextSummary 字段，
   * AgentRunner 直接传给 composer 即可。本方法用于"已构造好 system prompt 字符串
   * 后再注入摘要"的场景（少数边界用法）。
   */
  inject(systemPrompt: string, summary: string): string {
    if (!summary.trim()) return systemPrompt;
    return `${systemPrompt}\n\n[早期对话摘要]\n${summary.trim()}`;
  }
}
