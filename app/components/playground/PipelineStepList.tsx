"use client";

import { PIPELINE_STAGES, GROUP_LABELS, PipelineStage } from "@/lib/pipelineStages";
import { isStageActive } from "@/lib/pipelineDeps";
import { PipelineRun } from "@/lib/types";
import { StepRunMap } from "@/lib/types";

// 重新导出供现有 import 路径兼容（StageConfigPanel 等仍从此处导入）
export type { PipelineStage };
export { PIPELINE_STAGES };

interface Props {
  activeStage: PipelineStage;
  onSelectStage: (stage: PipelineStage) => void;
  pipelineRun: PipelineRun;
  stepRuns: StepRunMap;
  onToggleStep: (stageId: string, enabled: boolean) => void;
}

export default function PipelineStepList({
  activeStage,
  onSelectStage,
  pipelineRun,
  stepRuns,
  onToggleStep,
}: Props) {
  const groups: PipelineStage["group"][] = ["ingestion", "retrieval", "generation"];

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-zinc-200 overflow-y-auto flex flex-col py-1">
      {groups.map((group) => (
        <div key={group} className="mb-2">
          <div className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
            {GROUP_LABELS[group]}
          </div>

          {PIPELINE_STAGES.filter((s) => s.group === group).map((stage) => {
            const isActive = stage.id === activeStage.id;
            const active = isStageActive(stage, pipelineRun.enabledSteps, pipelineRun.runtimeContext);
            const latest = stepRuns[stage.id]?.[0];
            const isRequired = stage.category === "required";

            // 状态圆点颜色
            const dot = !active
              ? "bg-zinc-200"           // 已禁用
              : latest
                ? latest.status === "running"
                  ? "bg-blue-400 animate-pulse"
                  : latest.status === "success"
                  ? "bg-green-400"
                  : "bg-red-400"
                : null;

            return (
              <div key={stage.id} className="group relative">
                <button
                  onClick={() => onSelectStage(stage)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    isActive
                      ? "bg-zinc-900 text-white"
                      : !active
                      ? "text-zinc-300 hover:bg-zinc-50"
                      : "text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {/* 步骤名称 */}
                  <span className={`flex-1 truncate leading-snug ${!active && !isActive ? "line-through" : ""}`}>
                    {stage.name}
                  </span>

                  {/* 优化项标记 */}
                  {stage.category === "optimization" && active && (
                    <span className={`text-[9px] shrink-0 ${isActive ? "text-amber-300" : "text-amber-500"}`}>★</span>
                  )}

                  {/* 状态圆点 */}
                  {dot ? (
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                  ) : null}
                </button>

                {/* Toggle 开关（只对非 required 步骤显示） */}
                {!isRequired && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center">
                    <ToggleSwitch
                      checked={active}
                      isConditional={stage.category === "conditional"}
                      conditionKey={stage.conditionKey}
                      onChange={(val) => onToggleStep(stage.id, val)}
                      isActiveRow={isActive}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* 图例 */}
      <div className="mt-auto px-4 pb-3 pt-2 border-t border-zinc-100 flex flex-col gap-1">
        <p className="text-[9px] text-zinc-300 font-medium uppercase tracking-widest mb-0.5">图例</p>
        <Legend dot="bg-zinc-400" label="必选步骤" />
        <Legend dot="bg-zinc-300" label="可选（hover 切换）" />
        <Legend dot="bg-amber-400" label="★ 优化推荐" />
        <Legend dot="bg-zinc-200 border border-zinc-300" label="已禁用" />
      </div>
    </aside>
  );
}

// ─── 子组件 ───────────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  isConditional,
  conditionKey,
  onChange,
  isActiveRow,
}: {
  checked: boolean;
  isConditional: boolean;
  conditionKey?: string;
  onChange: (val: boolean) => void;
  isActiveRow: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      title={
        isConditional
          ? `条件步骤（触发条件：${conditionKey}）— 点击强制${checked ? "禁用" : "启用"}`
          : `点击${checked ? "禁用" : "启用"}此步骤`
      }
      className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors shrink-0 ${
        checked
          ? isActiveRow ? "bg-white/40" : "bg-zinc-400"
          : isActiveRow ? "bg-white/20" : "bg-zinc-200"
      }`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-3" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="text-[9px] text-zinc-400">{label}</span>
    </div>
  );
}
