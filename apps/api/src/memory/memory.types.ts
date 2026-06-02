/**
 * Memory 模块共享类型 — feat-300.4
 *
 * agent_memory 表的 DTO + 蒸馏候选物形状。
 * 与 agent/prompts/system/memory-injection.prompt.ts 的 MemoryKind 复用同一字面量。
 */

export const MEMORY_KINDS = ["preference", "style", "taboo", "audience"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SOURCES = ["manual", "distilled"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

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

/** 手动 CRUD 用 */
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
