import type { CampaignDetail } from "@/lib/api/campaigns";

export type ContentWorkflowState =
  | "drafting"
  | "ready"
  | "generating"
  | "reviewing"
  | "accepted"
  | "failed";

export interface ContentWorkflowInput {
  detail: CampaignDetail | null;
  busy: string | null;
  hasError: boolean;
}

/**
 * 内容工作流是现有 Campaign、Variant 与异步操作状态的前端投影。
 * 它不复制后端事实，只把分散的布尔条件收敛成互斥阶段，便于 UI 稳定渲染。
 */
export function deriveContentWorkflow({ detail, busy, hasError }: ContentWorkflowInput): ContentWorkflowState {
  if (hasError) return "failed";
  if (busy === "create") return "drafting";
  if (busy === "gen" || busy?.startsWith("regen-") || (busy != null && detail == null)) return "generating";
  if (!detail) return "drafting";
  if (detail.variants.some((variant) => variant.adopted)) return "accepted";
  if (detail.variants.length > 0) return "reviewing";
  return "ready";
}

/** 将六个业务状态映射到四个用户可理解的稳定步骤。 */
export function workflowStepIndex(state: ContentWorkflowState): number {
  if (state === "drafting" || state === "ready") return state === "drafting" ? 0 : 1;
  if (state === "generating") return 1;
  if (state === "reviewing" || state === "failed") return 2;
  return 3;
}
