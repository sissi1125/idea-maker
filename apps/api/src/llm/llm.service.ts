/**
 * LlmService — feat-300.1 Phase 3.5
 *
 * 把 Vercel ai-sdk 的 provider 创建集中到一处，给 AgentRunner / 8 个 tool /
 * MemoryDistiller / EvalRunner 复用。Controller 层不直接 new createOpenAI(...)。
 *
 * 为什么是 ai-sdk 而不是直接用 openai SDK：
 *   - generateText / streamText / tool() 内置了 ReAct 循环 + onStepFinish 钩子，
 *     省得我们自己手写 while 循环 + 解析 tool_calls；
 *   - LanguageModelV1 抽象屏蔽了不同 provider 的细节，未来要接 Claude / Gemini
 *     只换 createXxx() 不改 agent 主循环。
 *
 * 为什么仍然走 @ai-sdk/openai 而不是各家专用 provider：
 *   - 国内 LLM（智谱 GLM / SiliconFlow / DeepSeek / OpenRouter）几乎都暴露
 *     OpenAI 兼容协议，改 baseURL 就能接，不必每家装一个适配包。
 *   - 这是项目的"BYOK + 多 provider"低成本路径。
 *
 * BYOK 状态说明：
 *   project_settings.encrypted_api_key 现阶段是明文（schema 注释里标了 "Week 5
 *   接 AES-256"，feat-200.x 尚未实现）。本服务当作明文使用，待加密落地后只需
 *   改 decryptApiKey() 一处。下游调用者无感。
 */

import { Injectable, Logger } from "@nestjs/common";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

export interface LlmConfig {
  /** provider 标识，目前 'openai' / 'zhipu' / 'siliconflow' / 'deepseek' 都走 OpenAI 兼容协议 */
  provider?: string | null;
  /** 已解密的 API key；为空时用环境变量兜底（开发/测试方便） */
  apiKey?: string | null;
  /** OpenAI 兼容端点；为空时用 OpenAI 官方 */
  baseURL?: string | null;
  /** 模型名，如 'glm-4-flash' / 'gpt-4o-mini'；为空时用 LLM_MODEL 环境变量 */
  model?: string | null;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  /**
   * 根据项目配置创建一个 LanguageModelV1 实例，直接传给 ai-sdk 的
   * generateText / streamText / agent runner。
   *
   * 优先级：传入参数 → 环境变量。这样 unit test 可以 mock，prod 走配置。
   */
  create(config: LlmConfig): LanguageModelV1 {
    const apiKey = this.resolveApiKey(config.apiKey);
    const baseURL = config.baseURL?.trim() || process.env.LLM_BASE_URL || undefined;
    const model = config.model?.trim() || process.env.LLM_MODEL || "gpt-4o-mini";

    // createOpenAI 返回 provider 函数，调用 provider(modelId) 得到 LanguageModelV1。
    // 注意：不在这里实例化模型时挂全局默认参数（temperature 等），让 agent runner
    // 在每次 generateText 调用时按需传递，便于 critic / generate 用不同 temperature。
    const provider = createOpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      // compatibility: 'compatible' 关闭 OpenAI 专属字段（如 strict mode），
      // 兼容智谱 / SiliconFlow 等只实现核心协议的 provider。
      compatibility: "compatible",
    });

    return provider(model);
  }

  /**
   * 解密 BYOK key。当前明文直存，TODO：feat-XXX 接 AES-256 时改这里。
   * 把"解密"动作集中到一处的好处：未来加密上线只改一行，下游所有调用方无感。
   */
  private decryptApiKey(encrypted: string): string {
    // TODO(crypto): 当 project_settings.encrypted_api_key 真正落地 AES-256 时，
    // 这里换成 CryptoService.decrypt(encrypted)。schema.ts 注释提到 "Week 5"，
    // 目前是占位明文存储。
    return encrypted;
  }

  /**
   * 优先级：显式参数 → LLM_API_KEY → OPENAI_API_KEY。
   * 与既有 ProvidersService.createLLMClient 的语义一致，避免迁移期两套 key 解析逻辑。
   */
  private resolveApiKey(paramKey?: string | null): string {
    const explicit = paramKey?.trim();
    if (explicit) return this.decryptApiKey(explicit);

    const envKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (envKey) return envKey;

    throw new Error(
      "缺少 LLM API Key：请在项目 Settings 中填写，或设置 LLM_API_KEY / OPENAI_API_KEY 环境变量",
    );
  }
}
