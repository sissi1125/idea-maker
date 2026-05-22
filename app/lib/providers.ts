/**
 * OpenAI-compatible API Provider 工厂
 *
 * 支持所有兼容 OpenAI Chat / Embeddings API 的服务商：
 *   - OpenAI：无需 baseURL，直接用 OPENAI_API_KEY
 *   - Qwen/DashScope：EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
 *   - DeepSeek：LLM_BASE_URL=https://api.deepseek.com
 *   - 本地 Ollama：LLM_BASE_URL=http://localhost:11434/v1
 *   - 任何 OpenAI-compatible 服务
 *
 * 环境变量优先级（LLM）：
 *   表单 apiKey → LLM_API_KEY → OPENAI_API_KEY
 *   表单 baseUrl → LLM_BASE_URL → （无，使用 OpenAI 默认）
 *   LLM_MODEL → 默认 "gpt-4o-mini"
 *
 * 环境变量优先级（Embedding）：
 *   表单 apiKey → EMBEDDING_API_KEY → LLM_API_KEY → OPENAI_API_KEY
 *   表单 baseUrl → EMBEDDING_BASE_URL → LLM_BASE_URL → （无，使用 OpenAI 默认）
 *   EMBEDDING_MODEL → 默认 "text-embedding-v4"（Qwen，中文优先）
 *   EMBEDDING_DIMENSION → 默认 1536
 *
 * 示例 .env.local（Qwen）：
 *   LLM_API_KEY=sk-xxx
 *   LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
 *   LLM_MODEL=qwen-plus
 *   EMBEDDING_API_KEY=sk-xxx
 *   EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
 *   EMBEDDING_MODEL=text-embedding-v4
 *   EMBEDDING_DIMENSION=1024
 */

import type OpenAI from "openai";

// ─── LLM Client ───────────────────────────────────────────────────────────────

export interface LLMClientConfig {
  client: OpenAI;
  /** 实际使用的模型 ID（env > 默认值，表单参数由调用方自己传） */
  defaultModel: string;
}

/**
 * 创建 OpenAI-compatible LLM 客户端（用于 chat completions）。
 *
 * @param paramApiKey  表单中用户填写的 API Key（优先级最高）
 * @param paramBaseUrl 表单中用户填写的 Base URL（优先级最高）
 */
export async function createLLMClient(
  paramApiKey?: string,
  paramBaseUrl?: string
): Promise<LLMClientConfig> {
  const { default: OpenAIClass } = await import("openai");

  const apiKey =
    paramApiKey?.trim() ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "缺少 LLM API Key：请在表单中填写，或设置 LLM_API_KEY / OPENAI_API_KEY 环境变量"
    );
  }

  const baseURL =
    paramBaseUrl?.trim() ||
    process.env.LLM_BASE_URL ||
    undefined; // undefined = OpenAI 官方地址

  const defaultModel = process.env.LLM_MODEL || "gpt-4o-mini";

  const client = new OpenAIClass({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  return { client, defaultModel };
}

// ─── Embedding Client ─────────────────────────────────────────────────────────

export interface EmbeddingClientConfig {
  client: OpenAI;
  /** 实际使用的 embedding 模型 ID */
  defaultModel: string;
  /** 默认向量维度（从 EMBEDDING_DIMENSION 或 1536） */
  defaultDimension: number;
}

/**
 * 创建 OpenAI-compatible Embedding 客户端。
 *
 * @param paramApiKey  表单中用户填写的 API Key（优先级最高）
 * @param paramBaseUrl 表单中用户填写的 Base URL（优先级最高）
 */
export async function createEmbeddingClient(
  paramApiKey?: string,
  paramBaseUrl?: string
): Promise<EmbeddingClientConfig> {
  const { default: OpenAIClass } = await import("openai");

  const apiKey =
    paramApiKey?.trim() ||
    process.env.EMBEDDING_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "缺少 Embedding API Key：请在表单中填写，或设置 EMBEDDING_API_KEY / LLM_API_KEY / OPENAI_API_KEY 环境变量"
    );
  }

  const baseURL =
    paramBaseUrl?.trim() ||
    process.env.EMBEDDING_BASE_URL ||
    process.env.LLM_BASE_URL ||
    undefined;

  // 中文优先：默认使用 Qwen text-embedding-v4（中文优化，1024 维）
  // 如需 OpenAI 请在 .env.local 显式设置 EMBEDDING_MODEL=text-embedding-3-small
  const defaultModel = process.env.EMBEDDING_MODEL || "text-embedding-v4";
  const defaultDimension = parseInt(process.env.EMBEDDING_DIMENSION || "1024", 10);

  const client = new OpenAIClass({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  return { client, defaultModel, defaultDimension };
}

// ─── 工具：embed 单条文本（供 retrieval stage 使用） ──────────────────────────

/**
 * 通过 OpenAI-compatible API 对单条文本做 embedding。
 * 兼容 text-embedding-3-* 的 dimensions 参数，以及其他模型（Qwen text-embedding-v4 等）。
 */
export async function embedSingleText(
  text: string,
  model: string,
  dimension: number,
  client: OpenAI
): Promise<number[]> {
  // 不再限制 text-embedding-3-* 才传 dimensions；
  // 旧模型 ada-002 不支持 dimensions 参数，需排除
  const isLegacy = model === "text-embedding-ada-002" || model === "text-embedding-001";

  const resp = await client.embeddings.create({
    model,
    input: text,
    ...(isLegacy ? {} : { dimensions: dimension }),
  });
  return resp.data[0].embedding;
}

/**
 * 批量 embedding，返回向量数组，顺序与输入一致。
 */
export async function embedBatch(
  texts: string[],
  model: string,
  dimension: number,
  client: OpenAI
): Promise<number[][]> {
  const isLegacy = model === "text-embedding-ada-002" || model === "text-embedding-001";

  const resp = await client.embeddings.create({
    model,
    input: texts,
    ...(isLegacy ? {} : { dimensions: dimension }),
  });
  resp.data.sort((a, b) => a.index - b.index);
  return resp.data.map((d) => d.embedding);
}
