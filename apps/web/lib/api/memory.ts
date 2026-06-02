/**
 * Memory API client — feat-300.6 任务 0
 *
 * 对接后端 MemoryController：
 *   GET    /projects/:pid/memory             列表
 *   POST   /projects/:pid/memory             手动新增
 *   PATCH  /projects/:pid/memory/:memoryId   编辑
 *   DELETE /projects/:pid/memory/:memoryId   删除
 *   POST   /projects/:pid/memory/distill     手动触发蒸馏
 *
 * Distill 返回的「四态语义」（plan §3.7）：
 *   { triggered: true, inserted: X, merged: Y, processed: N }       → 真的跑了
 *   { triggered: false, skipped: "no_new_feedback" }                → 没新 feedback
 *   { triggered: false, skipped: "in_flight" }                      → 已在跑
 *   { triggered: true, skipped: "no_candidates", processed: N }     → LLM 说无可蒸
 *
 * UI 层根据 triggered + skipped 字段映射到 4 种 toast。
 */

import { apiFetch } from "./client";

export const MEMORY_KINDS = ["preference", "style", "taboo", "audience"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemorySource = "manual" | "distilled";

export interface MemoryRow {
  id: string;
  projectId: string;
  kind: MemoryKind;
  content: string;
  source: MemorySource;
  sourceFeedbackIds: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
  lastDistilledAt: string | null;
}

export interface CreateMemoryInput {
  kind: MemoryKind;
  content: string;
  confidence?: number;
}

export interface UpdateMemoryInput {
  kind?: MemoryKind;
  content?: string;
  confidence?: number;
}

export interface DistillResult {
  triggered: boolean;
  inserted?: number;
  merged?: number;
  processed?: number;
  /** 'no_new_feedback' | 'in_flight' | 'no_candidates' */
  skipped?: string;
}

export async function listMemory(projectId: string): Promise<MemoryRow[]> {
  const res = await apiFetch<{ memory: MemoryRow[] }>(`/projects/${projectId}/memory`);
  return res.memory;
}

export async function createMemory(
  projectId: string,
  body: CreateMemoryInput,
): Promise<MemoryRow> {
  const res = await apiFetch<{ memory: MemoryRow }>(`/projects/${projectId}/memory`, {
    method: "POST",
    body,
  });
  return res.memory;
}

export async function updateMemory(
  projectId: string,
  memoryId: string,
  body: UpdateMemoryInput,
): Promise<MemoryRow> {
  const res = await apiFetch<{ memory: MemoryRow }>(
    `/projects/${projectId}/memory/${memoryId}`,
    { method: "PATCH", body },
  );
  return res.memory;
}

export async function deleteMemory(projectId: string, memoryId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/memory/${memoryId}`, { method: "DELETE" });
}

/** 手动触发蒸馏（高级折叠区按钮调用，plan §3.7） */
export async function distillMemory(projectId: string): Promise<DistillResult> {
  const res = await apiFetch<{ result: DistillResult }>(
    `/projects/${projectId}/memory/distill`,
    { method: "POST" },
  );
  return res.result;
}
