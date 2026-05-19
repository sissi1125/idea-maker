"use client";

import { useState } from "react";
import type { PipelineStage } from "@/lib/pipelineStages";
import { PIPELINE_STAGES, INGESTION_STAGE_IDS } from "@/lib/pipelineStages";
import { PipelineRun, StepRun } from "@/lib/types";
import { getStage, defaults } from "@/lib/stageRegistry";
import { DocumentRecord } from "@/lib/docStore";
import { getUpstream, resolveEffectiveUpstream, isStageActive } from "@/lib/pipelineDeps";
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
  getLatestRun: (stageId: string) => StepRun | undefined;
  /** 切换 stage 再切回时恢复上次选择的 method */
  initialMethodId?: string;
  /** 切换 stage 再切回时恢复上次填写的 params */
  initialParams?: Record<string, unknown>;
  /** 每次 method 或 param 变更时回传给父组件，用于跨 stage 切换持久化 */
  onParamsChange?: (stageId: string, methodId: string, params: Record<string, unknown>) => void;
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
  initialMethodId,
  initialParams,
  onParamsChange,
}: Props) {
  const stageDef = getStage(stage.id);
  const isImplemented = !stageDef || stageDef.implemented !== false;

  const blockReason = getBlockReason(stage, pipelineRun, getLatestRun);
  const upstreamStale = checkUpstreamStale(stage.id, latestRun, getLatestRun);

  const firstMethod = stageDef?.methods[0];
  // 优先使用父组件传入的持久化值，没有则用 stageRegistry 默认值
  const [selectedMethodId, setSelectedMethodId] = useState(
    initialMethodId ?? firstMethod?.id ?? ""
  );
  const [params, setParams] = useState<Record<string, unknown>>(
    initialParams ?? (firstMethod ? defaults(firstMethod) : {})
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleMethodChange = (methodId: string) => {
    const m = stageDef?.methods.find((x) => x.id === methodId);
    const newParams = m ? defaults(m) : {};
    setSelectedMethodId(methodId);
    setParams(newParams);
    setErrors({});
    onParamsChange?.(stage.id, methodId, newParams);
  };

  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => {
      const next = { ...prev, [key]: value };
      onParamsChange?.(stage.id, selectedMethodId, next);
      return next;
    });
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const validate = (): boolean => {
    const method = stageDef?.methods.find((m) => m.id === selectedMethodId);
    if (!method) return true;
    const errs: Record<string, string> = {};
    for (const param of method.params) {
      const val = params[param.key];
      if (param.required && (val === undefined || val === "" || val === null)) {
        errs[param.key] = "必填";
        continue;
      }
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
    const method = stageDef?.methods.find((m) => m.id === selectedMethodId);
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
  // 当前 stage 是否处于启用状态（required 始终 true；optional/conditional 受 enabledSteps 控制）
  const stageActive = isStageActive(stage, pipelineRun.enabledSteps, pipelineRun.runtimeContext);
  // Run 按钮禁用：运行中 / 参数错误 / 被阻塞 / API 未实现 / 步骤已关闭
  const runDisabled = isRunning || hasErrors || !!blockReason || !isImplemented || !stageActive;

  return (
    <main className="flex-1 flex flex-col overflow-hidden border-r border-zinc-200 bg-white min-w-0">
      {/* 标题栏 */}
      <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded">
          {stage.featureId}
        </span>
        <h2 className="text-sm font-semibold text-zinc-800">{stage.name}</h2>
        {/* 步骤分类标签 */}
        <CategoryBadge category={stage.category} />
        {!isImplemented && (
          <span className="ml-auto text-[10px] bg-amber-50 text-amber-600 border border-amber-200 rounded px-1.5 py-0.5">
            参数预览 · API 尚未实现
          </span>
        )}
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
          <UnregisteredNotice stage={stage} />
        ) : (
          <>
            {upstreamStale && (
              <StaleWarning upstreamId={getUpstream(stage.id)!} />
            )}

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
                  <ParamForm
                    params={method.params}
                    values={params}
                    onChange={handleParamChange}
                    errors={errors}
                  />
                </div>
              ) : null;
            })()}

            {/* Run button + 状态 */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleRun}
                disabled={runDisabled}
                className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${
                  runDisabled
                    ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                    : "bg-zinc-900 text-white hover:bg-zinc-700 active:bg-zinc-800"
                }`}
              >
                {isRunning ? (
                  <>
                    <span className="h-3 w-3 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                    运行中…
                  </>
                ) : "▶ 运行"}
              </button>

              {/* 优先级：步骤已关闭 > 阻塞 > 未实现 > 参数错误 > 成功/错误 */}
              {!stageActive && (
                <span className="text-xs text-zinc-400">步骤已关闭 — 在左侧开关开启后可运行</span>
              )}
              {stageActive && blockReason && <span className="text-xs text-amber-600">⚠ {blockReason}</span>}
              {stageActive && !blockReason && !isImplemented && (
                <span className="text-xs text-amber-600">API 路由尚未实现，参数仅供预览</span>
              )}
              {stageActive && !blockReason && isImplemented && hasErrors && (
                <span className="text-xs text-red-500">请修正参数错误后再运行</span>
              )}
              {stageActive && !blockReason && isImplemented && !hasErrors && latestRun?.status === "success" && (
                <span className="text-xs text-green-600">✓ 成功 {latestRun.durationMs}ms</span>
              )}
              {stageActive && !blockReason && isImplemented && !hasErrors && latestRun?.status === "error" && (
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
 *
 * Ingestion 链：需要先选择文档
 * Query 链：不需要文档，但需要上游有效运行结果
 *
 * 使用 resolveEffectiveUpstream 跳过被禁用的可选步骤，
 * 因此当可选步骤被禁用时，下游不会被错误阻塞。
 */
function getBlockReason(
  stage: PipelineStage,
  pipelineRun: PipelineRun,
  getLatestRun: (id: string) => StepRun | undefined
): string | null {
  if (stage.id === "document-upload") return null;

  // Ingestion 链：所有步骤都需要先选择文档
  if (INGESTION_STAGE_IDS.has(stage.id)) {
    if (!pipelineRun.selectedDocumentId) {
      return "未选择文档 — 请先在文档上传 & 文档库选择一个文档版本";
    }
  }

  // 查找有效上游（跳过被禁用的步骤）
  const upstreamId = resolveEffectiveUpstream(
    stage.id,
    pipelineRun.enabledSteps,
    pipelineRun.runtimeContext
  );

  // 无上游（入口步骤）或上游是 document-upload（由文档选择状态控制）
  if (!upstreamId || upstreamId === "document-upload") return null;

  const upstreamRun = getLatestRun(upstreamId);
  if (!upstreamRun || upstreamRun.status !== "success") {
    const upstreamName = PIPELINE_STAGES.find((s) => s.id === upstreamId)?.name ?? upstreamId;
    return `需要先成功运行「${upstreamName}」才能继续`;
  }

  return null;
}

/**
 * 检测上游是否在当前 stage 上次运行之后又重新跑了。
 * 使用 getUpstream（直接链）而非 resolveEffectiveUpstream，
 * 避免因可选步骤状态变化导致误判。
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
  return !!upstreamRun && upstreamRun.startedAt > currentRun.startedAt;
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: PipelineStage["category"] }) {
  const map: Record<PipelineStage["category"], { label: string; cls: string }> = {
    required:     { label: "必选", cls: "bg-zinc-100 text-zinc-500" },
    optional:     { label: "可选", cls: "bg-blue-50 text-blue-500" },
    optimization: { label: "优化", cls: "bg-amber-50 text-amber-600" },
    conditional:  { label: "条件", cls: "bg-purple-50 text-purple-500" },
  };
  const { label, cls } = map[category];
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
  );
}

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

function UnregisteredNotice({ stage }: { stage: PipelineStage }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
      <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">○</div>
      <p className="text-sm font-medium text-zinc-600">{stage.name}</p>
      <p className="text-xs text-zinc-400 max-w-xs">该 stage 暂无 stageRegistry 配置。</p>
      <span className="mt-2 inline-block rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-mono text-zinc-500">
        {stage.featureId} · 配置缺失
      </span>
    </div>
  );
}
