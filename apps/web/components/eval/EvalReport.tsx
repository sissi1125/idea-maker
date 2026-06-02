/**
 * EvalReport — feat-300.6 任务 9
 *
 * 整页组件：趋势图 + 最近 N 次 runs 列表 + 「立即运行 eval」按钮。
 *
 * 设计要点：
 *   - 「立即运行 eval」同步阻塞（30 条 golden ≈ 60s+），SSE 进度推流是 feat-300.7
 *     UI 兜底：disable + spinner + 提示文案；超 70s 给「这通常要 60-120 秒」提示
 *   - 列表按时间倒序（最新在前）；趋势图按时间正序（旧 → 新）
 *   - 空数据态给操作提示：跑 `pnpm eval` 或点上面的按钮
 */

"use client";

import { useEffect, useState } from "react";
import {
  Play,
  Loader2,
  Activity,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { evalApi, type EvalRunRowLite } from "@/lib/api";
import { EvalTrendChart } from "./EvalTrendChart";
import { EvalRunDrawer } from "./EvalRunDrawer";

interface EvalReportProps {
  projectId: string;
}

export function EvalReport({ projectId }: EvalReportProps) {
  const [runs, setRuns] = useState<EvalRunRowLite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // 运行状态
  const [running, setRunning] = useState(false);
  const [runProgressMsg, setRunProgressMsg] = useState<string | null>(null);
  const [lastRunError, setLastRunError] = useState<string | null>(null);

  const loadRuns = async () => {
    try {
      const list = await evalApi.listEvalRuns(projectId, { limit: 20 });
      setRuns(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "加载失败");
    }
  };

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 点「立即运行」时，70s 后提示用户耐心
  useEffect(() => {
    if (!running) {
      setRunProgressMsg(null);
      return;
    }
    setRunProgressMsg("正在跑 golden 集...");
    const t1 = setTimeout(() => {
      setRunProgressMsg("仍在运行——一次完整 eval 通常需要 60-120 秒");
    }, 30_000);
    return () => clearTimeout(t1);
  }, [running]);

  const handleRunEval = async () => {
    if (running) return;
    setRunning(true);
    setLastRunError(null);
    try {
      await evalApi.runEval(projectId, { triggeredBy: "manual" });
      await loadRuns();
    } catch (err) {
      setLastRunError(err instanceof Error ? err.message : "运行失败");
    } finally {
      setRunning(false);
    }
  };

  // 派生：趋势点（按时间正序）
  const trendPoints = (runs ?? [])
    .slice()
    .reverse()
    .map((r) => ({
      date: r.finishedAt ?? r.createdAt,
      avg: r.avgOverall,
      label: `${formatShort(r.finishedAt ?? r.createdAt)} · ${r.triggeredBy}`,
    }));

  // 派生：选中的 run + 其 baseline
  const selectedRun = runs?.find((r) => r.id === selectedRunId) ?? null;
  const selectedBaseline =
    selectedRun && selectedRun.baselineRunId
      ? (runs?.find((r) => r.id === selectedRun.baselineRunId) ?? null)
      : null;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-semibold text-gray-900">
            <Activity size={18} className="text-emerald-600" />
            Eval 报告
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            离线评估：用 LLM-as-judge 三维（faithfulness / completeness / style）
            打分 + 工具调用路径对比，每次跑给 avg.overall。趋势线监控回归。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadRuns}
            disabled={running}
            className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded border text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            title="刷新列表"
          >
            <RefreshCw size={12} />
            刷新
          </button>
          <button
            type="button"
            onClick={handleRunEval}
            disabled={running}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {running ? "运行中…" : "立即运行 eval"}
          </button>
        </div>
      </header>

      {/* 运行进度 / 错误 */}
      {runProgressMsg && (
        <div className="text-xs px-3 py-2 bg-blue-50 border border-blue-200 text-blue-800 rounded inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" />
          {runProgressMsg}
        </div>
      )}
      {lastRunError && (
        <div className="text-xs px-3 py-2 bg-red-50 border border-red-200 text-red-800 rounded inline-flex items-center gap-2">
          <AlertTriangle size={12} />
          {lastRunError}
        </div>
      )}

      {/* 趋势图 */}
      <section className="border rounded p-4 bg-white">
        <h2 className="text-sm font-medium text-gray-700 mb-3">avg.overall 趋势</h2>
        <EvalTrendChart points={trendPoints} />
      </section>

      {/* Runs 列表 */}
      <section>
        <h2 className="text-sm font-medium text-gray-700 mb-2">最近的 runs</h2>
        {loadError ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            加载失败：{loadError}
          </div>
        ) : runs === null ? (
          <div className="text-sm text-gray-500 inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            加载中…
          </div>
        ) : runs.length === 0 ? (
          <div className="text-sm text-gray-400 italic p-4 border border-dashed rounded">
            暂无评估记录。点上方「立即运行 eval」或在命令行执行 <code className="px-1 bg-gray-100 rounded">pnpm eval</code>。
          </div>
        ) : (
          <div className="border rounded divide-y bg-white">
            {runs.map((r) => (
              <RunListItem
                key={r.id}
                run={r}
                onSelect={() => setSelectedRunId(r.id)}
              />
            ))}
          </div>
        )}
      </section>

      <EvalRunDrawer
        run={selectedRun}
        baseline={selectedBaseline}
        onClose={() => setSelectedRunId(null)}
      />
    </div>
  );
}

function RunListItem({
  run,
  onSelect,
}: {
  run: EvalRunRowLite;
  onSelect: () => void;
}) {
  const passRate =
    run.totalItems === 0 ? null : (run.passedItems / run.totalItems) * 100;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left"
    >
      <span
        className={`shrink-0 w-2 h-2 rounded-full ${
          run.status === "succeeded"
            ? "bg-emerald-500"
            : run.status === "failed"
              ? "bg-red-500"
              : "bg-blue-500 animate-pulse"
        }`}
      />
      <span className="flex-1 min-w-0">
        <span className="text-sm text-gray-800">
          {formatDateTime(run.finishedAt ?? run.createdAt)}
        </span>
        <span className="ml-2 text-xs text-gray-400">{run.triggeredBy}</span>
      </span>
      <span className="text-xs text-gray-500 tabular-nums shrink-0">
        {run.avgOverall === null ? "—" : run.avgOverall.toFixed(2)}
      </span>
      <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
        {passRate === null ? "—" : `${passRate.toFixed(0)}%`}
      </span>
      <ExternalLink size={12} className="text-gray-400 shrink-0" />
    </button>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
