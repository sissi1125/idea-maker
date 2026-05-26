/**
 * RAG Pipeline Stage - Intent Recognition - 纯算法
 *
 * 2 method：
 *   rule-based  关键词正则匹配
 *   llm-router  注入 LLMChatClient，JSON mode 分类
 */

import type {
  Intent,
  IntentRecognitionInput,
  IntentRecognitionOutput,
  IntentRecognitionResult,
  LLMChatClient,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

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
    patterns: [/股票|基金|炒股|政治|新闻|体育|娱乐明星/i],
  },
];

function classifyByRule(
  query: string,
): Omit<IntentRecognitionOutput, "query" | "warnings"> {
  const q = query.trim();
  for (const { intent, patterns } of INTENT_RULES) {
    if (patterns.some((p) => p.test(q))) {
      const skipRetrieval = intent === "chitchat" || intent === "out-of-scope";
      return {
        intent,
        confidence: 0.8,
        routingDecision: skipRetrieval ? "skip-retrieval" : "continue",
        routingReason: `规则匹配：意图 ${intent}`,
      };
    }
  }
  // 默认走产品知识问答
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
  client: LLMChatClient,
  options: { model: string; intents: string[] },
): Promise<Omit<IntentRecognitionOutput, "query" | "warnings">> {
  const { model, intents } = options;
  const intentList = intents.join(", ");
  const systemPrompt = `你是一个意图分类器。将用户查询分类为以下意图之一：${intentList}
意图说明：
- knowledge-qa: 产品功能、定价、使用方式等知识性问题
- marketing-strategy: 营销推广、文案写作、内容策略
- chitchat: 闲聊、问候、与产品无关的对话
- out-of-scope: 超出产品范围的问题
返回 JSON：{"intent": "<意图>", "confidence": <0-1浮点数>, "reason": "<一句话说明>"}`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
  });

  let parsed: { intent?: string; confidence?: number; reason?: string };
  try {
    parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
  } catch {
    parsed = {};
  }

  const intent = (intents.includes(parsed.intent ?? "") ? parsed.intent : "knowledge-qa") as Intent;
  const confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0.8));
  const skipRetrieval = intent === "chitchat" || intent === "out-of-scope";

  return {
    intent,
    confidence,
    routingDecision: skipRetrieval ? "skip-retrieval" : "continue",
    routingReason: parsed.reason ?? `LLM 分类：${intent}`,
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

const DEFAULT_INTENTS: string[] = [
  "knowledge-qa",
  "marketing-strategy",
  "chitchat",
  "out-of-scope",
];

export async function runIntentRecognition(
  input: IntentRecognitionInput,
): Promise<IntentRecognitionResult> {
  const { methodId, params, upstreamQuery, llmClient } = input;

  // query 优先用上游 context-management 消歧后的，回退 params.query
  const query = (upstreamQuery ?? params.query).trim();
  if (!query) {
    throw new PipelineError(
      "empty_query",
      "query 不能为空：请填写 params.query 或先运行 Context Management Stage",
    );
  }

  let classification: Omit<IntentRecognitionOutput, "query" | "warnings">;

  switch (methodId) {
    case "llm-router": {
      if (!llmClient) {
        throw new PipelineError(
          "missing_client",
          "llm-router 需要注入 LLMChatClient；路由层应通过 createLLMClient 创建后传入 Input.llmClient",
        );
      }
      classification = await classifyByLLM(query, llmClient, {
        model: params.model,
        intents: params.intents ?? DEFAULT_INTENTS,
      });
      break;
    }
    case "rule-based":
    default:
      classification = classifyByRule(query);
      break;
  }

  const warnings: string[] = [];
  if (classification.routingDecision === "skip-retrieval") {
    warnings.push(
      `意图 "${classification.intent}" → 建议跳过检索。若启用了后续 query-rewrite/retrieval 步骤，可在 enabledSteps 中禁用或忽略此建议继续执行。`,
    );
  }

  return {
    output: { query, ...classification, warnings },
    trace: {
      methodId,
      intent: classification.intent,
      confidence: classification.confidence,
      routingDecision: classification.routingDecision,
    },
    warnings,
  };
}
