/**
 * Campaign 内容生成 · 纯函数层 — feat-400.4
 *
 * prompt 构造、LLM 输出解析（Zod）、以及最关键的 grounding：
 * 生成的角度只能引用"本次允许 + 已批准"的卖点，越界引用一律剔除。
 */

import { z } from "zod";

export interface AllowedClaim {
  id: string;
  text: string;
}

export interface CampaignBriefLite {
  goal: string;
  targetAudience?: string | null;
  scenario?: string | null;
  platform?: string | null;
  maxLength?: number | null;
  cta?: string | null;
  avoidNotes?: string | null;
}

const VariantSchema = z.object({
  angle: z.string().min(1).max(100),
  hook: z.string().max(300).default(""),
  body: z.string().min(1).max(3000),
  cta: z.string().max(200).default(""),
  claimIds: z.array(z.string()).default([]),
});
const GenSchema = z.object({ variants: z.array(VariantSchema).default([]) });
export type GeneratedVariant = z.infer<typeof VariantSchema>;

const GOAL_LABEL: Record<string, string> = {
  launch: "产品发布",
  feature_update: "功能更新",
  acquisition: "获客测试",
  messaging: "官网表达梳理",
};

/** 构造生成 prompt：给定 Brief + 允许卖点，要 LLM 产出 N 个不同角度 */
export function buildGenerationPrompt(
  brief: CampaignBriefLite,
  allowedClaims: AllowedClaim[],
  count: number,
): string {
  const claimsBlock = allowedClaims.length
    ? allowedClaims.map((c) => `[claim_id: ${c.id}] ${c.text}`).join("\n")
    : "（本次没有可用卖点，只能写不含具体产品主张的表达）";
  return [
    `你是营销文案助手。为一次「${GOAL_LABEL[brief.goal] ?? brief.goal}」传播任务，写 ${count} 个**角度不同、可比较**的文案。`,
    "",
    `目标受众：${brief.targetAudience || "未指定"}`,
    `使用场景：${brief.scenario || "未指定"}`,
    `平台：${brief.platform || "通用"}${brief.maxLength ? `（正文尽量不超过 ${brief.maxLength} 字）` : ""}`,
    `CTA：${brief.cta || "未指定"}`,
    brief.avoidNotes ? `要避免：${brief.avoidNotes}` : "",
    "",
    "只能引用下面列出的卖点（用 claim_id 标注）：",
    claimsBlock,
    "",
    "输出规则：",
    "1. 只输出 JSON：{\"variants\":[{\"angle\":\"...\",\"hook\":\"...\",\"body\":\"...\",\"cta\":\"...\",\"claimIds\":[\"claim_id\"]}]}。",
    `2. 恰好 ${count} 个角度，彼此切入点不同（如：痛点切入 / 场景切入 / 对比切入）。`,
    "3. claimIds 只能是上面出现过的 claim_id；宁可不引用，也不要编造卖点或产品事实。",
    "4. 正文里的具体数字/价格必须来自所引用卖点，不要杜撰。",
  ].filter(Boolean).join("\n");
}

/** 解析 + Zod 校验 LLM 输出（剥 ```json fence，容错截取） */
export function parseVariants(text: string): GeneratedVariant[] {
  const stripped = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    const s = stripped.indexOf("{");
    const e = stripped.lastIndexOf("}");
    if (s === -1 || e === -1) return [];
    try {
      json = JSON.parse(stripped.slice(s, e + 1));
    } catch {
      return [];
    }
  }
  // 真实模型常把结果多包一层数组：[{variants:[...]}] 或直接 [ ...角度对象 ]，统一拆包。
  if (Array.isArray(json)) {
    const arr = json as unknown[];
    json = arr.length && arr[0] && typeof arr[0] === "object" && "variants" in (arr[0] as object)
      ? { variants: arr.flatMap((o) => (o as { variants?: unknown[] }).variants ?? []) }
      : { variants: arr };
  }
  const parsed = GenSchema.safeParse(json);
  return parsed.success ? parsed.data.variants : [];
}

/**
 * grounding：把每个角度的 claimIds 收敛到"允许集合"内，剔除越界/幻觉引用。
 * allowedIds = 本次 campaign 允许 ∩ 已批准。返回净化后的角度。
 */
export function groundVariants(
  variants: GeneratedVariant[],
  allowedIds: Set<string>,
): Array<GeneratedVariant & { droppedClaimIds: string[] }> {
  return variants.map((v) => {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const id of v.claimIds ?? []) {
      if (allowedIds.has(id)) kept.push(id);
      else dropped.push(id);
    }
    return { ...v, claimIds: kept, droppedClaimIds: dropped };
  });
}
