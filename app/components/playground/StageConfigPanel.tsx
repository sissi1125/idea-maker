"use client";

import { useState } from "react";
import { PipelineStage, PIPELINE_STAGES } from "./PipelineStepList";
import { PipelineRun } from "./PlaygroundShell";
import { StepRun } from "@/lib/types";
import { getStage, defaults } from "@/lib/stageRegistry";
import { DocumentRecord } from "@/lib/docStore";
import { getUpstream } from "@/lib/pipelineDeps";
import ParamForm from "./ParamForm";
import DocumentUploadPanel from "./DocumentUploadPanel";

interface Props {
  stage: PipelineStage;
  pipelineRun: PipelineRun;
  latestRun: StepRun | undefined;
  onRun: (stageId: string, methodId: string, params: Record<string, unknown>) => void;
  documents: DocumentRecord[];
  onDocumentUploaded: (doc: DocumentRecord) => void;
  onDocumentSelected: (doc: DocumentRecord) => void;
  onDocumentDeleted: (id: string) => void;
  /** 获取任意 stage 最新运行结果，用于检查上游状态 */
  getLatestRun: (stageId: string) => StepRun | undefined;
}

export default function StageConfigPanel({
  stage,
  pipelineRun,
  latestRun,
  onRun,
  documents,
  onDocumentUploaded,
  onDocumentSelected,
  onDocumentDeleted,
  getLatestRun,
}: Props) {
  const stageDef = getStage(stage.id);

  // 计算当前 stage 的阻塞状态和原因
  const blockReason = getBlockReason(stage.id, pipelineRun, getLatestRun);

  // 检测上游是否在当前 stage 上次运行之后又重跑了（说明当前结果可能已过时）
  const upstreamStale = checkUpstreamStale(stage.id, latestRun, getLatestRun);

  const firstMethod = stageDef?.methods[0];
  // 初始值直接从 stageDef 计算；stage 切换时 PlaygroundShell 传入 key={stage.id}
  // 让 React 重新挂载组件，自动重置所有 state，无需 useEffect
  const [selectedMethodId, setSelectedMethodId] = useState(firstMethod?.id ?? "");
  const [params, setParams] = useState<Record<string, unknown>>(
    firstMethod ? defaults(firstMethod) : {}
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleMethodChange = (methodId: string) => {
    const def = getStage(stage.id);
    const m = def?.methods.find((x) => x.id === methodId);
    setSelectedMethodId(methodId);
    setParams(m ? defaults(m) : {});
    setErrors({});
  };

  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const validate = (): boolean => {
    const def = getStage(stage.id);
    const method = def?.methods.find((m) => m.id === selectedMethodId);
    if (!method) return true;
    const errs: Record<string, string> = {};
    for (const param of method.params) {
      const val = params[param.key];
      if (param.required && (val === undefined || val === "" || val === null)) errs[param.key] = "必填";
      if (param.type === "number") {
        const n = Number(val);
        if (isNaN(n)) { errs[param.key] = "请输入数字"; continue; }
        if (param.min !== undefined && n < param.min) errs[param.key] = `最小值 ${param.min}`;
        if (param.max !== undefined && n > param.max) errs[param.key] = `最大值 ${param.max}`;
      }
      if (param.type === "json") {
        try { JSON.parse(typeof val === "string" ? val : JSON.stringify(val)); }
        catch { errs[param.key] = "JSON 格式错误"; }
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleRun = () => {
    if (!validate()) return;
    const def = getStage(stage.id);
    const method = def?.methods.find((m) => m.id === selectedMethodId);
    const coerced: Record<string, unknown> = { ...params };
    if (method) {
      for (const p of method.params) {
        if (p.type === "json" && typeof coerced[p.key] === "string") {
          try { coerced[p.key] = JSON.parse(coerced[p.key] as string); } catch { /* keep raw */ }
        }
      }
    }
    onRun(stage.id, selectedMethodId, coerced);
  };

  const isRunning = latestRun?.status === "running";
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <main className="flex-1 flex flex-col overflow-hidden border-r border-zinc-200 bg-white min-w-0">
      <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded">
          {stage.featureId}
        </span>
        <h2 className="text-sm font-semibold text-zinc-800">{stage.name}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
        {stage.id === "document-upload" ? (
          <DocumentUploadPanel
            documents={documents}
            selectedId={pipelineRun.selectedDocumentId}
            onUploaded={onDocumentUploaded}
            onSelect={onDocumentSelected}
            onDeleted={onDocumentDeleted}
          />
        ) : !stageDef ? (
          <UnimplementedNotice stage={stage} />
        ) : (
          <>
            {/* 上游已重跑警告 */}
            {upstreamStale && <StaleWarning upstreamId={getUpstream(stage.id)!} />}

            {/* Method selector */}
            {stageDef.methods.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Method</label>
                <div className="flex flex-wrap gap-2">
                  {stageDef.methods.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleMethodChange(m.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        m.id === selectedMethodId
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Params form */}
            {(() => {
              const method = stageDef.methods.find((m) => m.id === selectedMethodId);
              return method ? (
                <div className="flex flex-col gap-1.5">
                  {stageDef.methods.length === 1 && (
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                      {method.label}
                    </label>
                  )}
                  <ParamForm params={method.params} values={params} onChange={handleParamChange} errors={errors} />
                </div>
              ) : null;
            })()}

            {/* Run button */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleRun}
                disabled={isRunning || hasErrors || !!blockReason}
                className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${
                  isRunning || hasErrors || blockReason
                    ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                    : "bg-zinc-900 text-white hover:bg-zinc-700 active:bg-zinc-800"
                }`}
              >
                {isRunning ? (
                  <><span className="h-3 w-3 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />运行中…</>
                ) : "▶ 运行"}
              </button>
              {blockReason && <span className="text-xs text-amber-600">⚠ {blockReason}</span>}
              {!blockReason && hasErrors && <span className="text-xs text-red-500">请修正参数错误后再运行</span>}
              {!blockReason && latestRun?.status === "success" && (
                <span className="text-xs text-green-600">✓ 成功 {latestRun.durationMs}ms</span>
              )}
              {!blockReason && latestRun?.status === "error" && (
                <span className="text-xs text-red-500">✗ {latestRun.error?.code}</span>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 计算 stage 的阻塞原因。
 * 按优先级依次检查：
 *  1. 未选择文档（所有 ingestion stage 的前提条件）
 *  2. 上游 stage 尚未成功运行
 */
function getBlockReason(
  stageId: string,
  pipelineRun: PipelineRun,
  getLatestRun: (id: string) => StepRun | undefined
): string | null {
  // document-upload 本身不阻塞
  if (stageId === "document-upload") return null;

  // ingestion 链的所有 stage 都需要先选择文档
  if (!pipelineRun.selectedDocumentId) {
    return "未选择文档 — 请先在文档上传 & 文档库选择一个文档版本";
  }

  // 检查直接上游是否已成功运行
  const upstreamId = getUpstream(stageId);
  if (upstreamId && upstreamId !== "document-upload") {
    const upstreamRun = getLatestRun(upstreamId);
    if (!upstreamRun || upstreamRun.status !== "success") {
      const upstreamName = PIPELINE_STAGES.find((s) => s.id === upstreamId)?.name ?? upstreamId;
      return `需要先成功运行「${upstreamName}」才能继续`;
    }
  }

  return null;
}

/**
 * 检测上游是否在当前 stage 上次运行之后又重新跑了。
 * 如果是，说明当前 stage 的结果可能基于过时的输入，应该提示用户重新运行。
 */
function checkUpstreamStale(
  stageId: string,
  currentRun: StepRun | undefined,
  getLatestRun: (id: string) => StepRun | undefined
): boolean {
  if (!currentRun || currentRun.status !== "success") return false;
  const upstreamId = getUpstream(stageId);
  if (!upstreamId || upstreamId === "document-upload") return false;
  const upstreamRun = getLatestRun(upstreamId);
  // 上游比当前 stage 运行得更晚 → 当前结果已过时
  return !!upstreamRun && upstreamRun.startedAt > currentRun.startedAt;
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function StaleWarning({ upstreamId }: { upstreamId: string }) {
  const name = PIPELINE_STAGES.find((s) => s.id === upstreamId)?.name ?? upstreamId;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-xs text-blue-700 leading-relaxed">
        ↻ 上游「{name}」已重新运行，当前结果可能基于旧输入，建议重新运行本 stage。
      </p>
    </div>
  );
}

function UnimplementedNotice({ stage }: { stage: PipelineStage }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
      <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">○</div>
      <p className="text-sm font-medium text-zinc-600">{stage.name}</p>
      <p className="text-xs text-zinc-400 max-w-xs">该 stage 的实现尚未交付。</p>
      <span className="mt-2 inline-block rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-mono text-zinc-500">
        {stage.featureId} · 待实现
      </span>
    </div>
  );
}
