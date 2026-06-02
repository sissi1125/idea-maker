/**
 * LLM-as-judge Prompt — feat-300.5
 *
 * 让一个 LLM 对 agent 的输出 candidate 做评分，三维：
 *   - faithfulness  忠实度（事实层面与参考一致，避免幻觉）
 *   - completeness  完整度（覆盖 query 关键点）
 *   - style         风格（语气 / 长度 / 受众适配）
 *
 * 设计原则：
 *   1. **强 JSON-only 输出**：直接 JSON.parse，对围栏容错由 runner 层兜底
 *   2. **打分锚点**：明确 1 / 3 / 5 分各对应什么，减少 LLM 主观漂移
 *   3. **必须给 rationale**：< 200 字简短理由，方便人工 review 与对齐分数
 *   4. **不要求模仿 reference 措辞**：reference 是基准，不是唯一正确答案；
 *      candidate 风格不同但表达同等优秀时应当给高分
 *
 * 为什么 1-5 不是 0-1：与 feedbacks 的 4 维评分量纲一致，便于后续把
 * feedback 高分项半自动并入 golden（feat-300.5 闭环）。
 */

import { definePrompt } from "../types";

export interface JudgePromptInput {
  query: string;
  reference: string;
  candidate: string;
}

export const judgePrompt = definePrompt<JudgePromptInput>({
  id: "eval.judge",
  version: "v1",
  description: "对 agent 输出做 faithfulness/completeness/style 三维 1-5 打分",
  render: ({ query, reference, candidate }) => `你是一位严格但公正的内容评审。请对「候选答案」相对「参考答案」做三维打分，并给出简短理由。

## 用户提问
${query}

## 参考答案（基准）
${reference}

## 候选答案（待评分）
${candidate}

## 评分维度（每项 1-5 整数）
- **faithfulness**（事实忠实度）：候选是否与参考的事实信息一致？是否引入未在参考中出现的虚构数据 / 名称 / 数字？
  - 1=明显幻觉、捏造关键事实
  - 3=主要事实一致，存在不准确细节
  - 5=完全忠实，所有可核实事实均与参考一致
- **completeness**（完整度）：候选是否覆盖参考中所有关键信息点？
  - 1=遗漏大半关键点
  - 3=覆盖主要点，有可见遗漏
  - 5=关键点全覆盖
- **style**（风格适配）：候选的语气 / 长度 / 句式是否合适该 query 场景？
  - 1=风格严重错位（如严肃 query 用网络梗）
  - 3=风格基本得体，有小幅不协调
  - 5=风格与 query 高度匹配

## 重要约定
- 候选不必模仿参考的措辞。**只要表达力相当、信息正确，措辞不同也给 5 分。**
- 短文案宁可惜字如金，不要因「比参考短」就降 completeness——看是否漏关键点。
- 给分必须有依据，**rationale 字段简述 1~2 句**（< 200 字）。

## 输出格式
**仅返回 JSON**，禁止 markdown 围栏 / 前后说明：

{"faithfulness":4,"completeness":5,"style":4,"rationale":"忠实度高但定价数据未提及；其他维度优秀。"}`,
});
