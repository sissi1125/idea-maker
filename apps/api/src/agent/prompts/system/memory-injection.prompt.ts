/**
 * Memory 注入 prompt：把 agent_memory 表里的偏好按 4 类（preference/style/
 * taboo/audience）拼成自然语言段落，注入到 system prompt 末尾。
 *
 * **核心设计**：分类拼接而不是直接 concat 所有 content。
 *   理由：LLM 看到分类标题会按类型理解（"这是禁忌"vs"这是受众"），
 *   行为更稳定；直接 concat 容易让 LLM 把禁忌当建议、把受众当风格。
 *
 * 空 memory 时 render 返回空字符串而不是占位文字——compose 阶段 join 会自动跳过。
 */

import { definePrompt } from "../types";

export type MemoryKind = "preference" | "style" | "taboo" | "audience";

export interface MemoryEntry {
  kind: MemoryKind;
  content: string;
  /** 0-1，compose 时可按阈值过滤；本段渲染不感知，由 reader 上游过滤 */
  confidence?: number;
}

export interface MemoryInjectionInput {
  memory: MemoryEntry[];
}

const KIND_HEADERS: Record<MemoryKind, string> = {
  preference: "用户的通用偏好",
  style: "用户的语气/风格习惯",
  taboo: "用户绝对禁忌（不要做的事）",
  audience: "目标受众画像",
};

/**
 * 按 kind 排序：taboo 优先（最重要，LLM 容易在长 prompt 末尾忽略，所以靠前）。
 * 然后 audience（决定语气大方向）→ style（细节风格）→ preference（兜底）。
 */
const RENDER_ORDER: MemoryKind[] = ["taboo", "audience", "style", "preference"];

export const memoryInjectionPrompt = definePrompt<MemoryInjectionInput>({
  id: "agent.memory-injection",
  version: "v1",
  description: "把 agent_memory 按 4 类拼成自然语言段，注入 system prompt 末尾",
  render: ({ memory }) => {
    if (!memory || memory.length === 0) return "";

    const grouped: Record<MemoryKind, string[]> = {
      preference: [],
      style: [],
      taboo: [],
      audience: [],
    };
    for (const entry of memory) {
      grouped[entry.kind]?.push(entry.content);
    }

    const sections: string[] = [];
    for (const kind of RENDER_ORDER) {
      const items = grouped[kind];
      if (items.length === 0) continue;
      sections.push(`【${KIND_HEADERS[kind]}】\n${items.map((c) => `- ${c}`).join("\n")}`);
    }

    if (sections.length === 0) return "";

    return `\n\n[用户画像]\n${sections.join("\n\n")}`;
  },
});
