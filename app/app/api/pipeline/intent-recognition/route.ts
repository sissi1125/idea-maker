/**
 * RAG Pipeline Stage — Intent Recognition（意图识别 / 路由）
 *
 * 作用：判断用户查询的类型，将不同意图路由到对应的处理分支，
 *       避免把"随机聊天"或"功能无关问题"送入全量 RAG 检索。
 *
 * Pipeline 位置：
 *   Context Management → [Intent Recognition] → Query Rewrite → Retrieval
 *
 * 支持的意图：
 *   knowledge-qa       产品知识问答（应走 RAG 检索）
 *   marketing-strategy 营销策略生成（应走 RAG + 生成）
 *   chitchat           闲聊/无关问题（可直接回复，跳过检索）
 *   out-of-scope       超出产品范围（可拒答）
 *
 * 两种方法：
 *
 *   rule-based    关键词匹配规则分类，速度快，无 API 依赖
 *                 准确率有限，适合意图边界清晰的场景
 *
 *   llm-router    LLM 零样本/少样本分类，准确率高
 *                 需要 OpenAI API Key，每次调用消耗 100-200 tokens
 */

import { NextRequest, NextResponse } from "next/server";
import type { ContextManagementOutput } from "../context-management/route";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type Intent = "knowledge-qa" | "marketing-strategy" | "chitchat" | "out-of-scope";

export interface IntentRecognitionOutput {
  /** 传递到下游的 query（来自上游消解后的查询，或直接用 params.query） */
  query: string;
  intent: Intent;
  confidence: number;
  /** 路由建议：continue = 继续 RAG 流程，skip-retrieval = 跳过检索 */
  routingDecision: "continue" | "skip-retrieval";
  /** 路由说明 */
  routingReason: string;
  warnings: string[];
}

// ─── rule-based ───────────────────────────────────────────────────────────────

const INTENT_RULES: Array<{ intent: Intent; patterns: RegExp[] }> = [
  {
    intent: "marketing-strategy",
    patterns: [
      /营销|推广|文案|卖点|slogan|素材|内容策略|社媒|公众号/i,
      /怎么写|如何推|怎么卖|怎么宣传/i,
    ],
  },
  {
    intent: "chitchat",
    patterns: [
      /^(你好|hi|hello|嗨|在吗|哈哈|哈哈哈|好的|谢谢|感谢)[！。？!?]?$/i,
      /天气|今天|吃饭|心情|你叫什么|你是谁|你能做什么/i,
    ],
  },
  {
    intent: "out-of-scope",
    patterns: [
      /股票|基金|炒股|政治|新闻|体育|娱乐明星/i,
    ],
  },
];

function classifyByRule(query: string): Omit<IntentRecognitionOutput, "query" | "warnings"> {
  const q = query.trim();

  for (const { intent, patterns } of INTENT_RULES) {
    if (patterns.some((p) => p.test(q))) {
      return {
        intent,
        confidence: 0.8,
        routingDecision: intent === "knowledge-qa" || intent === "marketing-strategy" ? "continue" : "skip-retrieval",
        routingReason: `规则匹配：意图 ${intent}`,
      };
    }
  }

  // 默认：产品知识问答
  return {
    intent: "knowledge-qa",
    confidence: 0.7,
    routingDecision: "continue",
    routingReason: "无规则命中，默认为产品知识问答",
  };
}

// ─── llm-router ───────────────────────────────────────────────────────────────

async function classifyByLLM(
  query: string,
  model: string,
  intents: string[],
  paramApiKey?: string
): Promise<Omit<IntentRecognitionOutput, "query" | "warnings">> {
  const apiKey = paramApiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 OpenAI API Key：请在表单中填写或设置 OPENAI_API_KEY 环境变量");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const intentList = intents.join(", ");
  const systemPrompt = `你是一个意图分类器。将用户查询分类为以下意图之一：${intentList}
意图说明：
- knowledge-qa: 产品功能、定价、使用方式等知识性问题
- marketing-strategy: 营销推广、文案写作、内容策略
- chitchat: 闲聊、问候、与产品无关的对话
- out-of-scope: 超出产品范围的问题
返回 JSON：{"intent": "<意图>", "confidence": <0-1浮点数>, "reason": "<一句话说明>"}`;

  const resp = await client.chat.completions.create({
    model, temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
  });

  const raw = JSON.parse(resp.choices[0].message.content ?? "{}") as {
    intent?: string; confidence?: number; reason?: string;
  };

  const intent = (intents.includes(raw.intent ?? "") ? raw.intent : "knowledge-qa") as Intent;
  const confidence = Math.min(1, Math.max(0, raw.confidence ?? 0.8));
  const skipRetrieval = intent === "chitchat" || intent === "out-of-scope";

  return {
    intent,
    confidence,
    routingDecision: skipRetrieval ? "skip-retrieval" : "continue",
    routingReason: raw.reason ?? `LLM 分类：${intent}`,
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: ContextManagementOutput | null;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const { methodId, params, upstreamOutput } = body;

  // query 优先读上游消解结果，回退到 params.query
  const query = (upstreamOutput?.query ?? String(params.query ?? "")).trim();
  if (!query) {
    return NextResponse.json(
      { error: { code: "empty_query", message: "query 不能为空：请填写 params.query 或先运行 Context Management Stage" } },
      { status: 400 }
    );
  }

  const warnings: string[] = [];
  try {
    let classification: Omit<IntentRecognitionOutput, "query" | "warnings">;

    switch (methodId) {
      case "rule-based":
        classification = classifyByRule(query);
        break;
      case "llm-router": {
        const intents = Array.isArray(params.intents)
          ? (params.intents as string[])
          : ["knowledge-qa", "marketing-strategy", "chitchat", "out-of-scope"];
        classification = await classifyByLLM(
          query,
          String(params.model ?? "gpt-4o-mini"),
          intents,
          typeof params.apiKey === "string" ? params.apiKey : undefined
        );
        break;
      }
      default:
        return NextResponse.json({ error: { code: "unknown_method", message: `未知方法: ${methodId}` } }, { status: 400 });
    }

    if (classification.routingDecision === "skip-retrieval") {
      warnings.push(`意图 "${classification.intent}" → 建议跳过检索。若启用了后续 query-rewrite/retrieval 步骤，可在 enabledSteps 中禁用或忽略此建议继续执行。`);
    }

    const output: IntentRecognitionOutput = { query, ...classification, warnings };

    return NextResponse.json({
      output,
      trace: { methodId, intent: output.intent, confidence: output.confidence, routingDecision: output.routingDecision, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: { code: "intent_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
