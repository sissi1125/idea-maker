/**
 * Generation 历史页 — feat-200.7 Week 7
 *
 * 路由：/projects/[id]/history
 * 数据：generationsApi.listGenerations（cursor 分页）+ 行内展开看详情
 *
 * 设计取舍：
 *   - cursor 分页：服务端按 (created_at DESC, id DESC) keyset 排序，前端只持有 nextCursor 字符串；
 *   - 行级展开而非弹 Modal：避免遮挡列表上下文，多条对比时更顺手；
 *   - source filter（manual / auto）三选一 chip：用户通常只关心自己手动发起的；
 *   - 评分快照：从 feedback API 批量拉取展示在行末——但 backend 没有批量端点，
 *     方案：先列表展示评分占位，详情展开时再单独拉 feedback；
 *   - 状态过滤暂不支持（list 端点支持 status 但 UI 没几个状态值，价值低）。
 *
 * 不在范围内（Phase 4 再做）：
 *   - 重新生成按钮（基于历史 prompt 一键 rerun）
 *   - 全文搜索 query 内容
 *   - 比较多个 generation 的 trace 差异
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Clock, RefreshCw, ChevronDown, ChevronUp, Sparkles, User, Bot,
  DollarSign, AlertCircle,
} from "lucide-react";
import { generationsApi, feedbacksApi } from "@/lib/api";
import type { GenerationRow, FeedbackRow } from "@/lib/api";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { PipelineTraceView } from "@/components/pipeline/PipelineTrace";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";
import { AddToLibraryButton } from "@/components/notes/AddToLibraryButton";
import { SaveSegmentsList } from "@/components/notes/SaveSegmentsList";
import { Markdown } from "@/components/markdown/Markdown";

type SourceFilter = "all" | "manual" | "auto";

const SOURCE_LABEL: Record<string, { label: string; color: string; bg: string; Icon: typeof User }> = {
  manual: { label: "用户提问", color: "var(--brand)", bg: "var(--brand-soft)", Icon: User },
  auto:   { label: "自动卡片", color: "var(--tool)",  bg: "var(--tool-bg)",    Icon: Bot },
};

/** 历史页一条 generation row 折叠/展开 */
function HistoryRow({
  row,
  expanded,
  onToggle,
  feedback,
}: {
  row: GenerationRow;
  expanded: boolean;
  onToggle: () => void;
  feedback: FeedbackRow | null;
}) {
  const src = SOURCE_LABEL[row.source] ?? SOURCE_LABEL.manual;
  const isOk = row.status === "succeeded";
  const created = new Date(row.createdAt).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  // 评分摘要：4 维平均
  const avgRating = feedback
    ? (() => {
        const vs = [feedback.relevance, feedback.accuracy, feedback.creativity, feedback.overall]
          .filter((n): n is number => n != null);
        return vs.length ? vs.reduce((s, n) => s + n, 0) / vs.length : null;
      })()
    : null;

  return (
    <div className="card mb-2 overflow-hidden" style={{ padding: 0 }}>
      {/* 折叠头 */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-start gap-3 p-3.5 hover:bg-[rgba(11,17,32,.02)] transition-colors"
      >
        <span
          className="w-7 h-7 rounded-md flex-none flex items-center justify-center"
          style={{ background: src.bg, color: src.color }}
        >
          <src.Icon size={14} strokeWidth={1.8} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[10.5px] font-semibold tracking-wider uppercase"
                  style={{ color: src.color }}>
              {src.label}
            </span>
            <span className="text-[10.5px] mono" style={{ color: "var(--ink-4)" }}>{created}</span>
            {!isOk && (
              <span className="chip mono text-[10.5px]"
                    style={{ background: "rgba(179,38,30,.08)", color: "var(--err)" }}>
                失败
              </span>
            )}
            {avgRating != null && (
              <span className="chip mono text-[10.5px]"
                    style={{ background: "rgba(214,180,80,.12)", color: "var(--gen)" }}>
                ★ {avgRating.toFixed(1)}
              </span>
            )}
          </div>
          <div className="text-[13.5px] font-medium truncate" style={{ color: "var(--ink)" }}>
            {row.query}
          </div>
          {/* 摘要尝试取 result_notes 首 80 字符 */}
          {isOk && row.resultNotes && (
            <div className="text-[12px] mt-1 truncate" style={{ color: "var(--ink-3)" }}>
              {row.resultNotes.replace(/\s+/g, " ").slice(0, 120)}
            </div>
          )}
        </div>
        <div className="flex-none flex items-center gap-2 text-[11px] mono"
             style={{ color: "var(--ink-4)" }}>
          {row.durationMs != null && <span>{(row.durationMs / 1000).toFixed(1)}s</span>}
          {row.costBreakdown?.costUsd != null && (
            <span className="inline-flex items-center gap-0.5">
              <DollarSign size={10} strokeWidth={2} />
              {row.costBreakdown.costUsd.toFixed(4)}
            </span>
          )}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* 展开详情：trace + 完整 resultNotes + 反馈面板 */}
      {expanded && (
        <div className="border-t px-3.5 py-3 fade-in"
             style={{ borderColor: "var(--line-2)", background: "rgba(11,17,32,.015)" }}>
          {row.error && (
            <div className="rounded-md p-2.5 mb-3 text-[12px] flex items-start gap-1.5"
                 style={{ background: "rgba(179,38,30,.06)", color: "var(--err)" }}>
              <AlertCircle size={12} strokeWidth={2} className="flex-none mt-0.5" />
              <span>{row.error}</span>
            </div>
          )}
          {isOk && row.resultNotes && (
            <div className="rounded-md p-3 mb-3"
                 style={{ background: "#fff", border: "1px solid var(--line-2)" }}>
              <Markdown content={row.resultNotes} />
            </div>
          )}
          {row.pipelineTrace && (
            <details className="mb-3">
              <summary className="text-[12px] font-medium cursor-pointer flex items-center gap-1.5"
                       style={{ color: "var(--ink-2)" }}>
                <Sparkles size={11} strokeWidth={2} />
                Pipeline trace（{row.pipelineTrace.stages.length} stages）
              </summary>
              <div className="mt-2">
                <PipelineTraceView running={false} finished={true}
                                   trace={row.pipelineTrace}
                                   retrievedChunks={row.retrievedChunks ?? []} />
              </div>
            </details>
          )}
          {isOk && row.resultNotes && (
            <div className="mb-3">
              <div className="flex justify-end mb-2">
                <AddToLibraryButton
                  generationId={row.id}
                  content={row.resultNotes}
                  titleSeed={row.query}
                />
              </div>
              <SaveSegmentsList generationId={row.id} content={row.resultNotes} />
            </div>
          )}
          {isOk && row.resultNotes && (
            <FeedbackPanel generationId={row.id} originalContent={row.resultNotes} />
          )}
        </div>
      )}
    </div>
  );
}

// ── 主页面 ──────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { currentProject: getCurrent, setCurrentProject } = useProjectsStore();
  const project = getCurrent();

  const [rows, setRows] = useState<GenerationRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [source, setSource] = useState<SourceFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [feedbackCache, setFeedbackCache] = useState<Record<string, FeedbackRow | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  /**
   * 加载一页。`reset=true` 时清空已有数据（filter 切换时用）。
   * 走 cursor keyset：下一页 cursor 由服务端返回的 nextCursor 决定，前端只传不改。
   */
  const loadPage = useCallback(
    async (reset: boolean) => {
      if (!projectId) return;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const res = await generationsApi.listGenerations(projectId, {
          cursor: reset ? undefined : cursor ?? undefined,
          limit: 20,
          source: source === "all" ? undefined : source,
        });
        setRows((prev) => (reset ? res.generations : [...prev, ...res.generations]));
        setCursor(res.nextCursor);
        setHasMore(!!res.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [projectId, cursor, source],
  );

  // 初次 + filter 切换时 reset 拉
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await generationsApi.listGenerations(projectId, {
          limit: 20,
          source: source === "all" ? undefined : source,
        });
        if (cancelled) return;
        setRows(res.generations);
        setCursor(res.nextCursor);
        setHasMore(!!res.nextCursor);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, source]);

  /**
   * 展开某行时拉一次 feedback——按需加载避免列表 N+1。
   * 已 cached 的不再请求。
   */
  const handleToggle = useCallback(
    async (id: string) => {
      const next = expanded === id ? null : id;
      setExpanded(next);
      if (next && feedbackCache[next] === undefined) {
        try {
          const { feedback } = await feedbacksApi.getFeedback(next);
          setFeedbackCache((c) => ({ ...c, [next]: feedback }));
        } catch {
          setFeedbackCache((c) => ({ ...c, [next]: null }));
        }
      }
    },
    [expanded, feedbackCache],
  );

  return (
    <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
      <div className="max-w-[860px] mx-auto px-7 py-6 pb-20">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[22px] font-semibold tracking-tight"
                 style={{ color: "var(--ink)" }}>
              <Clock size={20} strokeWidth={1.8} />
              生成历史
            </div>
            <div className="text-[13px] mt-0.5" style={{ color: "var(--ink-3)" }}>
              {project?.name ?? "项目"} · 查看过往生成的结果、Pipeline trace 与反馈
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadPage(true)}
            className="btn btn-sm btn-ghost"
            disabled={loading}
            style={{ color: "var(--ink-3)" }}
            title="刷新"
          >
            <RefreshCw size={12} strokeWidth={2}
                       style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
            刷新
          </button>
        </div>

        {/* Source filter */}
        <div className="flex gap-1.5 mb-4">
          {(["all", "manual", "auto"] as SourceFilter[]).map((s) => {
            const active = source === s;
            const label = s === "all" ? "全部" : SOURCE_LABEL[s].label;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className="rounded-full text-[12px] font-medium px-3 py-1"
                style={{
                  border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
                  background: active ? "var(--brand-soft)" : "#fff",
                  color: active ? "var(--brand)" : "var(--ink-2)",
                  transition: ".15s",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md p-3 mb-3 text-[12.5px] flex items-center gap-1.5"
               style={{ background: "rgba(179,38,30,.06)", color: "var(--err)" }}>
            <AlertCircle size={12} /> {error}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-[13px] text-center py-12" style={{ color: "var(--ink-4)" }}>
            加载中…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-[13px] text-center py-12" style={{ color: "var(--ink-4)" }}>
            还没有任何生成记录。去 Chat 主页提个问题试试 →
          </div>
        ) : (
          <>
            {rows.map((row) => (
              <HistoryRow
                key={row.id}
                row={row}
                expanded={expanded === row.id}
                onToggle={() => handleToggle(row.id)}
                feedback={feedbackCache[row.id] ?? null}
              />
            ))}
            {hasMore && (
              <div className="flex justify-center mt-4">
                <button
                  type="button"
                  onClick={() => loadPage(false)}
                  className="btn btn-sm btn-ghost"
                  disabled={loadingMore}
                  style={{ color: "var(--ink-3)" }}
                >
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}
            {!hasMore && rows.length > 0 && (
              <div className="text-[11.5px] text-center mt-4" style={{ color: "var(--ink-4)" }}>
                — 全部加载完毕 —
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
