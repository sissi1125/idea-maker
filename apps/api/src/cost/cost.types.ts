/**
 * Cost 模块类型 — feat-200.4 Week 4
 */

export interface CostDailyRow {
  day: string; // YYYY-MM-DD
  generationsCount: number;
  llmTokensPrompt: number;
  llmTokensCompletion: number;
  embeddingCalls: number;
  retrievalCalls: number;
  rerankerCalls: number;
  costUsd: number;
}

export interface CostSummaryResponse {
  projectId: string;
  range: { from: string; to: string }; // YYYY-MM-DD
  totals: Omit<CostDailyRow, "day">;
  daily: CostDailyRow[];
}
