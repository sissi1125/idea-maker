/**
 * refine_draft 的 system + user prompt 模板。
 *
 * 从 agent/tools/refine-draft.tool.ts 抽出。intensity 三选一映射也放在这里。
 */

import { definePrompt } from "../types";

export type RefineIntensity = "minor" | "moderate" | "rewrite";

export interface RefineDraftSystemInput {
  intensity: RefineIntensity;
}

export interface RefineDraftUserInput {
  draft: string;
  feedback: string;
}

function intensityToInstruction(intensity: RefineIntensity): string {
  switch (intensity) {
    case "minor":
      return "仅做语言润色和措辞调整，不动结构";
    case "rewrite":
      return "可以大幅重写，包括改变叙述顺序与开头";
    case "moderate":
    default:
      return "可以调整段落顺序和重写句子，但保留核心信息和 evidence 关联";
  }
}

export const refineDraftSystemPrompt = definePrompt<RefineDraftSystemInput>({
  id: "tool.refine_draft.system",
  version: "v1",
  description: "refine_draft tool 的 system prompt：修订规范 + intensity 控制",
  render: ({ intensity }) => `你是文案修订助手。任务：根据 feedback 修改原稿。
- 保留 [evidence-N] 引用标记（不要随意删除或新增）
- 修改幅度：${intensityToInstruction(intensity)}
- 输出格式：先输出修订后正文，再附一行 "===CHANGES===" 然后用一句话概括改了什么`,
});

export const refineDraftUserPrompt = definePrompt<RefineDraftUserInput>({
  id: "tool.refine_draft.user",
  version: "v1",
  description: "refine_draft tool 的 user prompt：原稿 + 修改意见",
  render: ({ draft, feedback }) => `原稿：
${draft}

修改意见：
${feedback}

请输出修订后正文。`,
});
