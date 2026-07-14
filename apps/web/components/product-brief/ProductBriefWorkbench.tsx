/**
 * ProductBriefWorkbench — feat-400.1 slice 3
 *
 * 产品事实档案「审核工作台」。核心交互原则（plan §3.3）：
 *   不直接展示模型总结，而是按字段组展示【候选值 + 来源 + 置信度 + 状态】，
 *   让用户逐条 确认 / 编辑 / 拒绝；顶部显式提示"缺失关键字段"和"未核实事实"。
 *
 * 事实门禁在 UI 上的体现：
 *   - 有缺失关键字段或未核实事实时，「确认整份档案」按钮禁用（后端也会拦，双保险）。
 *   - 编辑事实型字段必须填修改原因（否则保存禁用；后端同样强制）。
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText, Wand2, CheckCircle2, Pencil, XCircle, ShieldCheck,
  AlertTriangle, Loader2, Plus, RotateCcw,
} from "lucide-react";
import {
  productBriefApi,
  FACTUAL_GROUPS,
  type BriefSnapshot,
  type BriefField,
  type BriefFieldGroup,
  type BriefFieldStatus,
  type BriefFieldSource,
} from "@/lib/api";
import { ApiError } from "@/lib/api";

// 分组展示顺序 + 中文标签 + 说明
const GROUP_META: Array<{ key: BriefFieldGroup; label: string; hint: string }> = [
  { key: "identity", label: "产品身份", hint: "名称、一句话定位、类别、官网" },
  { key: "fact", label: "产品事实", hint: "功能、价格、支持范围、限制、版本" },
  { key: "audience", label: "用户与场景", hint: "目标用户、使用场景、痛点" },
  { key: "positioning", label: "定位与差异化", hint: "核心价值、差异点、竞品" },
  { key: "style", label: "表达约束", hint: "语气、常用词、禁用词、CTA 风格" },
  { key: "visual", label: "视觉系统", hint: "Logo、颜色、字体、截图" },
  { key: "constraint", label: "平台约束", hint: "长度、标签、敏感词、合规" },
];

const STATUS_META: Record<BriefFieldStatus, { label: string; cls: string }> = {
  candidate: { label: "候选", cls: "bg-gray-100 text-gray-600 border-gray-200" },
  confirmed: { label: "已确认", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "已拒绝", cls: "bg-red-50 text-red-600 border-red-200" },
  stale: { label: "待复核", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

const SOURCE_LABEL: Record<BriefFieldSource, string> = {
  document: "文档",
  website: "官网",
  user: "用户",
  historical_content: "历史内容",
  inferred: "推断",
};

function valueToText(v: unknown): string {
  if (Array.isArray(v)) return v.join("\n");
  if (v === null || v === undefined) return "";
  return String(v);
}
function textToValue(text: string): unknown {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  return lines.length > 1 ? lines : (lines[0] ?? "");
}
function renderValue(v: unknown): string {
  if (Array.isArray(v)) return v.join("、");
  if (v === null || v === undefined || v === "") return "（空）";
  return String(v);
}

interface Toast {
  tone: "ok" | "err";
  text: string;
}

export function ProductBriefWorkbench({ projectId }: { projectId: string }) {
  const [snap, setSnap] = useState<BriefSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extractBusy, setExtractBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [busyField, setBusyField] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; reason: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const flash = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await productBriefApi.getBrief(projectId);
      setSnap(s);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 挂载即拉取；load 内部 setState 发生在 await 之后（微任务），非同步渲染中
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canConfirmBrief = useMemo(
    () =>
      snap != null &&
      snap.issues.missingRequired.length === 0 &&
      snap.issues.unverifiedFacts.length === 0,
    [snap],
  );

  async function runExtract() {
    setExtractBusy(true);
    try {
      const r = await productBriefApi.extractBrief(projectId);
      flash({ tone: "ok", text: `从 ${r.chunkCount} 个片段提取出 ${r.extracted} 条候选${r.truncated ? "（文档较长，已截断）" : ""}` });
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "提取失败";
      flash({ tone: "err", text: msg });
    } finally {
      setExtractBusy(false);
    }
  }

  async function act(fieldId: string, fn: () => Promise<unknown>, okText: string) {
    setBusyField(fieldId);
    try {
      await fn();
      await load();
      flash({ tone: "ok", text: okText });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "操作失败";
      flash({ tone: "err", text: msg });
    } finally {
      setBusyField(null);
    }
  }

  async function saveEdit(field: BriefField) {
    if (!editing) return;
    await act(
      field.id,
      () => productBriefApi.editField(projectId, field.id, {
        value: textToValue(editing.text),
        reason: editing.reason.trim() || undefined,
      }),
      "已保存",
    );
    setEditing(null);
  }

  async function confirmWholeBrief() {
    setConfirmBusy(true);
    try {
      const b = await productBriefApi.confirmBrief(projectId);
      flash({ tone: "ok", text: `产品档案已确认为 v${b.version}` });
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "确认失败";
      flash({ tone: "err", text: msg });
    } finally {
      setConfirmBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-gray-500 inline-flex items-center gap-2 p-4">
        <Loader2 size={14} className="animate-spin" /> 加载产品档案…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
        {loadError}
      </div>
    );
  }
  if (!snap) return null;

  const fieldsByGroup = (g: BriefFieldGroup) =>
    snap.fields.filter((f) => f.field_group === g && f.status !== "rejected");

  return (
    <div className="space-y-5">
      {/* 顶部：标题 + 状态 + 操作 */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
            <FileText size={16} className="text-indigo-600" />
            产品事实档案
            <span className="text-xs font-normal text-gray-400">
              v{snap.brief.version} · {snap.brief.status === "confirmed" ? "已确认" : "草稿"}
            </span>
          </h2>
          <p className="text-xs text-gray-500">
            先核对产品事实（每条带出处、要你确认），生成内容时只用已确认的事实。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn btn-sm inline-flex items-center gap-1.5"
            onClick={runExtract}
            disabled={extractBusy}
            title="从已上传的产品文档里 LLM 提取候选事实"
          >
            {extractBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            从文档提取
          </button>
          <button
            className="btn btn-sm btn-primary inline-flex items-center gap-1.5"
            onClick={confirmWholeBrief}
            disabled={!canConfirmBrief || confirmBusy}
            title={canConfirmBrief ? "确认整份档案" : "还有缺失关键字段或未核实事实，无法确认"}
          >
            {confirmBusy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            确认整份档案
          </button>
        </div>
      </header>

      {/* toast */}
      {toast && (
        <div
          className={`text-xs px-3 py-2 rounded border ${
            toast.tone === "ok"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-red-50 text-red-600 border-red-200"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* 问题清单 */}
      {(snap.issues.missingRequired.length > 0 || snap.issues.unverifiedFacts.length > 0) && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
          <div className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800">
            <AlertTriangle size={14} /> 确认前需要处理
          </div>
          {snap.issues.missingRequired.length > 0 && (
            <div className="text-xs text-amber-800">
              缺少关键字段（需确认后才算完备）：
              {snap.issues.missingRequired.map((m) => (
                <span key={`${m.group}/${m.key}`} className="chip ml-1">{m.group}/{m.key}</span>
              ))}
            </div>
          )}
          {snap.issues.unverifiedFacts.length > 0 && (
            <div className="text-xs text-amber-800">
              未核实的事实（模型推断、无出处，需确认或补出处）：
              {snap.issues.unverifiedFacts.map((m) => (
                <span key={m.id} className="chip ml-1">{m.group}/{m.key}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 分组字段 */}
      <div className="space-y-5">
        {GROUP_META.map((g) => {
          const rows = fieldsByGroup(g.key);
          return (
            <section key={g.key} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-gray-800">{g.label}</h3>
                <span className="text-[11px] text-gray-400">{g.hint}</span>
              </div>
              {rows.length === 0 ? (
                <div className="text-xs text-gray-400 italic border border-dashed rounded px-3 py-2">
                  暂无字段
                </div>
              ) : (
                <div className="space-y-2">
                  {rows.map((f) => {
                    const st = STATUS_META[f.status];
                    const isEditing = editing?.id === f.id;
                    const needReason = FACTUAL_GROUPS.includes(f.field_group);
                    return (
                      <div key={f.id} className="card p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-sm font-medium text-gray-800 font-mono">{f.field_key}</span>
                              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                              <span className="text-[11px] text-gray-400">
                                来源：{SOURCE_LABEL[f.source]} · 置信 {(f.confidence * 100).toFixed(0)}%
                                {f.evidence_chunk_ids.length > 0 && ` · ${f.evidence_chunk_ids.length} 处出处`}
                              </span>
                            </div>
                            {isEditing ? (
                              <div className="space-y-2 mt-2">
                                <textarea
                                  className="w-full text-sm border rounded px-2 py-1.5 font-mono"
                                  rows={3}
                                  value={editing.text}
                                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                                  placeholder="多个并列值请每行一个"
                                />
                                {needReason && (
                                  <input
                                    className="w-full text-sm border rounded px-2 py-1.5"
                                    value={editing.reason}
                                    onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                                    placeholder="修改原因（事实型字段必填）"
                                  />
                                )}
                                <div className="flex items-center gap-2">
                                  <button
                                    className="btn btn-sm btn-primary"
                                    disabled={busyField === f.id || (needReason && !editing.reason.trim())}
                                    onClick={() => saveEdit(f)}
                                  >
                                    保存
                                  </button>
                                  <button className="btn btn-sm" onClick={() => setEditing(null)}>取消</button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                                {renderValue(f.value)}
                              </p>
                            )}
                          </div>
                          {!isEditing && (
                            <div className="flex items-center gap-1 shrink-0">
                              {f.status !== "confirmed" && (
                                <button
                                  className="btn-ghost btn-sm inline-flex items-center gap-1 text-emerald-700"
                                  disabled={busyField === f.id}
                                  onClick={() => act(f.id, () => productBriefApi.confirmField(projectId, f.id), "已确认")}
                                  title="确认这条事实"
                                >
                                  {busyField === f.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                  确认
                                </button>
                              )}
                              <button
                                className="btn-ghost btn-sm inline-flex items-center gap-1 text-gray-600"
                                onClick={() => setEditing({ id: f.id, text: valueToText(f.value), reason: "" })}
                                title="编辑值"
                              >
                                <Pencil size={13} /> 编辑
                              </button>
                              <button
                                className="btn-ghost btn-sm inline-flex items-center gap-1 text-red-500"
                                disabled={busyField === f.id}
                                onClick={() => act(f.id, () => productBriefApi.rejectField(projectId, f.id), "已拒绝")}
                                title="拒绝这条"
                              >
                                <XCircle size={13} /> 拒绝
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* 手动加字段 */}
      <div className="border-t pt-4">
        {adding ? (
          <AddFieldForm
            projectId={projectId}
            onDone={async (ok) => {
              setAdding(false);
              if (ok) {
                await load();
                flash({ tone: "ok", text: "已新增候选字段" });
              }
            }}
            onError={(m) => flash({ tone: "err", text: m })}
          />
        ) : (
          <button className="btn btn-sm inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
            <Plus size={13} /> 手动新增字段
          </button>
        )}
        <button
          className="btn-ghost btn-sm inline-flex items-center gap-1.5 ml-2 text-gray-500"
          onClick={() => void load()}
          title="刷新"
        >
          <RotateCcw size={13} /> 刷新
        </button>
      </div>
    </div>
  );
}

function AddFieldForm({
  projectId,
  onDone,
  onError,
}: {
  projectId: string;
  onDone: (ok: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [group, setGroup] = useState<BriefFieldGroup>("identity");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!key.trim()) {
      onError("请填写字段 key");
      return;
    }
    setBusy(true);
    try {
      await productBriefApi.upsertField(projectId, {
        group,
        key: key.trim(),
        value: textToValue(value),
        source: "user",
        confidence: 0.6,
      });
      onDone(true);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "新增失败");
      setBusy(false);
    }
  }

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="text-sm border rounded px-2 py-1.5"
          value={group}
          onChange={(e) => setGroup(e.target.value as BriefFieldGroup)}
        >
          {GROUP_META.map((g) => (
            <option key={g.key} value={g.key}>{g.label}</option>
          ))}
        </select>
        <input
          className="text-sm border rounded px-2 py-1.5 font-mono flex-1"
          placeholder="字段 key，如 name / pricing"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      <textarea
        className="w-full text-sm border rounded px-2 py-1.5"
        rows={2}
        placeholder="字段值（多个并列值每行一个）"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={submit}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : "新增"}
        </button>
        <button className="btn btn-sm" onClick={() => onDone(false)}>取消</button>
      </div>
    </div>
  );
}
