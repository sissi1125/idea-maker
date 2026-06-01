/**
 * MemoryRow — feat-300.6 任务 8
 *
 * 单条 agent_memory 的行内展示 + 编辑 + 删除。
 *
 * 编辑策略（plan §3.6 决策）：
 *   - **悲观更新**：保存按钮 disabled + spinner → API 200 后更新行
 *   - 理由：memory 写入是低频 + 后端会校验（confidence 0-1 / kind 合法），乐观更新成本大
 *
 * 删除：二次确认 inline confirm（与 AgentAbortButton 同模式，避免 modal 杀鸡用牛刀）
 */

"use client";

import { useState } from "react";
import { Edit3, Trash2, Check, X, Loader2 } from "lucide-react";
import { memoryApi, type MemoryRow as MemoryRowType } from "@/lib/api";
import { KindBadge } from "./KindBadge";

interface MemoryRowProps {
  projectId: string;
  row: MemoryRowType;
  onUpdated: (next: MemoryRowType) => void;
  onDeleted: (id: string) => void;
}

export function MemoryRow({ projectId, row, onUpdated, onDeleted }: MemoryRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.content);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(row.content);
    setEditing(true);
    setError(null);
  };
  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (!draft.trim()) {
      setError("内容不能为空");
      return;
    }
    if (draft.trim() === row.content) {
      // 无变化直接退出编辑
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await memoryApi.updateMemory(projectId, row.id, { content: draft.trim() });
      onUpdated(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await memoryApi.deleteMemory(projectId, row.id);
      onDeleted(row.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="flex items-start gap-2 py-2 px-3 hover:bg-gray-50 group rounded">
      <KindBadge kind={row.kind} compact />
      <div className="flex-1 min-w-0">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full text-sm border rounded p-1.5 resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
            placeholder="编辑偏好内容"
            disabled={busy}
            autoFocus
          />
        ) : (
          <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">{row.content}</div>
        )}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
          <span title="0~1，注入 system prompt 时需 >= 0.5">
            置信度 {row.confidence.toFixed(2)}
          </span>
          <span>·</span>
          <span title="manual=用户手动；distilled=AI 蒸馏">
            {row.source === "manual" ? "手动" : "AI 学习"}
          </span>
          {row.source === "distilled" && row.sourceFeedbackIds.length > 0 && (
            <span title={row.sourceFeedbackIds.join("\n")}>
              · 来自 {row.sourceFeedbackIds.length} 条反馈
            </span>
          )}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>

      {/* 操作区 */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              保存
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={busy}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded text-gray-600 hover:bg-gray-100"
            >
              <X size={12} />
              取消
            </button>
          </>
        ) : confirmingDelete ? (
          <>
            <span className="text-xs text-red-700">删除？</span>
            <button
              type="button"
              onClick={doDelete}
              disabled={busy}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded text-gray-600 hover:bg-gray-100"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={startEdit}
              title="编辑"
              className="p-1 rounded text-gray-500 hover:bg-gray-200"
            >
              <Edit3 size={13} />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              title="删除"
              className="p-1 rounded text-gray-500 hover:bg-red-100 hover:text-red-700"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
