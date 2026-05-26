/**
 * ProvidersService — I/O client 工厂（DI 入口）
 *
 * 集中封装 LLM / Embedding / pg / TEI 端点的创建逻辑，
 * 复刻 apps/web/lib/providers.ts 的环境变量优先级语义，
 * 让 Controller 通过依赖注入获取，而不是自己读 env / new Client。
 *
 * 这是把 Functional Core 和 Imperative Shell 之间的"端口注入"标准化的关键层：
 *   - Controller = 路由薄壳（解析参数 + 注入 client + 调 rag-core）
 *   - ProvidersService = 客户端实例化（读 env / 表单 / 复用连接）
 *   - rag-core = 纯算法（接收 client，输出 result）
 */

import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { Client as PgClient } from "pg";
import type { OpenAICompatibleClient, LLMChatClient } from "@harness/shared-types";

export interface LLMClientConfig {
  client: LLMChatClient;
  defaultModel: string;
}

export interface EmbeddingClientConfig {
  client: OpenAICompatibleClient;
  defaultModel: string;
  defaultDimension: number;
}

@Injectable()
export class ProvidersService {
  /**
   * 创建 OpenAI-compatible LLM 客户端（chat completions）。
   * 优先级：表单参数 → LLM_API_KEY → OPENAI_API_KEY。
   */
  createLLMClient(paramApiKey?: string, paramBaseUrl?: string): LLMClientConfig {
    const apiKey =
      paramApiKey?.trim() || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "缺少 LLM API Key：请在表单中填写，或设置 LLM_API_KEY / OPENAI_API_KEY 环境变量",
      );
    }
    const baseURL = paramBaseUrl?.trim() || process.env.LLM_BASE_URL || undefined;
    const defaultModel = process.env.LLM_MODEL || "gpt-4o-mini";

    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    // OpenAI SDK 结构上满足 LLMChatClient（duck typing）
    return { client: client as unknown as LLMChatClient, defaultModel };
  }

  /**
   * 创建 OpenAI-compatible Embedding 客户端。
   * 优先级：表单参数 → EMBEDDING_API_KEY → LLM_API_KEY → OPENAI_API_KEY。
   */
  createEmbeddingClient(
    paramApiKey?: string,
    paramBaseUrl?: string,
  ): EmbeddingClientConfig {
    const apiKey =
      paramApiKey?.trim() ||
      process.env.EMBEDDING_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "缺少 Embedding API Key：请在表单中填写，或设置 EMBEDDING_API_KEY / LLM_API_KEY / OPENAI_API_KEY",
      );
    }
    const baseURL =
      paramBaseUrl?.trim() ||
      process.env.EMBEDDING_BASE_URL ||
      process.env.LLM_BASE_URL ||
      undefined;
    const defaultModel = process.env.EMBEDDING_MODEL || "text-embedding-v4";
    const defaultDimension = parseInt(process.env.EMBEDDING_DIMENSION || "1024", 10);

    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    return {
      client: client as unknown as OpenAICompatibleClient,
      defaultModel,
      defaultDimension,
    };
  }

  /**
   * 创建 pg.Client（每请求 new 一个，调用方自己 connect / finally end）。
   * 优先级：表单 connectionString → DATABASE_URL。
   */
  createPgClient(paramConnectionString?: string): PgClient {
    const connectionString =
      paramConnectionString?.trim() || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "缺少数据库连接串：请在表单填写或设置 DATABASE_URL 环境变量",
      );
    }
    return new PgClient({ connectionString });
  }

  /** 读取 TEI endpoint：优先 params 传入，否则读 HF_TEI_ENDPOINT。 */
  resolveTeiEndpoint(paramEndpoint?: string): string | undefined {
    return paramEndpoint?.trim() || process.env.HF_TEI_ENDPOINT;
  }
}
