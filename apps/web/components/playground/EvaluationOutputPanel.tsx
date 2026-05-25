"use client";

import type { StepRun } from "@/lib/types";
import type { EvaluationOutput, FaithfulnessResult } from "@/app/api/pipeline/evaluation/route";

interface EvaluationOutputPanelProps {
  runs: StepRun[];
}

function formatPct(n: number): string {
  return isNaN(n) ? "—" : `${(n * 100).toFixed(0)}%`;
}

function levelColor(level: "good" | "warning" | "poor"): string {
  return level === "good" ? "text-green-600" : level === "warning" ? "text-yellow-600" : "text-red-600";
}

function levelBg(level: "good" | "warning" | "poor"): string {
  return level === "good"
    ? "bg-green-50 border-green-200"
    : level === "warning"
    ? "bg-yellow-50 border-yellow-200"
    : "bg-red-50 border-red-200";
}

function barColor(level: "good" | "warning" | "poor"): string {
  return level === "good" ? "bg-green-500" : level === "warning" ? "bg-yellow-500" : "bg-red-500";
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
      <div
        className={`h-2 rounded-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value * 100)).toFixed(0)}%` }}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: number;
  detail: string;
  color: string;
}) {
  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-800">{formatPct(value)}</div>
      <ProgressBar value={value} color={color} />
      <div className="text-xs text-gray-400 mt-1">{detail}</div>
    </div>
  );
}

function FaithfulnessSection({ f }: { f: FaithfulnessResult }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">Faithfulness (LLM Judge)</span>
        <span
          className={`text-lg font-bold ${
            f.score >= 0.7 ? "text-green-600" : f.score >= 0.5 ? "text-yellow-600" : "text-red-600"
          }`}
        >
          {f.score.toFixed(2)}
        </span>
      </div>
      <p className="text-xs text-gray-600 mb-2">{f.reason}</p>
      {f.unsupportedClaims.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-yellow-700 font-medium">
            ▸ 无支撑主张（{f.unsupportedClaims.length} 条）
          </summary>
          <ul className="mt-1 pl-3 space-y-1">
            {f.unsupportedClaims.map((c, i) => (
              <li key={i} className="text-gray-600">
                · {c}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="text-xs text-gray-400 mt-1">
        model: {f.model} | {f.inputTokens}+{f.outputTokens} tokens
      </div>
    </div>
  );
}

export default function EvaluationOutputPanel({ runs }: EvaluationOutputPanelProps) {
  const latestRun = runs[runs.length - 1];

  if (!latestRun) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        运行 RAG 质量评估 Stage 后在此显示结果
      </div>
    );
  }

  if (latestRun.status === "running") {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm animate-pulse">
        评估中…
      </div>
    );
  }

  if (latestRun.status === "error") {
    const errMsg = (latestRun.output as { error?: { message?: string } } | null)?.error?.message ?? "运行失败";
    return (
      <div className="flex-1 p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {errMsg}
        </div>
      </div>
    );
  }

  const output = latestRun.output as EvaluationOutput | null;
  if (!output) return null;

  const color = barColor(output.level);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${levelBg(output.level)}`}>
        <span className="text-sm font-medium text-gray-700">RAG Quality Evaluation</span>
        <span className={`text-sm font-bold ${levelColor(output.level)}`}>
          ● {output.level === "good" ? "良好" : output.level === "warning" ? "警告" : "较差"}
        </span>
      </div>
      <div className="text-xs text-gray-400">
        method: {output.method} | {output.durationMs}ms
      </div>

      {/* 三指标卡片 */}
      <div className="flex gap-2">
        <MetricCard
          label="检索命中率"
          value={output.hitRate}
          detail={`score ≥ ${output.scoreThreshold}`}
          color={color}
        />
        <MetricCard
          label="引用覆盖率"
          value={output.citationCoverage}
          detail={`${output.citedCount}/${output.totalEvidence} cited`}
          color={color}
        />
        <MetricCard
          label="置信度"
          value={output.confidenceScore}
          detail="cited evidence 平均分"
          color={color}
        />
      </div>

      {/* Faithfulness */}
      {output.faithfulness && <FaithfulnessSection f={output.faithfulness} />}

      {/* Warnings */}
      {output.warnings.length > 0 && (
        <div className="space-y-1">
          {output.warnings.map((w, i) => (
            <div
              key={i}
              className="flex gap-1.5 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1.5"
            >
              <span>⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
