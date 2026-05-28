/**
 * FeedbackPanel — feat-200.7 Week 7
 *
 * 组合 MultiDimRating + GenerationEditor + comment + 提交按钮，挂在生成结果卡底部。
 *
 * 状态机：
 *   closed → opened（用户点"评价本次结果"）
 *   opened.idle → submitting → saved（短暂高亮"已保存"，3s 后回 idle）
 *   opened.idle → submitting → error（红色错误条；保持表单内容供修正）
 *
 * 设计取舍：
 *   - 默认折叠（chat 主流程是看结果，评价是次要动作）
 *   - 进入页面/刷新时先 GET 一次，若已有反馈直接展示评分而非空表单；
 *     这样用户能看到自己之前的评价、也能再次修改
 *   - 部分提交允许：所有字段可空，至少一个字段非空才能点提交
 *   - editDiff 提交时只在 value != original 时传值；相同就传 null（避免脏数据）
 */

"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Send, Check, AlertCircle } from "lucide-react";
import { feedbacksApi } from "@/lib/api";
import type { FeedbackRow } from "@/lib/api";
import { MultiDimRating, EMPTY_RATING, type MultiDimRatingValue } from "./MultiDimRating";
import { GenerationEditor } from "./GenerationEditor";

interface Props {
  generationId: string;
  /** 原始 LLM 结果，editor 的对照基准 */
  originalContent: string;
}

export function FeedbackPanel({ generationId, originalContent }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ratings, setRatings] = useState<MultiDimRatingValue>(EMPTY_RATING);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [existing, setExisting] = useState<FeedbackRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 展开时拉一次现有反馈——把 setLoading(true) 移进 async IIFE 第一步，
  // 避免 effect 体里同步 setState 触发 lint（react-hooks/set-state-in-effect）。
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const { feedback } = await feedbacksApi.getFeedback(generationId);
        if (cancelled) return;
        setExisting(feedback);
        if (feedback) {
          setRatings({
            relevance: feedback.relevance,
            accuracy: feedback.accuracy,
            creativity: feedback.creativity,
            overall: feedback.overall,
          });
          setEditedContent(feedback.editDiff);
          setComment(feedback.comment ?? "");
        }
      } catch {
        // 静默：保持空表单
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, generationId]);

  // 至少一项有值才允许提交（防空提交）
  const hasAnyValue =
    ratings.relevance != null ||
    ratings.accuracy != null ||
    ratings.creativity != null ||
    ratings.overall != null ||
    (editedContent != null && editedContent !== originalContent) ||
    comment.trim().length > 0;

  const onSubmit = async () => {
    if (!hasAnyValue || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { feedback } = await feedbacksApi.submitFeedback(generationId, {
        relevance: ratings.relevance,
        accuracy: ratings.accuracy,
        creativity: ratings.creativity,
        overall: ratings.overall,
        // 没改动就别存——editDiff=null 让历史页知道"用户没改过"
        editDiff: editedContent != null && editedContent !== originalContent
          ? editedContent
          : null,
        comment: comment.trim() || null,
      });
      setExisting(feedback);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 头部"摘要行"——折叠态显示一句"已评 X.X / 5"或"评价本次结果"
  const headerSummary = (() => {
    if (!existing) return "评价本次结果";
    const filled = [existing.relevance, existing.accuracy, existing.creativity, existing.overall]
      .filter((n): n is number => n != null);
    if (filled.length === 0) return "已提交反馈（无评分）";
    const avg = filled.reduce((s, n) => s + n, 0) / filled.length;
    return `已评 ${avg.toFixed(1)} / 5（${filled.length} 维）`;
  })();

  return (
    <div className="pt-3 mt-3" style={{ borderTop: "1px solid var(--line-2)" }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] font-medium"
        style={{ color: existing ? "var(--brand)" : "var(--ink-3)" }}
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {headerSummary}
        {existing && !expanded && (
          <span className="chip mono text-[10.5px] ml-1"
                style={{ background: "rgba(79,168,154,.08)", color: "var(--brand)" }}>
            点击修改
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3.5">
          {loading ? (
            <div className="text-[12px]" style={{ color: "var(--ink-4)" }}>加载已有反馈…</div>
          ) : (
            <>
              <MultiDimRating value={ratings} onChange={setRatings} disabled={submitting} />

              <GenerationEditor
                original={originalContent}
                value={editedContent}
                onChange={setEditedContent}
                disabled={submitting}
              />

              <div>
                <label className="text-[12px] font-medium block mb-1"
                       style={{ color: "var(--ink)" }}>
                  备注（可选）
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={submitting}
                  rows={2}
                  placeholder="哪里好 / 哪里需要改进 / 期望什么角度…"
                  className="w-full rounded-md p-2.5 text-[12.5px] leading-[1.55] resize-y"
                  style={{
                    border: "1px solid var(--line)",
                    background: "#fff",
                    color: "var(--ink)",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {error && (
                <div className="flex items-center gap-1.5 text-[12px] rounded-md px-2 py-1.5"
                     style={{ background: "rgba(179,38,30,.06)", color: "var(--err)" }}>
                  <AlertCircle size={12} /> {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                {savedAt && (
                  <span className="text-[11.5px] flex items-center gap-1"
                        style={{ color: "var(--ok)" }}>
                    <Check size={11} strokeWidth={2.5} /> 已保存
                  </span>
                )}
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!hasAnyValue || submitting}
                  className="btn btn-sm btn-primary"
                  style={{ opacity: !hasAnyValue || submitting ? 0.5 : 1 }}
                >
                  {submitting ? "提交中…" : existing ? "更新反馈" : "提交反馈"}
                  <Send size={11} strokeWidth={2} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
