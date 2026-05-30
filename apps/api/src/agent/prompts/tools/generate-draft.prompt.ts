/**
 * generate_draft 的 system + user prompt 模板。
 *
 * 从 agent/tools/generate-draft.tool.ts 抽出，tool 文件只负责调用、记 trace、抽 cited sources。
 *
 * 为什么分 system 与 user 两个 render：ai-sdk generateText 接受 system 和 prompt 两个参数，
 * 二者来源不同（system 偏角色与规范，prompt 偏本次具体任务）。分开导出更清晰。
 */

import { definePrompt } from "../types";

export interface GenerateDraftEvidence {
  source: string;
  text: string;
}

export interface GenerateDraftSystemInput {
  /** 暂未注入 memory/platform_rules（由 AgentRunner 的 system prompt 负责注入）；此处保持纯净 */
  _reserved?: never;
}

export interface GenerateDraftUserInput {
  task: string;
  evidence?: GenerateDraftEvidence[];
  constraints?: string;
}

/**
 * 把 evidence 数组拼成可读引用块。
 * 用 [evidence-N, source:xxx] 形式让 LLM 学到"内联标注引用"，
 * 后续 extractCitedSources 也按此格式抽。
 */
function formatEvidence(evidence: GenerateDraftEvidence[] | undefined): string {
  if (!evidence || evidence.length === 0) return "(无具体 evidence，请基于通用知识生成)";
  return evidence
    .map((e, i) => `[evidence-${i + 1}, source:${e.source}]\n${e.text}`)
    .join("\n\n");
}

export const generateDraftSystemPrompt = definePrompt<GenerateDraftSystemInput>({
  id: "tool.generate_draft.system",
  version: "v1",
  description: "generate_draft tool 的 system prompt：角色 + 引用规范",
  render: () => `你是营销文案/产品笔记的撰写助手。你的回答必须：
1) 严格基于提供的 evidence；如果 evidence 不足以支持某个论点，必须明确说明"无足够依据"。
2) 在引用 evidence 时用形如 [evidence-N] 的内联标记。
3) 用简洁、地道的中文，避免口水话；不要 emoji 除非用户明确要求。`,
});

export const generateDraftUserPrompt = definePrompt<GenerateDraftUserInput>({
  id: "tool.generate_draft.user",
  version: "v1",
  description: "generate_draft tool 的 user prompt：任务 + evidence + 硬约束",
  render: ({ task, evidence, constraints }) => {
    const constraintsLine = constraints?.trim()
      ? `\n\n硬约束（必须满足）：${constraints.trim()}`
      : "";
    return `任务：${task}${constraintsLine}

可用的 evidence：
${formatEvidence(evidence)}

请输出草稿。`;
  },
});
