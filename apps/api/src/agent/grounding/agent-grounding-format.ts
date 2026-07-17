/** Agent Grounding 的纯格式化函数：outer prompt 与 nested tool 共用，避免两套事实文本漂移。 */
import type {
  AgentGroundingContext,
  GroundedBriefField,
} from "./agent-grounding.types";

/** JSONB 字段值转成稳定中文文本；数组保持顺序，对象用 JSON 防止隐式 [object Object]。 */
export function formatGroundingValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("、");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "").trim();
}

/** 单个 confirmed 字段的可追溯文本，保留 field ID 与 evidence chunk IDs。 */
export function formatGroundedField(field: GroundedBriefField): string {
  const evidence = field.evidenceChunkIds.length > 0
    ? `；evidence=${field.evidenceChunkIds.join(",")}`
    : "；依据=用户确认";
  return `- [brief-field:${field.id}] ${field.group}.${field.key}：${formatGroundingValue(field.value)}${evidence}`;
}

/**
 * outer Agent 与 generate/refine 子模型共用的完整事实文本。
 * Auto-generation 摘要不在这里，防止派生内容覆盖 Product Brief。
 */
export function formatAgentGroundingContext(ctx: AgentGroundingContext): string {
  if (!ctx.briefId || ctx.confirmedFields.length === 0) {
    return `[Product Brief 事实]
当前项目没有可用的 Confirmed Product Brief。禁止生成产品卖点、功能、价格、受众或场景；
只能说明“产品信息不足”，并提示用户先确认 Product Brief。`;
  }

  const fields = ctx.confirmedFields.map(formatGroundedField).join("\n");
  const claims = ctx.approvedClaims.length > 0
    ? ctx.approvedClaims
        .map((claim) => {
          const evidence = claim.evidenceChunkIds.length > 0
            ? `；evidence=${claim.evidenceChunkIds.join(",")}`
            : "";
          return `- [claim:${claim.id}] ${claim.text}${evidence}`;
        })
        .join("\n")
    : "- 暂无 Approved Claims；只能忠实改写下方 confirmed 字段，不得扩展新卖点。";

  const evidence = ctx.evidenceChunks.length > 0
    ? `- 已在服务端加载 ${ctx.evidenceChunks.length} 个 evidence chunk 用于审计；原文不注入生成模型，避免同一 chunk 中未确认事实绕过 Product Brief。\n- 可追溯 chunk IDs 已列在对应 brief field / claim 的 evidence 属性中。`
    : "- 无 chunk 原文；无 evidence 的 confirmed 字段均来自用户确认。";

  return `[Product Brief 事实]
brief_id=${ctx.briefId}；version=${ctx.briefVersion}
以下只有 confirmed 字段，candidate/stale/rejected 已被服务端排除：
${fields}

[Approved Claims]
${claims}

[RAG Evidence]
${evidence}`;
}

/** 给 generate_draft 引用解析使用的服务端 evidence，模型不能通过 tool 参数删除。 */
export function buildServerGroundingEvidence(
  ctx: AgentGroundingContext,
): Array<{ source: string; text: string }> {
  const fields = ctx.confirmedFields.map((field) => ({
    source: `brief-field:${field.id}`,
    text: `${field.group}.${field.key}：${formatGroundingValue(field.value)}`,
  }));
  const claims = ctx.approvedClaims.map((claim) => ({
    source: `claim:${claim.id}`,
    text: claim.text,
  }));
  // 不把 raw chunks 作为生成 evidence：一个 chunk 可能同时含 confirmed 与 candidate 事实。
  // 字段值本身是裁决后的事实，且 formatGroundedField 已保留其 chunk IDs 做 provenance。
  return [...fields, ...claims];
}
