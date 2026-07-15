/**
 * useAgentRun — feat-300.6 任务 2
 *
 * 在 useEventSourceWithReplay 之上薄薄一层，专门给 AgentTracePanel 用：
 *   - 把 step 帧 + history 步骤合并成有序数组（按 stepIndex 升序）
 *   - 监听 cost 帧 → 暴露 costUsedUsd / percentBudget
 *   - 监听 finish 帧 → 暴露 finishReason / finalText / runStatus='succeeded'
 *   - 监听 error 帧 → 暴露 errorMessage / runStatus='failed'
 *
 * 调用方提供 { projectId, runId, token }；runId 为空 → enabled=false（不订阅）。
 */

"use client";

import { useMemo, useState, useCallback } from "react";
import {
  connectAgentSSE,
  getSteps,
  type AgentStepRow,
  type StepFramePayload,
  type CostFramePayload,
  type FinishFramePayload,
  type ErrorFramePayload,
  type AgentFinishReason,
  type AgentRunStatus,
} from "@/lib/api/agent";
import {
  useEventSourceWithReplay,
  type SseStatus,
} from "./useEventSourceWithReplay";

export interface UseAgentRunArgs {
  projectId: string;
  runId: string | null;
  token: string | null;
  /** 用于 budget 进度条；后端 budget_usd 默认 0.2 */
  budgetUsd?: number;
}

/** UI 渲染统一形态：history (AgentStepRow) 和 SSE (StepFramePayload) 字段对齐 */
export interface UnifiedStep {
  stepIndex: number;
  stepType: AgentStepRow["stepType"];
  toolName: string | null;
  input: unknown;
  output: unknown;
  durationMs: number | null;
}

export interface UseAgentRunResult {
  /** 有序 step 列表（按 stepIndex 升序），正序展示 */
  steps: UnifiedStep[];
  /** 连接层状态（SSE 自身） */
  sseStatus: SseStatus;
  /** Run 业务状态：先看 finishReason，再 fallback 到 sseStatus */
  runStatus: AgentRunStatus | "idle";
  /** budget 累计 */
  costUsedUsd: number;
  /** 0-100，可超 100（说明超 budget 触发 fallback） */
  percentBudget: number;
  /** finish 帧拿到的最终文本（"done"/"max_steps"/"budget"/"aborted"），中途不会有 */
  finalText: string | null;
  finishReason: AgentFinishReason | null;
  errorMessage: string | null;
  /** SSE 异常时用户点"重试" */
  reconnect: () => void;
  reconnectAttempts: number;
}

interface AgentAuxState {
  runId: string | null;
  costUsedUsd: number;
  percentBudget: number;
  finalText: string | null;
  finishReason: AgentFinishReason | null;
  errorMessage: string | null;
}

const EMPTY_AUX_STATE: AgentAuxState = {
  runId: null,
  costUsedUsd: 0,
  percentBudget: 0,
  finalText: null,
  finishReason: null,
  errorMessage: null,
};

export function useAgentRun(args: UseAgentRunArgs): UseAgentRunResult {
  const { projectId, runId, token, budgetUsd = 0.2 } = args;

  // ── 辅助状态（cost / finish / error 不进 entries Map） ──
  // 辅助状态带所属 runId，切换 run 时旧 error/finalText 不会污染新一轮重试。
  const [auxState, setAuxState] = useState<AgentAuxState>(EMPTY_AUX_STATE);
  const activeAux = auxState.runId === runId ? auxState : EMPTY_AUX_STATE;
  const { costUsedUsd, percentBudget, finalText, finishReason, errorMessage } = activeAux;

  // 稳定引用：connect / fetchHistory 在 runId/token 变化时才重建
  const connect = useCallback(() => {
    if (!runId || !token) throw new Error("connect 缺少 runId / token");
    return connectAgentSSE(projectId, runId, token);
  }, [projectId, runId, token]);

  const fetchHistory = useCallback(async (): Promise<StepFramePayload[]> => {
    if (!runId) return [];
    const rows = await getSteps(projectId, runId, { limit: 200 });
    // history → SSE 帧形态对齐
    return rows.map((r) => ({
      runId: r.runId,
      stepIndex: r.stepIndex,
      stepType: r.stepType,
      toolName: r.toolName ?? undefined,
      input: r.input,
      output: r.output,
      durationMs: r.durationMs ?? undefined,
    }));
  }, [projectId, runId]);

  const onAux = useCallback(
    (e: MessageEvent) => {
      const t = e.type;
      try {
        const data = JSON.parse(e.data);
        if (t === "cost") {
          const c = data as CostFramePayload;
          setAuxState((previous) => ({
            ...(previous.runId === runId ? previous : EMPTY_AUX_STATE),
            runId,
            costUsedUsd: c.usedUsd,
            percentBudget: c.percentBudget,
          }));
        } else if (t === "error") {
          const err = data as ErrorFramePayload;
          setAuxState((previous) => ({
            ...(previous.runId === runId ? previous : EMPTY_AUX_STATE),
            runId,
            errorMessage: err.message,
          }));
        }
      } catch {
        /* 忽略解析失败 */
      }
    },
    [runId],
  );

  const onFinish = useCallback((e: MessageEvent) => {
    try {
      const f = JSON.parse(e.data) as FinishFramePayload;
      setAuxState((previous) => ({
        ...(previous.runId === runId ? previous : EMPTY_AUX_STATE),
        runId,
        finalText: f.text,
        finishReason: f.finishReason,
        costUsedUsd: f.costUsedUsd,
      }));
    } catch {
      /* 忽略 */
    }
  }, [runId]);

  const { entries, status: sseStatus, reconnect, reconnectAttempts } = useEventSourceWithReplay<StepFramePayload>(
    {
      enabled: !!(runId && token),
      connect,
      fetchHistory,
      getEntryKey: (e) => e.stepIndex,
      isEntryEvent: (t) => t === "step" || t === "message",
      onAux,
      onFinish,
    },
  );

  // ── 派生：steps 有序数组 + runStatus ─────────────────────────────
  const steps = useMemo<UnifiedStep[]>(() => {
    return Array.from(entries.values())
      // 通用 SSE hook 的 Map 会保留旧连接历史；按 runId 过滤保证重试不显示上一轮步骤。
      .filter((entry) => entry.runId === runId)
      .map((e) => ({
        stepIndex: e.stepIndex,
        stepType: e.stepType,
        toolName: e.toolName ?? null,
        input: e.input,
        output: e.output,
        durationMs: e.durationMs ?? null,
      }))
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }, [entries, runId]);

  const runStatus = useMemo<AgentRunStatus | "idle">(() => {
    if (!runId) return "idle";
    if (errorMessage) return "failed";
    if (finishReason === "error") return "failed";
    if (finishReason) return "succeeded";
    return "running";
  }, [runId, errorMessage, finishReason]);

  // 派生 percentBudget 兜底：若 cost 帧未到，按 costUsedUsd / budgetUsd 估
  const effectivePercent = useMemo(() => {
    if (percentBudget > 0) return percentBudget;
    if (budgetUsd <= 0) return 0;
    return (costUsedUsd / budgetUsd) * 100;
  }, [percentBudget, costUsedUsd, budgetUsd]);

  return {
    steps,
    sseStatus,
    runStatus,
    costUsedUsd,
    percentBudget: effectivePercent,
    finalText,
    finishReason,
    errorMessage,
    reconnect,
    reconnectAttempts,
  };
}
