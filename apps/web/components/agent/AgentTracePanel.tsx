/**
 * AgentTracePanel — feat-300.6 任务 6
 *
 * 项目最佳卖点 UI：ReAct trace 时间轴，边推边滚。
 *
 * 视觉布局：
 *   ┌──────────────────────────────────────────┐
 *   │ Header                                    │
 *   │   Agent · running · ─────── 60% │ 终止   │
 *   │   全部展开 / 全部折叠                       │
 *   ├──────────────────────────────────────────┤
 *   │ 时间轴（正序，最新在底，自动滚到底）         │
 *   │   #0 💭 思考: 我需要先了解产品...          │
 *   │   #1 🔧 search_kb 入参 (展开看 JSON)       │
 *   │   #2 📦 search_kb 返回 (展开看 JSON)       │
 *   │   #3 💭 思考: 找到了 3 条相关内容...       │
 *   │   ...                                     │
 *   │   #N 🏁 完成 (最终文案)                    │
 *   ├──────────────────────────────────────────┤
 *   │ Footer (status banner)                    │
 *   │   ⚠ 连接异常：45s 无事件 [重试]            │
 *   └──────────────────────────────────────────┘
 *
 * 自动滚到底（plan §决策表）：每次 steps 变化后 scrollIntoView({behavior:'smooth'})
 * 用户手动往上滚 → 暂停自动滚（onScroll 检测距底 > 100px 则关 sticky）
 *
 * 心跳异常 UI（plan §3.4）：sseStatus === 'reconnecting' 显示横条 + 重试按钮
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Sparkles, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { abortRun } from "@/lib/api/agent";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import { AgentStepCard } from "./AgentStepCard";
import { AgentCostBar } from "./AgentCostBar";
import { AgentAbortButton } from "./AgentAbortButton";

interface AgentTracePanelProps {
  projectId: string;
  runId: string | null;
  token: string | null;
  budgetUsd?: number;
  /** 收到 finish 帧时通知父组件（Chat 页用来追加 assistant message + 加载 generation） */
  onFinish?: (text: string) => void;
  /** 收到 error 帧时通知父组件结束 running 状态并展示可操作错误。 */
  onError?: (message: string) => void;
}

export function AgentTracePanel({
  projectId,
  runId,
  token,
  budgetUsd = 0.2,
  onFinish,
  onError,
}: AgentTracePanelProps) {
  const {
    steps,
    sseStatus,
    runStatus,
    costUsedUsd,
    percentBudget,
    finalText,
    finishReason,
    errorMessage,
    reconnect,
  } = useAgentRun({ projectId, runId, token, budgetUsd });

  // 全部展开/折叠开关（undefined = 由每张卡自己默认）
  const [forceState, setForceState] = useState<boolean | undefined>(undefined);

  // 自动滚到底：steps 变化时滚，但用户手动往上滚就停
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    if (stickToBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [steps.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distFromBottom < 100;
  };

  // finish 帧通知父组件（只在 runId 变化后第一次到达 finalText 时调）
  const notifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (finalText && runId && notifiedRef.current !== runId) {
      notifiedRef.current = runId;
      onFinish?.(finalText);
    }
  }, [finalText, runId, onFinish]);

  // error 与 finish 都是业务终态；只通知一次，避免 React 重渲染重复 toast。
  const errorNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (errorMessage && runId && errorNotifiedRef.current !== runId) {
      errorNotifiedRef.current = runId;
      onError?.(errorMessage);
    }
  }, [errorMessage, runId, onError]);

  if (!runId) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400">
        发送一条消息开始 Agent 推理
      </div>
    );
  }

  const isRunning = runStatus === "running";

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-800">
            <Sparkles size={14} className="text-purple-500" />
            Agent {statusLabel(runStatus, finishReason)}
          </span>
          <div className="flex-1" />
          {isRunning && (
            <AgentAbortButton
              active
              onAbort={async () => {
                if (runId) await abortRun(projectId, runId);
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          <AgentCostBar costUsedUsd={costUsedUsd} budgetUsd={budgetUsd} percentBudget={percentBudget} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setForceState((v) => (v === true ? undefined : true))}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded text-gray-600 hover:bg-gray-100"
          >
            <ChevronsUpDown size={12} />
            全部展开
          </button>
          <button
            type="button"
            onClick={() => setForceState((v) => (v === false ? undefined : false))}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded text-gray-600 hover:bg-gray-100"
          >
            <ChevronsDownUp size={12} />
            全部折叠
          </button>
        </div>
      </div>

      {/* 时间轴 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50/30"
      >
        {steps.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-8">
            {isRunning ? "Agent 正在启动…" : "暂无步骤"}
          </div>
        ) : (
          steps.map((s) => (
            <AgentStepCard key={s.stepIndex} step={s} forceExpanded={forceState} />
          ))
        )}
      </div>

      {/* Footer：连接异常 / 错误 banner */}
      {sseStatus === "reconnecting" && (
        <StatusBanner tone="warn">
          <AlertTriangle size={14} />
          <span>连接异常，正在重试…</span>
          <button onClick={reconnect} className="ml-auto underline text-amber-700 hover:text-amber-900">
            手动重连
          </button>
        </StatusBanner>
      )}
      {errorMessage && (
        <StatusBanner tone="error">
          <AlertTriangle size={14} />
          <span>错误：{errorMessage}</span>
        </StatusBanner>
      )}
    </div>
  );
}

function statusLabel(runStatus: ReturnType<typeof useAgentRun>["runStatus"], finishReason: string | null): string {
  if (runStatus === "idle") return "· idle";
  if (runStatus === "failed") return "· failed";
  if (runStatus === "succeeded") return `· ${finishReason ?? "done"}`;
  return "· running";
}

function StatusBanner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-red-50 border-red-200 text-red-700"
      : "bg-amber-50 border-amber-200 text-amber-800";
  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-2 border-t ${cls}`}>
      {children}
    </div>
  );
}
