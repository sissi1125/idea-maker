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
import { sanitizeSummaryForPrompt, type EvidenceChunk } from "./sanitize-summary";

export interface ProjectKnowledgeEntry {
  /** intro = 产品介绍；compete = 竞品分析 */
  cardType: "intro" | "compete";
  /**
   * LLM 生成的 markdown 摘要（result_notes）。本注入器会调 sanitizeSummaryForPrompt
   * 剥掉 markdown 句法、把 [evidence-NNN] 替换成原文，不需要调用方预处理。
   */
  content: string;
  /**
   * 与 content 同源 generation 的 retrieved_chunks，按 evidence-NNN 顺序排列。
   * 用来把摘要里的 [evidence-001] 等占位符展开成实际语句。可空——空则占位符被删除。
   */
  evidence?: EvidenceChunk[];
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
      // 关键：先剥 markdown + 展开 evidence-NNN，再走截断
      // 这样 LLM 看到的是自然中文段，不是 "## 核心卖点\n- xxx [evidence-001]" 这种
      // 既不易读又有空占位符的形态
      const cleaned = sanitizeSummaryForPrompt(entry.content, entry.evidence ?? []);
      const truncated =
        cleaned.length > MAX_CHARS_PER_ENTRY
          ? cleaned.slice(0, MAX_CHARS_PER_ENTRY) + "\n…（已截断）"
          : cleaned;
      sections.push(`【${HEADERS[type]}】\n${truncated.trim()}`);
    }
    if (sections.length === 0) return "";

    return `\n\n[产品知识快照]
⚠️ 这是本项目的产品事实清单，**优先级高于一切常规检索流程**。
你产出的所有内容（卖点、文案、标题、场景、话题）必须满足：
  1. 每个具体描述（功能 / 受众 / 使用场景 / 数据点）都能从下方清单中找到对应
  2. 不允许编造下方未提及的功能、价格、平台、用户群
  3. 不允许写"假设这款产品有 X"或"如果它能 Y"之类的虚构
  4. 用户没指定方向时，从下方列出的产品卖点里挑最契合的来发挥
违反以上任一条会导致 critic_review 直接判 0 分。

${sections.join("\n\n")}`;
  },
});
