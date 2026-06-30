/**
 * 项目知识快照注入 — v1.0 优化项 3
 *
 * 把项目级 auto_generations 最新成功的「产品介绍」「竞品分析」摘要直接拼进
 * system prompt。这一步是设计补漏：之前 agent 只能靠 search_kb 工具一段段拉
 * chunk，导致没有"项目整体认知"，营销内容生成完全脱离实际产品定位——这违背了
 * Idea-Maker 的核心定位（围绕用户项目生成营销内容）。
 *
 * 注入策略：
 *   - 仅在有 succeeded 摘要时输出整段；都没有则 render 返回空字符串
 *   - intro / compete 各自一段，便于 LLM 区分维度
 *   - 截断到 2000 字以内：单次摘要再长也够 LLM 抓住核心定位；防 token 爆
 *   - 标签 [产品知识快照]，与 [用户画像] / [平台规则] 风格一致
 */

import { definePrompt } from "../types";

export interface ProjectKnowledgeEntry {
  /** intro = 产品介绍；compete = 竞品分析 */
  cardType: "intro" | "compete";
  /** LLM 生成的 markdown 摘要 */
  content: string;
}

export interface ProjectKnowledgeInjectionInput {
  entries: ProjectKnowledgeEntry[];
}

const HEADERS: Record<ProjectKnowledgeEntry["cardType"], string> = {
  intro: "产品介绍",
  compete: "竞品分析",
};

/** 单条摘要硬截断上限；防止某次摘要过长把上下文窗口顶爆 */
const MAX_CHARS_PER_ENTRY = 2000;

export const projectKnowledgeInjectionPrompt = definePrompt<ProjectKnowledgeInjectionInput>({
  id: "agent.project-knowledge-injection",
  version: "v1",
  description: "把项目最新 auto_generations 摘要（产品介绍 / 竞品分析）拼进 system prompt",
  render: ({ entries }) => {
    if (!entries || entries.length === 0) return "";

    const sections: string[] = [];
    // 固定顺序：intro 在前——营销内容首先要懂"自己是什么"，再谈"对手是什么"
    const order: ProjectKnowledgeEntry["cardType"][] = ["intro", "compete"];
    for (const type of order) {
      const entry = entries.find((e) => e.cardType === type);
      if (!entry || !entry.content.trim()) continue;
      const truncated =
        entry.content.length > MAX_CHARS_PER_ENTRY
          ? entry.content.slice(0, MAX_CHARS_PER_ENTRY) + "\n…（已截断）"
          : entry.content;
      sections.push(`【${HEADERS[type]}】\n${truncated.trim()}`);
    }
    if (sections.length === 0) return "";

    return `\n\n[产品知识快照]\n以下是本项目已沉淀的产品定位与竞争格局，**生成营销内容时必须严格基于这些事实**，不要凭空发挥与产品定位无关的卖点：\n\n${sections.join("\n\n")}`;
  },
});
