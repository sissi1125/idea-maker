/**
 * distill prompt 快照断言 — feat-300.4
 *
 * 保证 prompt 关键约束（JSON-only / edit_diff 主信号 / kind 四类）出现在渲染结果。
 */

import { describe, expect, it } from "vitest";
import { memoryDistillPrompt } from "../../agent/prompts/memory/distill.prompt";

describe("memoryDistillPrompt", () => {
  it("id/version 稳定，便于 trace 关联", () => {
    expect(memoryDistillPrompt.id).toBe("memory.distill");
    expect(memoryDistillPrompt.version).toBe("v1");
  });

  it("渲染包含 edit_diff 信号 + 四类 kind + 仅 JSON 要求", () => {
    const out = memoryDistillPrompt.render({
      feedbacks: [
        {
          feedbackId: "f-1",
          query: "护肤新品",
          original: "用了一段时间皮肤好极了 emoji 🎉",
          editDiff: "用了一段时间皮肤更稳定",
          ratings: { relevance: 4, accuracy: null, creativity: null, overall: 3 },
          comment: "太夸张了改简洁点",
        },
      ],
      existingMemory: [],
    });

    expect(out).toMatch(/edit_diff/);
    expect(out).toMatch(/preference/);
    expect(out).toMatch(/style/);
    expect(out).toMatch(/taboo/);
    expect(out).toMatch(/audience/);
    expect(out).toMatch(/仅返回 JSON/);
    expect(out).toContain("f-1");
  });

  it("已有 memory 注入 prompt 让 LLM 避免重复蒸馏", () => {
    const out = memoryDistillPrompt.render({
      feedbacks: [],
      existingMemory: [{ kind: "style", content: "短句为主" }],
    });
    expect(out).toContain("[style] 短句为主");
  });

  it("空 existingMemory 显示占位文字", () => {
    const out = memoryDistillPrompt.render({ feedbacks: [], existingMemory: [] });
    expect(out).toContain("尚无任何已学习的偏好");
  });
});
