/**
 * AgentAbortButton — feat-300.6 任务 5
 *
 * 终止按钮 + 二次确认弹层。
 *
 * 为什么要二次确认（plan §3.10）：
 *   - 关流 ≠ 中断 run：用户切走页面只是关连接，agent 还在烧 token
 *   - 真正的中断要走 DELETE 端点，会让 finish_reason='aborted'
 *   - 误点损失 = 已跑的步骤被定格 + 当前 LLM 请求 cancel
 *
 * 实现：
 *   - 点按钮 → 显示原地 inline confirm（不弹 modal，避免遮挡 trace）
 *   - 二次点击「确认终止」→ 调 abortRun + 立即禁用 + 5s cooldown 防重复
 *   - 5s 后自动收起（用户改主意）
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { StopCircle, X, Check } from "lucide-react";

interface AgentAbortButtonProps {
  /** 当前是否可中断（running 状态才允许） */
  active: boolean;
  /** 调用 abortRun(projectId, runId) 的 wrapper */
  onAbort: () => Promise<void>;
}

export function AgentAbortButton({ active, onAbort }: AgentAbortButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  if (!active) return null;

  const startConfirm = () => {
    setConfirming(true);
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    // 5s 后用户没确认就自动收起，免得占着位
    collapseTimerRef.current = setTimeout(() => setConfirming(false), 5000);
  };

  const cancel = () => {
    setConfirming(false);
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onAbort();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={startConfirm}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition"
      >
        <StopCircle size={14} />
        终止
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 text-xs rounded border border-red-300 bg-red-50 px-1.5 py-0.5">
      <span className="text-red-700">确认终止当前 Agent？</span>
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
      >
        <Check size={12} />
        {busy ? "中断中…" : "确认"}
      </button>
      <button
        type="button"
        onClick={cancel}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-gray-600 hover:bg-gray-100"
      >
        <X size={12} />
        取消
      </button>
    </div>
  );
}
