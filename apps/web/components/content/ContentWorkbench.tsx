/**
 * ContentWorkbench — feat-400.2 前端
 *
 * 一个页面三块：
 *   1. 卖点库（Claim Map）：从产品档案派生卖点，逐条批准/拒绝（事实型没证据不给批）
 *   2. 写一条内容做评测：先过「硬规则检查」（代码死规则，不合格直接拦），再给去向
 *   3. 待人工处理队列：拿不准的内容转人工，人工采纳/拒绝
 *
 * 全程大白话，不用"门禁"。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Tag, Wand2, CheckCircle2, XCircle, ShieldAlert, Loader2,
  ClipboardList, RotateCcw, ThumbsUp, ThumbsDown, Sparkles, Lightbulb,
} from "lucide-react";
import {
  claimsApi, contentEvalApi, feedbackLearningApi, EVIDENCE_REQUIRED_CLAIM_TYPES,
  type Claim, type QueueItem, type Decision, type UpdateSuggestion,
} from "@/lib/api";
import { ApiError } from "@/lib/api";

const CLAIM_TYPE_LABEL: Record<string, string> = {
  functional: "功能", outcome: "效果", differentiation: "差异化", emotional: "情感",
};
const CLAIM_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  candidate: { label: "待审", cls: "bg-gray-100 text-gray-600 border-gray-200" },
  approved: { label: "已批准", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  blocked: { label: "已拒绝", cls: "bg-red-50 text-red-600 border-red-200" },
};
const DECISION_LABEL: Record<Decision, { label: string; cls: string }> = {
  publish_candidate: { label: "可发布", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  human_review: { label: "要人工看", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  revise: { label: "要改", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  blocked: { label: "已拦下", cls: "bg-red-50 text-red-600 border-red-200" },
};
// 硬规则检查失败原因 → 大白话

interface Toast { tone: "ok" | "err"; text: string; }

export function ContentWorkbench({ projectId }: { projectId: string }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [suggestions, setSuggestions] = useState<UpdateSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const flash = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [cs, q, sg] = await Promise.all([
        claimsApi.listClaims(projectId),
        contentEvalApi.getQueue(projectId),
        feedbackLearningApi.listSuggestions(projectId),
      ]);
      setClaims(cs);
      setQueue(q);
      setSuggestions(sg);
    } catch (err) {
      flash({ tone: "err", text: err instanceof Error ? err.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, [projectId, flash]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      await load();
      flash({ tone: "ok", text: ok });
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "操作失败" });
    } finally {
      setBusy(null);
    }
  }


  if (loading) {
    return (
      <div className="text-sm text-gray-500 inline-flex items-center gap-2 p-4">
        <Loader2 size={14} className="animate-spin" /> 加载中…
      </div>
    );
  }


  return (
    <div className="space-y-6">
      {toast && (
        <div className={`text-xs px-3 py-2 rounded border ${
          toast.tone === "ok" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"
        }`}>{toast.text}</div>
      )}

      {/* ── 1. 卖点库 ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
            <Tag size={16} className="text-brand" /> 卖点库
            <span className="text-xs font-normal text-gray-400">先审卖点，文案只能用批准过的</span>
          </h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm inline-flex items-center gap-1.5" disabled={busy === "derive"}
              onClick={() => act("derive", () => claimsApi.deriveClaims(projectId), "已从产品档案派生卖点")}
              title="从已确认的产品事实自动生成候选卖点">
              {busy === "derive" ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              从档案派生
            </button>
            <button className="btn-ghost btn-sm inline-flex items-center gap-1.5 text-gray-500" onClick={() => void load()}>
              <RotateCcw size={13} /> 刷新
            </button>
          </div>
        </div>
        {claims.length === 0 ? (
          <div className="text-xs text-gray-400 italic border border-dashed rounded px-3 py-3">
            还没有卖点。先在「产品档案」确认事实，再点「从档案派生」。
          </div>
        ) : (
          <div className="space-y-2">
            {claims.map((c) => {
              const st = CLAIM_STATUS_LABEL[c.status];
              const needEvidence = EVIDENCE_REQUIRED_CLAIM_TYPES.includes(c.claim_type);
              const noEvidence = c.evidence_chunk_ids.length === 0;
              return (
                <div key={c.id} className="card p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                      <span className="chip">{CLAIM_TYPE_LABEL[c.claim_type]}</span>
                      <span className="text-[11px] text-gray-400">
                        {c.evidence_chunk_ids.length > 0 ? `${c.evidence_chunk_ids.length} 处证据` : "无证据"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 break-words">{c.text}</p>
                    {c.status === "candidate" && needEvidence && noEvidence && (
                      <p className="text-[11px] text-amber-600 mt-1 inline-flex items-center gap-1">
                        <ShieldAlert size={11} /> 事实型卖点没证据，批准会被拒——先去档案补证据
                      </p>
                    )}
                  </div>
                  {c.status !== "blocked" && (
                    <div className="flex items-center gap-1 shrink-0">
                      {c.status !== "approved" && (
                        <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-emerald-700" disabled={busy === c.id}
                          onClick={() => act(c.id, () => claimsApi.approveClaim(projectId, c.id), "已批准")}>
                          {busy === c.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} 批准
                        </button>
                      )}
                      <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-red-500" disabled={busy === c.id}
                        onClick={() => act(c.id, () => claimsApi.blockClaim(projectId, c.id), "已拒绝")}>
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

      {/* ── 2. 待人工处理队列 ── */}
      <section className="space-y-3 border-t pt-5">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
          <ClipboardList size={16} className="text-brand" /> 待人工处理
          <span className="text-xs font-normal text-gray-400">{queue.length} 条</span>
        </h2>
        {queue.length === 0 ? (
          <div className="text-xs text-gray-400 italic border border-dashed rounded px-3 py-3">队列是空的</div>
        ) : (
          <div className="space-y-2">
            {queue.map((q) => (
              <div key={q.id} className="card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${DECISION_LABEL[q.decision].cls}`}>
                      {DECISION_LABEL[q.decision].label}
                    </span>
                    {q.angle && <span className="text-[11px] text-gray-400">{q.angle}</span>}
                  </div>
                  <p className="text-sm text-gray-700 break-words">{q.body}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-emerald-700" disabled={busy === q.id}
                    onClick={() => act(q.id, () => contentEvalApi.humanDecision(projectId, q.id, "accepted"), "已采纳")}>
                    <ThumbsUp size={13} /> 采纳
                  </button>
                  <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-red-500" disabled={busy === q.id}
                    onClick={() => act(q.id, () => contentEvalApi.humanDecision(projectId, q.id, "rejected"), "已拒绝")}>
                    <ThumbsDown size={13} /> 拒绝
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 4. 偏好更新建议（从改稿里学） ── */}
      <section className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
            <Lightbulb size={16} className="text-brand" /> 偏好更新建议
            <span className="text-xs font-normal text-gray-400">从你的改稿里学，接受后写进产品档案的表达约束</span>
          </h2>
          <button className="btn btn-sm inline-flex items-center gap-1.5" disabled={busy === "suggest"}
            onClick={() => act("suggest", () => feedbackLearningApi.generateSuggestions(projectId), "已重新汇总建议")}
            title="汇总最近的编辑反馈，给出偏好更新建议">
            {busy === "suggest" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            重新汇总
          </button>
        </div>
        {suggestions.filter((s) => s.status === "pending").length === 0 ? (
          <div className="text-xs text-gray-400 italic border border-dashed rounded px-3 py-3">
            暂无待处理建议。多改几次文案，系统会自动归纳出你的偏好（如「总在删夸张词」）。
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.filter((s) => s.status === "pending").map((s) => (
              <div key={s.id} className="card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700 break-words">{s.suggestion_text}</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    接受后写入：产品档案 · {s.target_group === "constraint" ? "平台约束" : "表达风格"} · {s.target_key} = {s.target_value}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-emerald-700" disabled={busy === s.id}
                    onClick={() => act(s.id, () => feedbackLearningApi.acceptSuggestion(projectId, s.id), "已接受，写入产品档案表达约束")}>
                    {busy === s.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} 接受
                  </button>
                  <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-red-500" disabled={busy === s.id}
                    onClick={() => act(s.id, () => feedbackLearningApi.rejectSuggestion(projectId, s.id), "已忽略")}>
                    <XCircle size={13} /> 忽略
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
