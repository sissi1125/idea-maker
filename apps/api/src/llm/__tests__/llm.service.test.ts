/**
 * LlmService 单测
 *
 * 重点验证：API key 解析优先级 + 缺 key 时抛错。不真实调 OpenAI，只断言
 * createOpenAI() 拿到了正确参数（通过 vi.mock 拦截）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOpenAIMock = vi.fn();

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (args: unknown) => {
    createOpenAIMock(args);
    // provider(modelId) → 返回一个假的 LanguageModelV1 占位
    return (modelId: string) => ({ modelId, __mock: true });
  },
}));

import { LlmService } from "../llm.service";

describe("LlmService", () => {
  let svc: LlmService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    svc = new LlmService();
    originalEnv = { ...process.env };
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    createOpenAIMock.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("传入的 apiKey 优先于环境变量", () => {
    process.env.LLM_API_KEY = "env-key";
    const model = svc.create({ apiKey: "param-key", model: "glm-4-flash" });
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "param-key" }),
    );
    expect((model as { modelId: string }).modelId).toBe("glm-4-flash");
  });

  it("无 apiKey 时回落到 LLM_API_KEY 环境变量", () => {
    process.env.LLM_API_KEY = "env-key";
    svc.create({ model: "gpt-4o-mini" });
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "env-key" }),
    );
  });

  it("LLM_API_KEY 缺失则回落到 OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    svc.create({});
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "openai-key" }),
    );
  });

  it("完全没有 key 时抛出明确错误", () => {
    expect(() => svc.create({})).toThrowError(/缺少 LLM API Key/);
  });

  it("baseURL 优先级：参数 > LLM_BASE_URL", () => {
    process.env.LLM_BASE_URL = "https://env.example.com";
    svc.create({ apiKey: "k", baseURL: "https://param.example.com" });
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://param.example.com" }),
    );
  });

  it("compatibility 默认走 'compatible'（兼容国产 provider）", () => {
    svc.create({ apiKey: "k" });
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ compatibility: "compatible" }),
    );
  });

  it("model 缺省回落到 gpt-4o-mini", () => {
    const model = svc.create({ apiKey: "k" });
    expect((model as { modelId: string }).modelId).toBe("gpt-4o-mini");
  });
});
