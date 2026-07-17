/**
 * critic_review 的 system + user prompt 模板。
 *
 * **这是本期 prompt 体系最重要的一份**：feat-300.5 离线 eval-runner 将直接
 * import 同一个 criticReviewSystemPrompt 调 render，保证在线 runtime 评估和
 * 离线 eval 的打分逻辑 1:1 一致。
 *
 * 任何对评分维度 / 阈值语义 / 输出 schema 的修改，都同时影响线上 critic_review tool
 * 和离线 eval。**修改前必须 bump version**，且评估改前后 trace 差异。
 */

import { definePrompt } from "../types";
import type { AgentGroundingContext } from "../../grounding/agent-grounding.types";
import { formatAgentGroundingContext } from "../../grounding/agent-grounding-format";

export interface CriticReviewSystemInput {
  /** 来自 platform_rules.config 的硬约束摘要 */
  platformRules: string[];
  /** 来自 agent_memory.content 的偏好列表 */
  memoryPreferences: string[];
  /** 在线 Agent 传入；离线历史评测可不传以兼容既有数据集。 */
  grounding?: AgentGroundingContext;
}

export interface CriticReviewUserInput {
  task: string;
  draft: string;
  evidence: Array<{ source: string; text: string }>;
}

export const criticReviewSystemPrompt = definePrompt<CriticReviewSystemInput>({
  id: "tool.critic_review.system",
  version: "v3",
  description:
    "LLM-as-judge 评判规则，agent 在线 runtime + 离线 eval 共用。改动前必须 bump version。",
  render: ({ platformRules, memoryPreferences, grounding }) => `你是营销/产品笔记的资深审稿编辑。任务：按 4 个维度对 draft 打 0-5 分并给出修改建议。

打分规则：
- faithfulness：draft 的每个事实声明都能被提供的 evidence 支持。无 evidence 支持的声明扣分。
- faithfulness 采用严格蕴含标准：有引用不等于有支持；draft 的语义不能比对应 Brief/Claim 更强。
  例如“隐私归用户所有”不能推出“数据绝对安全/安全有保障”，“支持 iPhone/iPad”不能推出 iCloud/Mac。
  出现这类强度升级、额外平台、额外能力时，faithfulness 必须 ≤ 2，并给出具体修改建议。
- completeness：是否完整覆盖 task 要求的所有要点。遗漏关键要点扣分。
- style：是否符合下列风格偏好。
- safety：是否违反下列硬约束。违反任一硬约束直接 0 分。

平台硬约束（safety 维度依据）：
${platformRules.length > 0 ? platformRules.map((r) => `- ${r}`).join("\n") : "(无显式硬约束)"}

用户/项目风格偏好（style 维度依据）：
${memoryPreferences.length > 0 ? memoryPreferences.map((p) => `- ${p}`).join("\n") : "(无显式偏好，按通用标准评)"}

${grounding ? formatAgentGroundingContext(grounding) : ""}

输出要求：严格按 JSON schema 输出；suggestions 每条都要具体（"把第二段开头改成XX"而不是"改改第二段"）。`,
});

export const criticReviewUserPrompt = definePrompt<CriticReviewUserInput>({
  id: "tool.critic_review.user",
  version: "v3",
  description: "critic_review tool 的 user prompt：task + evidence + draft",
  render: ({ task, evidence, draft }) => {
    const evidenceBlock = (evidence ?? [])
      .map((e, i) => `[evidence-${i + 1}, source:${e.source}]\n${e.text}`)
      .join("\n\n");
    return `Task：${task}

Evidence：
${evidenceBlock || "(无 evidence)"}

Draft：
${draft}

请按 schema 输出 4 维评分 + 违规 + 建议。`;
  },
});
