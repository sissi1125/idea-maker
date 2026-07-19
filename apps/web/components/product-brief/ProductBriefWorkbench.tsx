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
  Wand2, CheckCircle2, Pencil, XCircle, ShieldCheck,
  AlertTriangle, Loader2, Plus, RotateCcw, FileText, Lightbulb, Images,
} from "lucide-react";
import {
  productBriefApi,
  FACTUAL_GROUPS,
  type BriefSnapshot,
  type BriefField,
  type BriefFieldGroup,
  type BriefFieldStatus,
} from "@/lib/api";
import { ApiError } from "@/lib/api";
import { AssetGallery } from "@/components/assets/AssetGallery";
import { EmptyState, ProvenanceBadge, SelectField, StatusBadge } from "@/components/ui/ProductUi";
import { ClaimSuggestions } from "./ClaimSuggestions";

// 分组展示顺序 + 中文标签 + 说明
const GROUP_META: Array<{ key: BriefFieldGroup; label: string; hint: string }> = [
  { key: "identity", label: "产品身份", hint: "名称、一句话定位、类别、官网" },
  { key: "fact", label: "产品事实", hint: "功能、价格、支持范围、限制、版本" },
  { key: "audience", label: "用户与场景", hint: "目标用户、使用场景、痛点" },
  { key: "positioning", label: "定位与差异化", hint: "核心价值、差异点、竞品" },
];

const BRIEF_NAV = [
  { id: "brief-identity", label: "产品身份" },
  { id: "brief-fact", label: "产品事实" },
  { id: "brief-audience", label: "用户与场景" },
  { id: "brief-positioning", label: "定位与差异化" },
];

type ProfileTab = "information" | "claims" | "assets";
const PROFILE_TABS: Array<{ id: ProfileTab; label: string; description: string; icon: typeof FileText }> = [
  { id: "information", label: "产品信息", description: "身份、事实、用户与定位", icon: FileText },
  { id: "claims", label: "产品卖点", description: "平台建议与人工维护", icon: Lightbulb },
  { id: "assets", label: "视觉资产", description: "图片、标签与卖点关联", icon: Images },
];

const STATUS_META: Record<BriefFieldStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  candidate: { label: "候选", tone: "neutral" },
  confirmed: { label: "已确认", tone: "success" },
  rejected: { label: "已拒绝", tone: "danger" },
  stale: { label: "待复核", tone: "warning" },
};

const FIELD_LABEL: Record<string, string> = {
  name: "产品名称", one_liner: "一句话定位", category: "产品类别", website: "官方网站",
  features: "核心功能", pricing: "价格方案", limitations: "使用限制", version: "当前版本",
  target_users: "目标用户", scenarios: "使用场景", pain_points: "用户痛点",
  value_proposition: "核心价值", differentiators: "差异化", competitors: "竞品",
  tone: "表达语气", preferred_words: "常用词", banned_words: "禁用词", cta_style: "行动引导风格",
};

const REQUIRED_FIELD_KEYS = ["identity/name", "identity/one_liner", "positioning/core_value"] as const;

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
  const [activeTab, setActiveTab] = useState<ProfileTab>("information");

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

  const canConfirmBrief = useMemo(() => {
    if (!snap) return false;
    const availableKeys = new Set(
      snap.fields
        .filter((field) => field.status !== "rejected")
        .map((field) => `${field.field_group}/${field.field_key}`),
    );
    return REQUIRED_FIELD_KEYS.every((key) => availableKeys.has(key));
  }, [snap]);

  const isFullyConfirmed = useMemo(
    () =>
      snap != null &&
      snap.brief.status === "confirmed" &&
      snap.fields.every((field) => field.status === "confirmed" || field.status === "rejected"),
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
      <div className="text-sm inline-flex items-center gap-2 py-4" style={{ color: "var(--ink-3)" }}>
        <Loader2 size={14} className="animate-spin" /> 加载产品信息…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="text-sm p-3" style={{ color: "var(--err)", background: "#f4eae9", border: "1px solid #e5cfcd" }}>
        {loadError}
      </div>
    );
  }
  if (!snap) return null;

  const fieldsByGroup = (g: BriefFieldGroup) =>
    snap.fields.filter((f) => f.field_group === g && f.status !== "rejected");

  return (
    <div className="space-y-7">
      <nav className="profile-tabs" aria-label="产品档案分类">
        {PROFILE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} className="profile-tab" data-active={activeTab === tab.id} aria-selected={activeTab === tab.id} role="tab" onClick={() => setActiveTab(tab.id)}>
              <Icon size={16} />
              <span><strong>{tab.label}</strong><small>{tab.description}</small></span>
            </button>
          );
        })}
      </nav>

      {activeTab === "information" ? (
        <div className="brief-toolbar">
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--ink-3)" }}>
            <span>版本 v{snap.brief.version}</span>
            <StatusBadge tone={snap.brief.status === "confirmed" ? "success" : "neutral"}>{snap.brief.status === "confirmed" ? "已确认" : "草稿"}</StatusBadge>
            <span>{snap.fields.length} 条信息</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" onClick={runExtract} disabled={extractBusy} title="从资料库整理候选信息">
              {extractBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} 从资料整理
            </button>
            {isFullyConfirmed ? (
              <span className="brief-confirmed-state"><CheckCircle2 size={14} /> 全部信息已确认</span>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={confirmWholeBrief} disabled={!canConfirmBrief || confirmBusy} title={canConfirmBrief ? "确认全部候选与待复核信息" : "仍缺少产品名称、一句话定位或核心价值"}>
                {confirmBusy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} 确认全部信息
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* toast */}
      {toast && (
        <div
          className="text-xs px-3 py-2 border"
          style={toast.tone === "ok" ? { background: "#e9eeec", color: "var(--ok)", borderColor: "#d3ded9" } : { background: "#f4eae9", color: "var(--err)", borderColor: "#e5cfcd" }}
        >
          {toast.text}
        </div>
      )}

      {/* 问题清单 */}
      {activeTab === "information" && (snap.issues.missingRequired.length > 0 || snap.issues.unverifiedFacts.length > 0) && (
        <div className="status-banner space-y-2">
          <div className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--ink)" }}>
            <AlertTriangle size={14} /> 确认前需要处理
          </div>
          {snap.issues.missingRequired.length > 0 && (
            <div className="text-xs" style={{ color: "var(--ink-3)" }}>
              缺少关键字段（需确认后才算完备）：
              {snap.issues.missingRequired.map((m) => (
                <span key={`${m.group}/${m.key}`} className="chip ml-1">{m.group}/{m.key}</span>
              ))}
            </div>
          )}
          {snap.issues.unverifiedFacts.length > 0 && (
            <div className="text-xs" style={{ color: "var(--ink-3)" }}>
              未核实的事实（模型推断、无出处，需确认或补出处）：
              {snap.issues.unverifiedFacts.map((m) => (
                <span key={m.id} className="chip ml-1">{m.group}/{m.key}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 产品信息是独立滚动区；锚点导航在滚动时保持可见。 */}
      {activeTab === "information" ? <section>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-base font-semibold">产品信息</h2>
          <span className="text-xs" style={{ color: "var(--ink-4)" }}>身份、事实、用户场景与差异化定位</span>
        </div>
        <div className="brief-scroll-block">
          <nav className="brief-anchor-nav" aria-label="产品信息分区">
            {BRIEF_NAV.map((item) => <a key={item.id} href={`#${item.id}`}>{item.label}</a>)}
          </nav>
          <div className="px-4 sm:px-5 pb-5">
          {GROUP_META.map((g) => {
            const rows = fieldsByGroup(g.key);
            return (
            <section id={`brief-${g.key}`} key={g.key} className="brief-anchor-section">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{g.label}</h3>
                <span className="text-[11px]" style={{ color: "var(--ink-4)" }}>{g.hint}</span>
              </div>
              {rows.length === 0 ? (
                <EmptyState>暂无信息</EmptyState>
              ) : (
                <div>
                  {rows.map((f) => {
                    const st = STATUS_META[f.status];
                    const isEditing = editing?.id === f.id;
                    const needReason = FACTUAL_GROUPS.includes(f.field_group);
                    return (
                      <div key={f.id} className="audit-row">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{FIELD_LABEL[f.field_key] ?? f.field_key}</div>
                            <div className="mt-1"><StatusBadge tone={st.tone}>{st.label}</StatusBadge></div>
                          </div>
                          <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                <ProvenanceBadge source={f.source} confidence={f.confidence} />
                                {f.evidence_chunk_ids.length > 0 ? <span className="text-[11px]" style={{ color: "var(--ink-4)" }}>{f.evidence_chunk_ids.length} 处原文依据</span> : null}
                              </div>
                            {isEditing ? (
                              <div className="space-y-2 mt-2">
                                <textarea
                                  className="w-full text-sm field font-mono"
                                  rows={3}
                                  value={editing.text}
                                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                                  placeholder="多个并列值请每行一个"
                                />
                                {needReason && (
                                  <input
                                    className="w-full text-sm field"
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
                              <p className="text-sm whitespace-pre-wrap break-words" style={{ color: "var(--ink-2)" }}>
                                {renderValue(f.value)}
                              </p>
                            )}
                          </div>
                          {!isEditing && (
                            <div className="flex items-center justify-end gap-1 shrink-0">
                              {f.status !== "confirmed" && (
                                <button
                                  className="btn-ghost btn-sm inline-flex items-center gap-1"
                                  disabled={busyField === f.id}
                                  onClick={() => act(f.id, () => productBriefApi.confirmField(projectId, f.id), "已确认")}
                                  title="确认这条事实"
                                >
                                  {busyField === f.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                  确认
                                </button>
                              )}
                              <button
                                className="btn-ghost btn-sm inline-flex items-center gap-1"
                                onClick={() => setEditing({ id: f.id, text: valueToText(f.value), reason: "" })}
                                title="编辑值"
                              >
                                <Pencil size={13} /> 编辑
                              </button>
                              <button
                                className="btn-ghost btn-sm inline-flex items-center gap-1"
                                style={{ color: "var(--err)" }}
                                disabled={busyField === f.id}
                                onClick={() => act(f.id, () => productBriefApi.rejectField(projectId, f.id), "已拒绝")}
                                title="拒绝这条"
                              >
                                <XCircle size={13} /> 拒绝
                              </button>
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            );
          })}
          <div className="border-t border-[var(--line)] pt-4 mt-4">
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
                onError={(message) => flash({ tone: "err", text: message })}
              />
            ) : (
              <button className="btn btn-sm inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
                <Plus size={13} /> 手动新增字段
              </button>
            )}
            <button className="btn-ghost btn-sm inline-flex items-center gap-1.5 ml-2" onClick={() => void load()} title="刷新">
              <RotateCcw size={13} /> 刷新
            </button>
          </div>
          </div>
        </div>
      </section> : null}

      {activeTab === "claims" ? <ClaimSuggestions projectId={projectId} /> : null}
      {activeTab === "assets" ? <AssetGallery projectId={projectId} /> : null}

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
        <SelectField
          className="text-sm"
          value={group}
          onChange={(e) => setGroup(e.target.value as BriefFieldGroup)}
        >
          {GROUP_META.map((g) => (
            <option key={g.key} value={g.key}>{g.label}</option>
          ))}
        </SelectField>
        <input
          className="text-sm field font-mono flex-1"
          placeholder="字段 key，如 name / pricing"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      <textarea
        className="w-full text-sm field"
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
