/**
 * Memory Distill Prompt — feat-300.4
 *
 * 把一批 feedback（含评分 / 评论 / edit_diff）压缩成 0~N 条结构化「用户偏好」候选，
 * 后端 upsert 进 agent_memory，下次 AgentRunner 起跑时由 MemoryReader 注入 system prompt。
 *
 * 设计要点：
 *   1. **edit_diff 是核心信号**：用户主动改文案的地方，说明原 LLM 输出"不合用户意"。
 *      diff 里能稳定看出"用户偏好 vs LLM 习惯"的差异，比单纯打分高 1 分 vs 高 2 分信息密度大很多。
 *
 *   2. **要求严格 JSON 输出**：下游直接 JSON.parse，不解析 markdown。
 *
 *   3. **confidence 范围 0~1，要求保守**：宁可少蒸馏几条也别污染 memory。
 *      reader 阈值 0.5 默认就是为了在这层 LLM "未印证早期推断" 时不注入。
 *
 *   4. **要求只输出"有跨场景复用价值的"偏好**：单条 feedback 的零碎吐槽
 *      （"这次太长了"）不进 memory；多条 feedback 印证的模式（"用户偏短句"）才进。
 *
 *   5. **不强制每次都产出**：候选可以是空数组。LLM 找不到稳定模式时返回 []。
 */

import { definePrompt } from "../types";

/** Distill 输入：一个项目的最近 N 条 feedback 批次 */
export interface DistillFeedbackItem {
  feedbackId: string;
  /** 用户原始 query（提供上下文，让 LLM 理解 feedback 针对什么） */
  query: string;
  /** 原 LLM 输出（result_notes） */
  original: string;
  /** 用户编辑后的最终文本，可空 */
  editDiff: string | null;
  /** 1-5 分四维评分，可空 */
  ratings: {
    relevance: number | null;
    accuracy: number | null;
    creativity: number | null;
    overall: number | null;
  };
  /** 用户自由文本评论 */
  comment: string | null;
}

export interface DistillPromptInput {
  feedbacks: DistillFeedbackItem[];
  /** 当前已有的 memory（避免重复蒸馏；让 LLM 知道哪些已经学过） */
  existingMemory: Array<{ kind: string; content: string }>;
}

/** LLM 期望输出形状（JSON.parse 后） */
export interface DistilledCandidate {
  kind: "preference" | "style" | "taboo" | "audience";
  content: string;
  confidence: number;
  sourceFeedbackIds: string[];
}

export interface DistilledResult {
  candidates: DistilledCandidate[];
}

export const memoryDistillPrompt = definePrompt<DistillPromptInput>({
  id: "memory.distill",
  version: "v1",
  description: "把一批 feedback（重点关注 edit_diff）压缩成结构化用户偏好候选",
  render: ({ feedbacks, existingMemory }) => {
    const memorySection =
      existingMemory.length === 0
        ? "（当前项目尚无任何已学习的偏好）"
        : existingMemory.map((m) => `- [${m.kind}] ${m.content}`).join("\n");

    const feedbacksSection = feedbacks
      .map((f, i) => {
        const ratings = formatRatings(f.ratings);
        const edit = f.editDiff?.trim()
          ? `用户改写后：${truncate(f.editDiff, 600)}`
          : "（用户未做改写）";
        const comment = f.comment?.trim() ? `用户评论：${truncate(f.comment, 200)}` : "";
        return [
          `── Feedback #${i + 1}（id=${f.feedbackId}）${ratings ? "  评分: " + ratings : ""}`,
          `用户提问：${truncate(f.query, 200)}`,
          `LLM 原文：${truncate(f.original, 600)}`,
          edit,
          comment,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    return `你是「用户偏好蒸馏器」。任务：从下面这批用户反馈中提炼出**跨场景复用价值**的稳定偏好，存入项目记忆，供未来生成时主动遵守。

## 当前已学习偏好
${memorySection}

## 本批 Feedback
${feedbacksSection}

## 提炼规则
1. **以 edit_diff 为核心信号**：用户主动改写的位置最能反映"LLM 输出 ≠ 用户意图"。从改写前后差异里推断偏好（如：改短 → 偏好简洁；删表情 → 禁忌 emoji；加 hashtag → 风格习惯）。
2. **跨场景才入**：仅一次出现的零碎抱怨不入。需多条 feedback 印证或体现明显模式。
3. **不重复**：当前已学习偏好里已有同义条目，不要再产出。
4. **kind 四类**：
   - preference: 通用偏好（如"喜欢用类比解释概念"）
   - style: 语气/句式/格式（如"短句为主，避免长复合句"）
   - taboo: 绝对禁止做的（如"不要用任何 emoji"）
   - audience: 目标受众画像（如"主要面向母婴用户，避免专业术语"）
5. **confidence**：0~1 之间小数；单条 feedback 推断给 0.4~0.6；多条印证给 0.7~0.85；极强信号（明确禁忌 / 多次改同一处）给 0.9。**找不到稳定模式时返回空数组**。
6. **sourceFeedbackIds**：本条偏好来自哪几条 feedback id 的数组，至少 1 个。

## 输出要求
**仅返回 JSON**，禁止 markdown 围栏、禁止前后解释文字。形如：

{"candidates":[{"kind":"style","content":"短句为主，单句尽量不超过 25 字","confidence":0.7,"sourceFeedbackIds":["xxx","yyy"]}]}

如无可提炼偏好，返回 {"candidates":[]}.`;
  },
});

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatRatings(r: DistillFeedbackItem["ratings"]): string {
  const parts: string[] = [];
  if (r.relevance != null) parts.push(`相关=${r.relevance}`);
  if (r.accuracy != null) parts.push(`准确=${r.accuracy}`);
  if (r.creativity != null) parts.push(`创意=${r.creativity}`);
  if (r.overall != null) parts.push(`整体=${r.overall}`);
  return parts.join(" ");
}
