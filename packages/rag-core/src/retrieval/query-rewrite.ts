/**
 * RAG Pipeline Stage - Query Rewrite（查询改写）- 纯算法
 *
 * 3 种 method：
 *   none                    透传原 query
 *   rule-keyword-expansion  jieba 关键词提取 + 模板扩展（4 个变体角度）
 *   llm-marketing-rewrite   OpenAI chat 生成多查询（路由层注入 LLMChatClient）
 *
 * 设计：纯函数 + I/O 注入。
 */

import type {
  LLMChatClient,
  QueryRewriteInput,
  QueryRewriteOutput,
  QueryRewriteResult,
} from "@harness/shared-types";
import { PipelineError } from "../errors";
import { tokenize } from "../util/nlp";

// ─── none ─────────────────────────────────────────────────────────────────────

function rewriteNone(query: string): QueryRewriteOutput {
  return {
    originalQuery: query,
    rewrittenQueries: [query],
    method: "none",
    warnings: [],
  };
}

// ─── rule-keyword-expansion ───────────────────────────────────────────────────

/**
 * 4 种扩展角度：
 *   1. 保留原 query（语义完整）
 *   2. 关键词拼接（精确匹配术语）
 *   3. "功能特点优势"扩展（命中能力描述类 chunk）
 *   4. 受众视角扩展（命中场景类 chunk）
 */
function rewriteRuleExpansion(
  query: string,
  maxQueries: number,
  targetAudience: string,
): QueryRewriteOutput {
  const warnings: string[] = [];
  const tokens = tokenize(query); // 中文优先：jieba 分词 + 停用词过滤

  if (tokens.length === 0) {
    warnings.push("未提取到有效关键词，返回原查询");
    return {
      originalQuery: query,
      rewrittenQueries: [query],
      method: "rule-keyword-expansion",
      warnings,
    };
  }

  const variants: string[] = [query];
  // 中文 token 间无需空格，英文保留
  const isChinese = (s: string) => /[一-鿿㐀-䶿]/.test(s);
  const tokenSep = isChinese(tokens[0]) ? "" : " ";

  const keywordsOnly = tokens.slice(0, 4).join(tokenSep);
  if (keywordsOnly !== query.trim() && variants.length < maxQueries) {
    variants.push(keywordsOnly);
  }

  if (variants.length < maxQueries) {
    variants.push(`${tokens[0]}功能特点优势`);
  }

  if (variants.length < maxQueries && targetAudience) {
    variants.push(`${targetAudience}使用${tokens.slice(0, 2).join("")}的场景`);
  } else if (variants.length < maxQueries && tokens.length > 1) {
    variants.push(`如何使用${tokens.slice(0, 2).join(tokenSep)}`);
  }

  return {
    originalQuery: query,
    rewrittenQueries: [...new Set(variants)].slice(0, maxQueries),
    method: "rule-keyword-expansion",
    warnings,
  };
}

// ─── llm-marketing-rewrite ────────────────────────────────────────────────────

async function rewriteLLMMarketing(
  query: string,
  client: LLMChatClient,
  options: {
    model: string;
    temperature: number;
    maxQueries: number;
    rewriteGoal: string;
    targetAudience: string;
  },
): Promise<QueryRewriteOutput> {
  const { model, temperature, maxQueries, rewriteGoal, targetAudience } = options;

  const goalContext = rewriteGoal ? `\n改写目标：${rewriteGoal}` : "";
  const audienceContext = targetAudience ? `\n目标受众：${targetAudience}` : "";

  const systemPrompt = `你是一个专业的 RAG 检索优化专家。
给定一个用户查询，生成 ${maxQueries} 个不同表达但语义相关的检索查询，用于从产品文档中检索相关内容。
要求：
1. 每个查询应从不同角度表达同一检索意图（功能角度、场景角度、技术角度）
2. 保持查询简洁（10-30字），避免过于复杂的从句
3. 第一个查询必须包含原始查询${goalContext}${audienceContext}
返回格式：仅返回 JSON 数组，例如 ["query1", "query2", "query3"]，不要其他内容。`;

  const resp = await client.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
  });

  const raw = resp.choices[0]?.message?.content?.trim() ?? "[]";
  let rewrittenQueries: string[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not array");
    rewrittenQueries = parsed
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .slice(0, maxQueries);
  } catch {
    rewrittenQueries = [query];
  }

  if (!rewrittenQueries.includes(query)) {
    rewrittenQueries = [query, ...rewrittenQueries].slice(0, maxQueries);
  }

  return {
    originalQuery: query,
    rewrittenQueries,
    method: "llm-marketing-rewrite",
    warnings: [],
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export async function runQueryRewrite(input: QueryRewriteInput): Promise<QueryRewriteResult> {
  const { methodId, params, llmClient } = input;
  const query = params.query.trim();

  if (!query) {
    throw new PipelineError("empty_query", "查询不能为空");
  }

  let output: QueryRewriteOutput;

  switch (methodId) {
    case "rule-keyword-expansion":
      output = rewriteRuleExpansion(query, params.maxQueries, params.targetAudience);
      break;

    case "llm-marketing-rewrite":
      if (!llmClient) {
        throw new PipelineError(
          "missing_client",
          "llm-marketing-rewrite 需要注入 LLMChatClient；路由层应通过 createLLMClient 创建后传入 Input.llmClient",
        );
      }
      output = await rewriteLLMMarketing(query, llmClient, {
        model: params.model,
        temperature: params.temperature,
        maxQueries: params.maxQueries,
        rewriteGoal: params.rewriteGoal,
        targetAudience: params.targetAudience,
      });
      break;

    case "none":
    default:
      output = rewriteNone(query);
      break;
  }

  return {
    output,
    trace: {
      methodId,
      originalQuery: output.originalQuery,
      queryCount: output.rewrittenQueries.length,
      queries: output.rewrittenQueries,
    },
    warnings: output.warnings,
  };
}
