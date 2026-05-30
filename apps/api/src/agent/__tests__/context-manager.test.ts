/**
 * ContextManager 单测：
 *  - estimateTokens 中英文混合估算（±10% 容忍）
 *  - shouldCompress 触发条件（OR 语义）
 *  - compress 保留最近 N 轮 + 压缩前面
 *  - inject 拼接系统 prompt
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: (args: unknown) => generateTextMock(args) };
});

import {
  ContextManager,
  TOKEN_THRESHOLD,
  MESSAGE_COUNT_THRESHOLD,
  KEEP_RECENT_TURNS,
} from "../context-manager";
import type { ChatMessage } from "../agent.types";

describe("ContextManager.estimateTokens", () => {
  const cm = new ContextManager();

  it("纯英文：约 4 字符/token", () => {
    const ms: ChatMessage[] = [{ role: "user", content: "a".repeat(400) }];
    const tokens = cm.estimateTokens(ms);
    // 400/4 + 4 overhead ≈ 104
    expect(tokens).toBeGreaterThan(100);
    expect(tokens).toBeLessThan(115);
  });

  it("纯中文：约 1.5 字符/token", () => {
    const ms: ChatMessage[] = [{ role: "user", content: "护肤".repeat(75) }];
    const tokens = cm.estimateTokens(ms);
    // 150/1.5 + 4 ≈ 104
    expect(tokens).toBeGreaterThan(100);
    expect(tokens).toBeLessThan(115);
  });

  it("空 messages 返回 0", () => {
    expect(cm.estimateTokens([])).toBe(0);
  });

  it("混合中英文累加 + 多 message 各加 overhead", () => {
    const ms: ChatMessage[] = [
      { role: "user", content: "hello 你好" },
      { role: "assistant", content: "world 世界" },
    ];
    const tokens = cm.estimateTokens(ms);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("ContextManager.shouldCompress", () => {
  const cm = new ContextManager();

  it("少量短 messages 不触发", () => {
    const ms: ChatMessage[] = [{ role: "user", content: "hi" }];
    expect(cm.shouldCompress(ms)).toBe(false);
  });

  it("超 MESSAGE_COUNT_THRESHOLD 触发", () => {
    const ms: ChatMessage[] = Array.from(
      { length: MESSAGE_COUNT_THRESHOLD + 1 },
      () => ({ role: "user" as const, content: "x" }),
    );
    expect(cm.shouldCompress(ms)).toBe(true);
  });

  it("超 TOKEN_THRESHOLD 触发（即使条数少）", () => {
    const ms: ChatMessage[] = [
      { role: "user", content: "a".repeat(TOKEN_THRESHOLD * 4 + 100) },
    ];
    expect(cm.shouldCompress(ms)).toBe(true);
  });
});

describe("ContextManager.compress", () => {
  const cm = new ContextManager();

  beforeEach(() => generateTextMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("messages 长度 <= KEEP_RECENT_TURNS 时不调 LLM，原样返回", async () => {
    const ms: ChatMessage[] = Array.from({ length: KEEP_RECENT_TURNS }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
    }));
    const out = await cm.compress(ms, {} as never);
    expect(out.summary).toBe("");
    expect(out.trimmedMessages).toBe(ms); // 引用相等
    expect(out.compressedTurnCount).toBe(0);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("超出 KEEP_RECENT_TURNS 时：压缩前面 + 保留最近 N 条", async () => {
    generateTextMock.mockResolvedValue({
      text: "用户问了 A，助手用 search_kb 给了 B",
      usage: { promptTokens: 200, completionTokens: 50 },
    });
    const ms: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      content: `m${i}`,
    }));
    const out = await cm.compress(ms, {} as never);

    // 保留最后 KEEP_RECENT_TURNS 条
    expect(out.trimmedMessages).toHaveLength(KEEP_RECENT_TURNS);
    expect(out.trimmedMessages[0].content).toBe(`m${10 - KEEP_RECENT_TURNS}`);
    expect(out.compressedTurnCount).toBe(10 - KEEP_RECENT_TURNS);

    // 摘要内容
    expect(out.summary).toMatch(/用户问了 A/);

    // usage 透传给 CostTracker
    expect(out.usage).toEqual({ promptTokens: 200, completionTokens: 50 });
  });

  it("compress 调 generateText 时 temperature=0", async () => {
    generateTextMock.mockResolvedValue({
      text: "summary",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const ms: ChatMessage[] = Array.from({ length: 10 }, () => ({
      role: "user" as const,
      content: "x",
    }));
    await cm.compress(ms, {} as never);
    const args = generateTextMock.mock.calls[0][0];
    expect(args.temperature).toBe(0);
    expect(args.system).toMatch(/对话摘要/);
  });

  it("LLM 输出含前后空白时 trim", async () => {
    generateTextMock.mockResolvedValue({
      text: "   \n  summary text  \n  ",
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const ms: ChatMessage[] = Array.from({ length: 10 }, () => ({
      role: "user" as const,
      content: "x",
    }));
    const out = await cm.compress(ms, {} as never);
    expect(out.summary).toBe("summary text");
  });
});

describe("ContextManager.inject", () => {
  const cm = new ContextManager();

  it("空 summary 原样返回", () => {
    expect(cm.inject("system", "")).toBe("system");
    expect(cm.inject("system", "   ")).toBe("system");
  });

  it("非空 summary 拼到末尾", () => {
    const out = cm.inject("base", "用户喜欢简洁");
    expect(out).toMatch(/base/);
    expect(out).toMatch(/早期对话摘要/);
    expect(out).toMatch(/用户喜欢简洁/);
  });
});
