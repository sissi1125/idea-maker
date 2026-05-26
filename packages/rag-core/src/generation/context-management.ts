/**
 * RAG Pipeline Stage - Context Management - 纯算法 + LLM 注入
 *
 * 2 method：
 *   session-history   规则消解：用上轮 user 末尾名词替换代词
 *   llm-disambiguate  注入 LLMChatClient，让 LLM 改写消息为独立查询
 *
 * 用途：多轮对话场景把"它的定价怎么样"还原为"产品 X 的定价怎么样"，
 * 让下游检索能命中。
 */

import type {
  ContextManagementInput,
  ContextManagementOutput,
  ContextManagementResult,
  ConversationTurn,
  LLMChatClient,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

// ─── 规则消解 ─────────────────────────────────────────────────────────────────

const PRONOUN_PATTERNS = [
  /\b(it|this|that|these|those)\b/gi,
  /[这那]个?(?:产品|功能|特性|服务)?/g,
  /[它他她](?:的)?/g,
  /该(?:产品|功能|服务)/g,
  /此(?:功能)?/g,
];

function extractLastNoun(text: string): string {
  const cleaned = text.replace(/[？！。，、；：""''【】（）\?!,.:;()\n]/g, " ").trim();
  const segments = cleaned.split(/\s+/).filter((s) => s.length >= 2);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].length >= 2) return segments[i];
  }
  return segments[segments.length - 1] ?? "";
}

function disambiguateByRule(
  currentMessage: string,
  history: ConversationTurn[],
): ContextManagementOutput {
  const warnings: string[] = [];

  if (history.length === 0) {
    return {
      originalMessage: currentMessage,
      query: currentMessage,
      wasDisambiguated: false,
      sessionHistory: [{ role: "user", content: currentMessage }],
      warnings,
    };
  }

  const lastUserTurn = [...history].reverse().find((t) => t.role === "user");
  const anchor = lastUserTurn ? extractLastNoun(lastUserTurn.content) : "";

  let disambiguated = currentMessage;
  let wasDisambiguated = false;

  if (anchor) {
    for (const pattern of PRONOUN_PATTERNS) {
      const replaced = disambiguated.replace(pattern, anchor);
      if (replaced !== disambiguated) {
        disambiguated = replaced;
        wasDisambiguated = true;
      }
    }
  }

  if (!wasDisambiguated) {
    warnings.push("未检测到明显代词，query 与原始消息相同");
  }

  return {
    originalMessage: currentMessage,
    query: disambiguated,
    wasDisambiguated,
    sessionHistory: [...history, { role: "user", content: currentMessage }],
    warnings,
  };
}

// ─── LLM 消解 ─────────────────────────────────────────────────────────────────

async function disambiguateByLLM(
  currentMessage: string,
  history: ConversationTurn[],
  model: string,
  client: LLMChatClient,
): Promise<ContextManagementOutput> {
  const historyText = history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.content}`)
    .join("\n");

  const systemPrompt = `你是一个对话消歧助手。
给定对话历史和最新用户消息，将最新消息改写为一个独立完整的查询（消解所有代词和省略），使其脱离上下文也能理解。
若无需改写，原样返回。只输出改写后的查询，不要解释。`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `对话历史：\n${historyText || "（无历史）"}\n\n最新消息：${currentMessage}` },
    ],
  });

  const disambiguated = resp.choices[0]?.message?.content?.trim() ?? currentMessage;
  const wasDisambiguated = disambiguated !== currentMessage;

  return {
    originalMessage: currentMessage,
    query: disambiguated,
    wasDisambiguated,
    sessionHistory: [...history, { role: "user", content: currentMessage }],
    warnings: [],
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runContextManagement(
  input: ContextManagementInput,
): Promise<ContextManagementResult> {
  const { methodId, params, llmClient } = input;
  const currentMessage = params.currentMessage.trim();
  if (!currentMessage) {
    throw new PipelineError("empty_message", "currentMessage 不能为空");
  }

  let output: ContextManagementOutput;

  switch (methodId) {
    case "llm-disambiguate":
      if (!llmClient) {
        throw new PipelineError(
          "missing_client",
          "llm-disambiguate 需要注入 LLMChatClient；路由层应调 createLLMClient 后传入",
        );
      }
      output = await disambiguateByLLM(currentMessage, params.history, params.model, llmClient);
      break;
    case "session-history":
    default:
      output = disambiguateByRule(currentMessage, params.history);
      break;
  }

  return {
    output,
    trace: {
      methodId,
      wasDisambiguated: output.wasDisambiguated,
      historyTurns: params.history.length,
    },
    warnings: output.warnings,
  };
}
