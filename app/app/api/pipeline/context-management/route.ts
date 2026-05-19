/**
 * RAG Pipeline Stage — Context Management（对话上下文管理）
 *
 * 作用：多轮对话场景下，维护历史消息，执行指代消解与省略补全，
 *       把含省略或代词的问题还原为完整独立的查询，供后续检索使用。
 *
 * Pipeline 位置：
 *   [Context Management] → Intent Recognition → Query Rewrite → Retrieval
 *
 * 触发条件：
 *   conditional 步骤，runtimeContext.isMultiTurn = true 时自动激活，
 *   也可在 PipelineStepList 中手动开启进行测试。
 *
 * 为什么需要指代消解？
 *   用户在多轮对话中常说"它的定价是多少"或"这个怎么用"，
 *   其中"它"和"这个"如果不消解为具体实体，检索时无法命中相关 chunk。
 *
 * 两种方法：
 *
 *   session-history    规则消解：用上轮末尾名词替换代词（it/这/它/该/此）
 *                       速度快，无需 API，适合简单对话流
 *
 *   llm-disambiguate   LLM 消解：给 LLM 对话历史，让它重写最新一轮
 *                       准确率高，适合复杂省略和跨轮指代
 */

import { NextRequest, NextResponse } from "next/server";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ContextManagementOutput {
  /** 原始当前轮消息 */
  originalMessage: string;
  /** 消解后的完整查询，供 intent-recognition / query-rewrite 使用 */
  query: string;
  /** 是否发生了实质性消解（true = 代词/省略被替换） */
  wasDisambiguated: boolean;
  /** 当前会话历史（含本轮） */
  sessionHistory: ConversationTurn[];
  warnings: string[];
}

// ─── 规则代词列表 ─────────────────────────────────────────────────────────────

const PRONOUN_PATTERNS = [
  /\b(it|this|that|these|those)\b/gi,
  /[这那]个?(?:产品|功能|特性|服务)?/g,
  /[它他她](?:的)?/g,
  /该(?:产品|功能|服务)/g,
  /此(?:功能)?/g,
];

/**
 * 从文本末尾提取最后一个名词短语（简单启发式：取最后一个连续汉字词组或英文词）。
 * 用于替换代词时的锚点。
 */
function extractLastNoun(text: string): string {
  const cleaned = text.replace(/[？！。，、；：""''【】（）\?!,.:;()\n]/g, " ").trim();
  const segments = cleaned.split(/\s+/).filter((s) => s.length >= 2);
  // 优先取长度 >= 2 的词，从后往前
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].length >= 2) return segments[i];
  }
  return segments[segments.length - 1] ?? "";
}

// ─── session-history（规则消解） ──────────────────────────────────────────────

function disambiguateByRule(
  currentMessage: string,
  history: ConversationTurn[]
): ContextManagementOutput {
  const warnings: string[] = [];

  if (history.length === 0) {
    // 没有历史，无需消解
    return {
      originalMessage: currentMessage,
      query: currentMessage,
      wasDisambiguated: false,
      sessionHistory: [{ role: "user", content: currentMessage }],
      warnings,
    };
  }

  // 找上一轮 user 消息里的最后一个名词，作为代词替换目标
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

// ─── llm-disambiguate ─────────────────────────────────────────────────────────

async function disambiguateByLLM(
  currentMessage: string,
  history: ConversationTurn[],
  model: string,
  paramApiKey?: string
): Promise<ContextManagementOutput> {
  const apiKey = paramApiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 OpenAI API Key：请在表单中填写或设置 OPENAI_API_KEY 环境变量");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const historyText = history
    .slice(-6) // 最近 3 轮
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

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown> };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const { methodId, params } = body;

  const currentMessage = String(params.currentMessage ?? "").trim();
  if (!currentMessage) {
    return NextResponse.json(
      { error: { code: "empty_message", message: "currentMessage 不能为空" } },
      { status: 400 }
    );
  }

  const rawHistory = Array.isArray(params.history) ? params.history as ConversationTurn[] : [];

  try {
    let result: ContextManagementOutput;

    switch (methodId) {
      case "session-history":
        result = disambiguateByRule(currentMessage, rawHistory);
        break;
      case "llm-disambiguate":
        result = await disambiguateByLLM(
          currentMessage, rawHistory,
          String(params.model ?? "gpt-4o-mini"),
          typeof params.apiKey === "string" ? params.apiKey : undefined
        );
        break;
      default:
        return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
    }

    return NextResponse.json({
      output: result,
      trace: { methodId, wasDisambiguated: result.wasDisambiguated, historyTurns: rawHistory.length, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: { code: "context_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
