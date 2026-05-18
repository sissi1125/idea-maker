"use client";

import { useState, useEffect } from "react";
import { PipelineStage } from "./PipelineStepList";
import { PipelineRun } from "./PlaygroundShell";
import { StepRun } from "@/lib/types";
import { getStage, defaults } from "@/lib/stageRegistry";
import ParamForm from "./ParamForm";

interface Props {
  stage: PipelineStage;
  pipelineRun: PipelineRun;
  latestRun: StepRun | undefined;
  onRun: (stageId: string, methodId: string, params: Record<string, unknown>) => void;
}

export default function StageConfigPanel({ stage, pipelineRun, latestRun, onRun }: Props) {
  const stageDef = getStage(stage.id);
  const blocked = stage.id !== "document-upload" && !pipelineRun.selectedDocumentId;

  const firstMethod = stageDef?.methods[0];
  const [selectedMethodId, setSelectedMethodId] = useState(firstMethod?.id ?? "");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset method + params when stage changes
  useEffect(() => {
    const def = getStage(stage.id);
    const m = def?.methods[0];
    setSelectedMethodId(m?.id ?? "");
    setParams(m ? defaults(m) : {});
    setErrors({});
  }, [stage.id]);

  // Reset params when method changes
  const handleMethodChange = (methodId: string) => {
    const def = getStage(stage.id);
    const m = def?.methods.find((x) => x.id === methodId);
    setSelectedMethodId(methodId);
    setParams(m ? defaults(m) : {});
    setErrors({});
  };

  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validate = (): boolean => {
    const def = getStage(stage.id);
    const method = def?.methods.find((m) => m.id === selectedMethodId);
    if (!method) return true;

    const errs: Record<string, string> = {};
    for (const param of method.params) {
      const val = params[param.key];
      if (param.required && (val === undefined || val === "" || val === null)) {
        errs[param.key] = "必填";
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
    // Coerce JSON params from string to object
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
      {/* Stage header */}
      <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded">
          {stage.featureId}
        </span>
        <h2 className="text-sm font-semibold text-zinc-800">{stage.name}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
        {blocked ? (
          <BlockedNotice />
        ) : !stageDef ? (
          <UnimplementedNotice stage={stage} />
        ) : (
          <>
            {/* Method selector */}
            {stageDef.methods.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  Method
                </label>
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

            {/* Run button */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleRun}
                disabled={isRunning || hasErrors}
                className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${
                  isRunning || hasErrors
                    ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                    : "bg-zinc-900 text-white hover:bg-zinc-700 active:bg-zinc-800"
                }`}
              >
                {isRunning ? (
                  <>
                    <span className="h-3 w-3 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                    运行中…
                  </>
                ) : (
                  "▶ 运行"
                )}
              </button>
              {hasErrors && (
                <span className="text-xs text-red-500">请修正参数错误后再运行</span>
              )}
              {latestRun?.status === "success" && (
                <span className="text-xs text-green-600">✓ 成功 {latestRun.durationMs}ms</span>
              )}
              {latestRun?.status === "error" && (
                <span className="text-xs text-red-500">✗ {latestRun.error?.code}</span>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function BlockedNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <p className="font-medium mb-1">缺少文档输入</p>
      <p className="text-amber-700 text-xs leading-relaxed">
        该 stage 需要先选择一个文档版本作为 pipeline 输入。请切换到
        <strong> 文档上传 &amp; 文档库</strong> 上传或选择文档。
      </p>
    </div>
  );
}

function UnimplementedNotice({ stage }: { stage: PipelineStage }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
      <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
        ○
      </div>
      <p className="text-sm font-medium text-zinc-600">{stage.name}</p>
      <p className="text-xs text-zinc-400 max-w-xs">该 stage 的实现尚未交付。</p>
      <span className="mt-2 inline-block rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-mono text-zinc-500">
        {stage.featureId} · 待实现
      </span>
    </div>
  );
}
