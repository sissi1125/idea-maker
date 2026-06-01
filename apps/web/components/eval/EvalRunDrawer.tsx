/**
 * EvalRunDrawer — feat-300.6 任务 9
 *
 * 单条 eval_run 详情面板（侧滑抽屉）。
 *
 * 数据来源：GET /projects/:id/eval/runs/:runId 返回 EvalRunRowLite。
 * 暂未实现获取 eval_items 明细的 API（后端 endpoint 待加），所以只展示 summary。
 * TODO: 后端补 GET /eval/runs/:runId/items → 抽屉里渲染 per-item passed/failed 列表
 */

"use client";

import { X, GitBranch, GitCommit, Clock, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { EvalRunRowLite } from "@/lib/api";

interface EvalRunDrawerProps {
  run: EvalRunRowLite | null;
  baseline?: EvalRunRowLite | null;
  onClose: () => void;
}

export function EvalRunDrawer({ run, baseline, onClose }: EvalRunDrawerProps) {
  if (!run) return null;

  const delta =
    run.avgOverall !== null && baseline?.avgOverall !== null && baseline?.avgOverall !== undefined
      ? run.avgOverall - baseline.avgOverall
      : null;
  const passRate = run.totalItems === 0 ? null : (run.passedItems / run.totalItems) * 100;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 h-screen w-[420px] max-w-[90vw] bg-white shadow-xl z-50 overflow-y-auto"
        role="dialog"
        aria-label="Eval run 详情"
      >
        <header className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Eval Run 详情</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </header>
        <div className="p-4 space-y-4 text-sm">
          {/* 状态卡 */}
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            <span className="text-xs text-gray-500">
              触发：{run.triggeredBy}
            </span>
          </div>

          {/* 元数据 */}
          <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 gap-x-2 text-xs">
            <dt className="text-gray-500 inline-flex items-center gap-1">
              <Clock size={11} /> 开始
            </dt>
            <dd className="text-gray-800">{formatDateTime(run.createdAt)}</dd>
            {run.finishedAt && (
              <>
                <dt className="text-gray-500 inline-flex items-center gap-1">
                  <Clock size={11} /> 结束
                </dt>
                <dd className="text-gray-800">{formatDateTime(run.finishedAt)}</dd>
              </>
            )}
            {run.gitBranch && (
              <>
                <dt className="text-gray-500 inline-flex items-center gap-1">
                  <GitBranch size={11} /> 分支
                </dt>
                <dd className="text-gray-800 font-mono">{run.gitBranch}</dd>
              </>
            )}
            {run.gitCommit && (
              <>
                <dt className="text-gray-500 inline-flex items-center gap-1">
                  <GitCommit size={11} /> Commit
                </dt>
                <dd className="text-gray-800 font-mono text-[11px]">
                  {run.gitCommit.slice(0, 12)}
                </dd>
              </>
            )}
            <dt className="text-gray-500">阈值</dt>
            <dd className="text-gray-800">下降 &gt; {run.thresholdDrop} 则 CI fail</dd>
          </dl>

          {/* 通过率 */}
          <section>
            <div className="text-xs text-gray-500 mb-1">通过率</div>
            <div className="text-xl font-semibold tabular-nums">
              {run.passedItems} / {run.totalItems}
              {passRate !== null && (
                <span className="text-xs text-gray-400 ml-2 font-normal">
                  ({passRate.toFixed(0)}%)
                </span>
              )}
            </div>
          </section>

          {/* 三维 + overall */}
          <section className="space-y-1.5">
            <div className="text-xs text-gray-500">评分</div>
            <ScoreRow label="faithfulness" value={run.avgFaithfulness} />
            <ScoreRow label="completeness" value={run.avgCompleteness} />
            <ScoreRow label="style" value={run.avgStyle} />
            <ScoreRow label="overall" value={run.avgOverall} highlight />
          </section>

          {/* vs baseline */}
          {baseline && (
            <section className="border-t pt-3">
              <div className="text-xs text-gray-500 mb-1">vs baseline</div>
              <div className="text-xs text-gray-600 mb-1.5">
                {formatDateTime(baseline.createdAt)} · overall {baseline.avgOverall?.toFixed(2) ?? "—"}
              </div>
              {delta !== null && (
                <div
                  className={`inline-flex items-center gap-1 text-sm font-medium ${
                    delta > 0.1
                      ? "text-emerald-700"
                      : delta < -0.1
                        ? "text-red-700"
                        : "text-gray-600"
                  }`}
                >
                  {delta > 0.1 ? <TrendingUp size={14} /> : delta < -0.1 ? <TrendingDown size={14} /> : <Minus size={14} />}
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(3)}
                  {-delta > run.thresholdDrop && (
                    <span className="ml-2 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                      超阈值
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* error */}
          {run.status === "failed" && (
            <section className="border-t pt-3">
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                <div className="font-medium mb-0.5">执行异常</div>
                <div className="text-[11px]">本次跑没能完成；通常是 LLM 配置 / DB / golden 文件问题</div>
              </div>
            </section>
          )}

          <div className="text-[11px] text-gray-400 pt-3 border-t">
            ID: <code className="font-mono">{run.id}</code>
          </div>
        </div>
      </aside>
    </>
  );
}

function StatusBadge({ status }: { status: EvalRunRowLite["status"] }) {
  const map = {
    running: "text-blue-700 bg-blue-50 border-blue-200",
    succeeded: "text-emerald-700 bg-emerald-50 border-emerald-200",
    failed: "text-red-700 bg-red-50 border-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

function ScoreRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className={highlight ? "font-medium text-gray-800" : "text-gray-600"}>
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${
          highlight ? "text-base text-gray-900 font-semibold" : "text-gray-700"
        }`}
      >
        {value === null ? "—" : value.toFixed(3)}
      </span>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}
