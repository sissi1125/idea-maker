/**
 * Auto-Generations API — feat-200.6 patch
 *
 * 对接后端 `/projects/:projectId/auto-generations/latest`，
 * 拉项目级"最新成功"自动卡片（intro=产品介绍，compete=竞品对比）。
 *
 * 触发由 ingestion.completed 自动完成，前端只读。
 */

import { apiFetch } from "./client";

export type AutoGenCardType = "intro" | "compete";

/**
 * 项目级最新成功 auto-gen——一条对应一种 card_type。
 *
 * resultNotes 是 LLM 生成的卡片正文（Markdown）；前端按 cardType 索引到
 * ProjectInfoCards 的对应卡里。
 */
export interface ProjectAutoGenLatest {
  cardType: AutoGenCardType;
  autoGenId: string;
  documentId: string;
  generationId: string;
  resultNotes: string | null;
  durationMs: number | null;
  costBreakdown: unknown;
  generatedAt: string;
  triggeredAt: string;
}

/**
 * 进行中或刚失败——前端用来在卡片上显示 "LLM 生成中…" 或 "上次失败" 横幅。
 * 与 ProjectAutoGenLatest 并列出现：可能旧摘要存在 + 新一轮正在跑。
 */
export interface ProjectAutoGenInFlight {
  cardType: AutoGenCardType;
  autoGenId: string;
  documentId: string;
  status: "queued" | "running" | "failed";
  triggeredAt: string;
  error: string | null;
}

export async function getLatestProjectAutoGen(
  projectId: string,
): Promise<{ items: ProjectAutoGenLatest[]; inFlight: ProjectAutoGenInFlight[] }> {
  return apiFetch<{
    items: ProjectAutoGenLatest[];
    inFlight: ProjectAutoGenInFlight[];
  }>(`/projects/${projectId}/auto-generations/latest`);
}

/**
 * 手动重新生成某一类卡片——拿最近一次该 card_type 用过的文档再跑一次。
 * 返回新的 autoGenId；前端继续靠 latest 轮询拿状态。
 */
export async function regenerateCard(
  projectId: string,
  cardType: AutoGenCardType,
): Promise<{ autoGenId: string }> {
  return apiFetch<{ autoGenId: string }>(
    `/projects/${projectId}/auto-generations/${cardType}/regenerate`,
    { method: "POST" },
  );
}
