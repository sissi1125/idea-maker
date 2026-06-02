/**
 * MemoryPanel — feat-300.6 任务 8
 *
 * Settings 页「AI 学到的偏好」Tab 主入口。
 *
 * UI 结构（plan §3.7 决策）：
 *   ┌─────────────────────────────────────────────┐
 *   │ Header：上次自动学习于 X 前 + 计数            │
 *   ├─────────────────────────────────────────────┤
 *   │ ▸ 禁忌 taboo（按 kind 分组列表）              │
 *   │ ▸ 受众 audience                              │
 *   │ ▸ 风格 style                                 │
 *   │ ▸ 偏好 preference                            │
 *   ├─────────────────────────────────────────────┤
 *   │ ＋ 手动添加偏好                              │
 *   ├─────────────────────────────────────────────┤
 *   │ 〈 高级 — 立即蒸馏 〉折叠区（默认收起）         │
 *   └─────────────────────────────────────────────┘
 *
 * **关键设计**：Distill 按钮藏在高级折叠区（plan §3.7）：
 *   - 蒸馏是 AI 的内务（类似 GC），暴露给用户管会增加认知负担
 *   - 顶部只展示「上次自动学习于 X 前」，让用户感知"AI 在自动学"
 *   - 暴露按钮 ≠ 必须做主入口
 */

"use client";

import { useEffect, useState } from "react";
import { Brain, Plus, ChevronDown, ChevronRight, Loader2, Wand2 } from "lucide-react";
import {
  memoryApi,
  MEMORY_KINDS,
  type MemoryRow as MemoryRowType,
  type MemoryKind,
  type DistillResult,
} from "@/lib/api";
import { KindBadge, KIND_ORDER } from "./KindBadge";
import { MemoryRow } from "./MemoryRow";

interface MemoryPanelProps {
  projectId: string;
}

export function MemoryPanel({ projectId }: MemoryPanelProps) {
  const [rows, setRows] = useState<MemoryRowType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 加载列表
  useEffect(() => {
    let cancelled = false;
    memoryApi
      .listMemory(projectId)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err) => {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 派生：顶部"上次学习于" + 按 kind 分组
  const lastLearnedAt = derivedLastLearnedAt(rows);
  const grouped = derivedGroupBy(rows);

  // Distill UI 状态
  const [distillOpen, setDistillOpen] = useState(false);
  const [distillBusy, setDistillBusy] = useState(false);
  const [distillCooldown, setDistillCooldown] = useState(false);
  const [distillToast, setDistillToast] = useState<{ tone: "ok" | "info" | "warn" | "neutral"; text: string } | null>(null);

  // Create 表单
  const [creating, setCreating] = useState(false);

  const handleUpdated = (next: MemoryRowType) => {
    setRows((prev) => prev?.map((r) => (r.id === next.id ? next : r)) ?? null);
  };
  const handleDeleted = (id: string) => {
    setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
  };
  const handleCreated = (newRow: MemoryRowType) => {
    setRows((prev) => (prev ? [newRow, ...prev] : [newRow]));
    setCreating(false);
  };

  const runDistill = async () => {
    if (distillBusy || distillCooldown) return;
    setDistillBusy(true);
    setDistillToast(null);
    try {
      const r = await memoryApi.distillMemory(projectId);
      setDistillToast(formatDistillToast(r));
      // 不论结果，刷新列表（即便没新增也要刷新 last_distilled_at）
      if (r.triggered || r.skipped === "no_candidates") {
        memoryApi.listMemory(projectId).then(setRows).catch(() => undefined);
      }
    } catch (err) {
      setDistillToast({
        tone: "warn",
        text: err instanceof Error ? err.message : "蒸馏失败",
      });
    } finally {
      setDistillBusy(false);
      // 5s cooldown 防止狂点（与 plan §3.7 一致）
      setDistillCooldown(true);
      setTimeout(() => setDistillCooldown(false), 5000);
    }
  };

  if (loadError) {
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
        加载失败：{loadError}
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="text-sm text-gray-500 inline-flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" />
        加载中…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="space-y-1">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
          <Brain size={16} className="text-purple-600" />
          AI 学到的偏好
        </h2>
        <p className="text-xs text-gray-500">
          每次你给 feedback（评分 / 编辑改写），AI 会自动学习并形成下方偏好。下次生成时会主动遵守。
          {lastLearnedAt && (
            <>
              {" "}
              <span className="text-gray-700">
                · 上次自动学习于 {formatRelativeTime(lastLearnedAt)}
              </span>
            </>
          )}
          {rows.length > 0 && (
            <>
              {" "}
              · 共 <b>{rows.length}</b> 条
            </>
          )}
        </p>
      </header>

      {/* 4 个 kind 分组 */}
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400 italic p-4 border border-dashed rounded">
          还没有学到任何偏好。试着给几条 generation 评分或改写，AI 累计 5 条后会自动学习。
        </div>
      ) : (
        <div className="space-y-3">
          {KIND_ORDER.map((kind) => {
            const items = grouped[kind] ?? [];
            if (items.length === 0) return null;
            return (
              <KindSection
                key={kind}
                kind={kind}
                items={items}
                projectId={projectId}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            );
          })}
        </div>
      )}

      {/* 手动添加 */}
      {creating ? (
        <CreateForm
          projectId={projectId}
          onCancel={() => setCreating(false)}
          onCreated={handleCreated}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-900"
        >
          <Plus size={14} />
          手动添加一条偏好
        </button>
      )}

      {/* 高级折叠区 — 手动蒸馏 */}
      <details
        open={distillOpen}
        onToggle={(e) => setDistillOpen((e.target as HTMLDetailsElement).open)}
        className="text-sm border-t pt-3"
      >
        <summary className="cursor-pointer select-none inline-flex items-center gap-1 text-gray-500 hover:text-gray-800 list-none">
          {distillOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          高级
        </summary>
        <div className="mt-2 pl-5 space-y-2">
          <p className="text-xs text-gray-500 max-w-md">
            通常无需手动触发——每 5 条新 feedback AI 会自动学习。手动按钮用于演示 / 调试。
          </p>
          <button
            type="button"
            onClick={runDistill}
            disabled={distillBusy || distillCooldown}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={distillCooldown ? "请等 5 秒" : "立即从最近的 feedback 蒸馏偏好"}
          >
            {distillBusy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {distillBusy ? "蒸馏中…" : "立即蒸馏一次"}
          </button>
          {distillToast && (
            <div className={`text-xs ${TONE_CLASS[distillToast.tone]}`}>
              {distillToast.text}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function KindSection({
  kind,
  items,
  projectId,
  onUpdated,
  onDeleted,
}: {
  kind: MemoryKind;
  items: MemoryRowType[];
  projectId: string;
  onUpdated: (next: MemoryRowType) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <KindBadge kind={kind} />
        <span className="text-xs text-gray-400">{items.length} 条</span>
      </div>
      <div className="border rounded divide-y bg-white">
        {items.map((r) => (
          <MemoryRow
            key={r.id}
            projectId={projectId}
            row={r}
            onUpdated={onUpdated}
            onDeleted={onDeleted}
          />
        ))}
      </div>
    </section>
  );
}

function CreateForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: string;
  onCancel: () => void;
  onCreated: (row: MemoryRowType) => void;
}) {
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!content.trim()) {
      setError("内容不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await memoryApi.createMemory(projectId, { kind, content: content.trim() });
      onCreated(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setBusy(false);
    }
  };

  return (
    <div className="border rounded p-3 bg-emerald-50/40 space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600">类型：</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as MemoryKind)}
          disabled={busy}
          className="text-sm border rounded px-2 py-0.5 bg-white"
        >
          {MEMORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="例：短句为主，单句不超过 25 字"
        disabled={busy}
        className="w-full text-sm border rounded p-2 resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
        autoFocus
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs px-2 py-1 rounded text-gray-600 hover:bg-gray-100"
        >
          取消
        </button>
      </div>
    </div>
  );
}

function derivedLastLearnedAt(rows: MemoryRowType[] | null): string | null {
  if (!rows) return null;
  let max: string | null = null;
  for (const r of rows) {
    if (r.lastDistilledAt && (!max || r.lastDistilledAt > max)) {
      max = r.lastDistilledAt;
    }
  }
  return max;
}

function derivedGroupBy(rows: MemoryRowType[] | null): Record<MemoryKind, MemoryRowType[]> {
  const out: Record<MemoryKind, MemoryRowType[]> = {
    preference: [],
    style: [],
    taboo: [],
    audience: [],
  };
  if (!rows) return out;
  for (const r of rows) out[r.kind].push(r);
  return out;
}

const TONE_CLASS = {
  ok: "text-emerald-700",
  info: "text-gray-500",
  warn: "text-amber-700",
  neutral: "text-gray-600",
} as const;

/**
 * Distill 返回 4 态映射到 toast 文案 + 色调（plan §3.7）：
 *   - { triggered: true, inserted, merged, ... }       → 成功
 *   - { triggered: false, skipped: "no_new_feedback" } → 灰提示
 *   - { triggered: false, skipped: "in_flight" }       → 警告
 *   - { triggered: true,  skipped: "no_candidates" }   → 中性
 */
function formatDistillToast(r: DistillResult): { tone: "ok" | "info" | "warn" | "neutral"; text: string } {
  if (r.skipped === "no_new_feedback") {
    return { tone: "info", text: "暂无新的 feedback 可以学习（≥ 5 条才会自动触发）" };
  }
  if (r.skipped === "in_flight") {
    return { tone: "warn", text: "正在进行中——稍后再试" };
  }
  if (r.skipped === "no_candidates") {
    return {
      tone: "neutral",
      text: `分析了 ${r.processed ?? 0} 条反馈，但 AI 没找到稳定的偏好模式`,
    };
  }
  // triggered: true, has inserted/merged
  const ins = r.inserted ?? 0;
  const mer = r.merged ?? 0;
  if (ins === 0 && mer === 0) {
    return { tone: "neutral", text: "完成，但本次未新增也未合并" };
  }
  return {
    tone: "ok",
    text: `学习完成：新增 ${ins} 条 / 合并 ${mer} 条（共分析 ${r.processed ?? "?"} 条反馈）`,
  };
}

/** 简易相对时间（与现有项目其他地方风格一致） */
function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return iso;
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  return `${d} 天前`;
}
