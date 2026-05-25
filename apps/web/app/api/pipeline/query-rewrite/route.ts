/**
 * RAG Pipeline Stage — Query Rewrite（查询改写）
 *
 * 作用：将用户原始查询扩展或改写为多个变体，提升检索召回率。
 *
 * Pipeline 位置：
 *   [Query Rewrite] → Retrieval → Filter → Rerank → Citation
 *
 * 三种方法：
 *
 *   none                直接透传：rewrittenQueries = [originalQuery]
 *                       用于对照实验：看看不改写时检索效果如何
 *
 *   rule-keyword-expansion
 *                       规则提取关键词 + 模板扩展，生成 N 个变体
 *                       无需 API Key，适合快速验证
 *
 *   llm-marketing-rewrite
 *                       调 OpenAI 生成语义多样的营销视角查询
 *                       适合最终产品检索：覆盖更多相关 chunk
 *
 * 为什么需要 Query Rewrite？
 *   单个 query 往往用词偏口语或太精确，导致语义相近的 chunk 因表达差异被漏掉。
 *   多路查询取 union 后再检索（或用 RRF 合并），可以大幅提升 Recall@K。
 *   典型效果：从 1 个 query 扩展到 3 个，hit rate 可提升 15-30%。
 */

import { NextRequest, NextResponse } from "next/server";
import { createLLMClient } from "@/lib/providers";
import { tokenize } from "@/lib/nlp";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface QueryRewriteOutput {
  originalQuery: string;
  /** 包含 originalQuery 的扩展查询列表；下游 retrieval stage 对每个 query 并行检索 */
  rewrittenQueries: string[];
  method: string;
  warnings: string[];
}

// 停用词统一由 lib/nlp.ts 管理，本文件不再维护本地副本。

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
 * 规则关键词扩展：
 * 1. 提取 query 中的内容词（去除停用词）
 * 2. 基于模板生成多个变体，覆盖不同检索角度
 *    - 原 query（保留原意）
 *    - 关键词组合（更精确，适合术语检索）
 *    - "功能/特点"扩展（覆盖能力描述类 chunk）
 *    - 受众视角扩展（覆盖用户场景类 chunk）
 */
function rewriteRuleExpansion(
  query: string,
  maxQueries: number,
  targetAudience: string
): QueryRewriteOutput {
  const warnings: string[] = [];

  // 使用 jieba 分词 + 停用词过滤（lib/nlp.ts），正确处理中文词边界
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    warnings.push("未提取到有效关键词，返回原查询");
    return { originalQuery: query, rewrittenQueries: [query], method: "rule-keyword-expansion", warnings };
  }

  const variants: string[] = [query];

  // 中文优先：中文 token 之间无需空格，英文 token 保留空格
  const isChinese = (s: string) => /[一-鿿㐀-䶿]/.test(s);
  const tokenSep = tokens.length > 0 && isChinese(tokens[0]) ? "" : " ";

  // 关键词直接拼接（更精确）
  const keywordsOnly = tokens.slice(0, 4).join(tokenSep);
  if (keywordsOnly !== query.trim() && variants.length < maxQueries) {
    variants.push(keywordsOnly);
  }

  // 功能/特点扩展
  if (variants.length < maxQueries) {
    variants.push(`${tokens[0]}功能特点优势`);
  }

  // 受众视角扩展
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

/**
 * LLM 营销改写：让 OpenAI 生成多个查询变体。
 *
 * 系统 prompt 引导模型从以下角度生成查询：
 *   - 功能角度：这个产品能做什么
 *   - 场景角度：什么情况下会用
 *   - 对比角度：和其他方案有什么不同
 *
 * 输出格式是 JSON 数组，直接解析为 rewrittenQueries。
 */
async function rewriteLLMMarketing(
  query: string,
  model: string,
  temperature: number,
  maxQueries: number,
  rewriteGoal: string,
  targetAudience: string,
  paramApiKey?: string
): Promise<QueryRewriteOutput> {
  const { client } = await createLLMClient(paramApiKey);

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
      .filter((q) => typeof q === "string" && q.trim().length > 0)
      .slice(0, maxQueries);
  } catch {
    // 解析失败时回退到原查询
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

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  const { methodId, params } = body;

  const query = String(params.query ?? "").trim();
  if (!query) {
    return NextResponse.json(
      { error: { code: "empty_query", message: "查询不能为空，请在表单中填写 query 字段" } },
      { status: 400 }
    );
  }

  try {
    let result: QueryRewriteOutput;

    switch (methodId) {
      case "none":
        result = rewriteNone(query);
        break;

      case "rule-keyword-expansion":
        result = rewriteRuleExpansion(
          query,
          Number(params.maxQueries ?? 3),
          String(params.targetAudience ?? "")
        );
        break;

      case "llm-marketing-rewrite":
        result = await rewriteLLMMarketing(
          query,
          String(params.model ?? "gpt-4o-mini"),
          Number(params.temperature ?? 0.7),
          Number(params.maxQueries ?? 3),
          String(params.rewriteGoal ?? ""),
          String(params.targetAudience ?? ""),
          typeof params.apiKey === "string" ? params.apiKey : undefined
        );
        break;

      default:
        return NextResponse.json(
          { error: { code: "unknown_method", message: `未知方法: ${methodId}` } },
          { status: 400 }
        );
    }

    return NextResponse.json({
      output: result,
      trace: {
        methodId,
        originalQuery: result.originalQuery,
        queryCount: result.rewrittenQueries.length,
        queries: result.rewrittenQueries,
        durationMs: Date.now() - startMs,
      },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "rewrite_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 }
    );
  }
}
