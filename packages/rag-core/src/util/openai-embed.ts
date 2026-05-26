/**
 * OpenAI-compatible Embedding 调用工具
 *
 * 接受外部传入的 OpenAI client（rag-core 不读 env，不创建 client）。
 * 路由层用 apps/web/lib/providers.ts 的 createEmbeddingClient 创建后注入。
 *
 * 兼容范围：所有 OpenAI Embeddings API 兼容的服务商，包括：
 *   - OpenAI (text-embedding-3-small/large)
 *   - Qwen / DashScope (text-embedding-v4)
 *   - DeepSeek / Moonshot / 任何兼容服务
 *
 * Legacy 模型（ada-002 / embedding-001）不支持 dimensions 参数，自动跳过。
 */

import type OpenAI from "openai";

function isLegacyModel(model: string): boolean {
  return model === "text-embedding-ada-002" || model === "text-embedding-001";
}

/**
 * 单条文本 embedding（retrieval stage 的 query embedding 也用这个）。
 */
export async function embedSingleText(
  text: string,
  model: string,
  dimension: number,
  client: OpenAI,
): Promise<number[]> {
  const resp = await client.embeddings.create({
    model,
    input: text,
    ...(isLegacyModel(model) ? {} : { dimensions: dimension }),
  });
  return resp.data[0].embedding;
}

/**
 * 批量 embedding，返回向量数组，顺序与输入一致。
 *
 * 注意：OpenAI 返回的 data 不保证顺序，需按 .index 显式 sort。
 */
export async function embedBatch(
  texts: string[],
  model: string,
  dimension: number,
  client: OpenAI,
): Promise<number[][]> {
  const resp = await client.embeddings.create({
    model,
    input: texts,
    ...(isLegacyModel(model) ? {} : { dimensions: dimension }),
  });
  resp.data.sort((a, b) => a.index - b.index);
  return resp.data.map((d) => d.embedding);
}
