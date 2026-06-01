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

export function useAgentRun(args: UseAgentRunArgs): UseAgentRunResult {
  const { projectId, runId, token, budgetUsd = 0.2 } = args;

  // ── 辅助状态（cost / finish / error 不进 entries Map） ──
  const [costUsedUsd, setCostUsedUsd] = useState(0);
  const [percentBudget, setPercentBudget] = useState(0);
  const [finalText, setFinalText] = useState<string | null>(null);
  const [finishReason, setFinishReason] = useState<AgentFinishReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
          setCostUsedUsd(c.usedUsd);
          setPercentBudget(c.percentBudget);
        } else if (t === "error") {
          const err = data as ErrorFramePayload;
          setErrorMessage(err.message);
        }
      } catch {
        /* 忽略解析失败 */
      }
    },
    [],
  );

  const onFinish = useCallback((e: MessageEvent) => {
    try {
      const f = JSON.parse(e.data) as FinishFramePayload;
      setFinalText(f.text);
      setFinishReason(f.finishReason);
      setCostUsedUsd(f.costUsedUsd);
    } catch {
      /* 忽略 */
    }
  }, []);

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
      .map((e) => ({
        stepIndex: e.stepIndex,
        stepType: e.stepType,
        toolName: e.toolName ?? null,
        input: e.input,
        output: e.output,
        durationMs: e.durationMs ?? null,
      }))
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }, [entries]);

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
