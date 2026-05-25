"use client";

import { useState } from "react";
import type { PipelineStage } from "@/lib/pipelineStages";
import type { StepRunMap, StepRun, PipelineRunRecord, PipelineRunStageEntry } from "@/lib/types";
import { JsonView, truncateStrings } from "./JsonView";

interface PipelineTraceDrawerProps {
  open: boolean;
  onClose: () => void;
  stepRuns: StepRunMap;
  stages: PipelineStage[];
  enabledSteps: Record<string, boolean>;
  pipelineRunHistory: PipelineRunRecord[];
}

const CATEGORY_LABEL: Record<string, string> = {
  ingestion: "Ingestion",
  retrieval: "Retrieval",
  generation: "Generation",
};

export default function PipelineTraceDrawer({
  open, onClose, stepRuns, stages, enabledSteps, pipelineRunHistory,
}: PipelineTraceDrawerProps) {
  const [tab, setTab] = useState<"current" | "history">("current");
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedHistoryRun, setExpandedHistoryRun] = useState<string | null>(null);
  const [expandedHistoryStage, setExpandedHistoryStage] = useState<string | null>(null);

  const drawerH = open ? "h-[40vh]" : "h-8";

  // 按 group 分组（ingestion / retrieval / generation）
  const grouped = stages.reduce<Record<string, PipelineStage[]>>((acc, s) => {
    const cat = s.group;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 shadow-lg transition-[height] duration-200 z-40 flex flex-col ${drawerH}`}
    >
      {/* 拉条 / 标题栏 */}
      <div
        className="flex items-center gap-3 px-4 h-8 shrink-0 border-b border-zinc-100 cursor-pointer select-none"
        onClick={!open ? () => { /* 点击拉条时展开逻辑由 PlaygroundShell 处理 */ } : undefined}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          🔗 Pipeline 全链路追踪
        </span>
        {open && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setTab("current"); }}
              className={`text-[10px] px-2 py-0.5 rounded ${tab === "current" ? "bg-zinc-100 text-zinc-700 font-medium" : "text-zinc-400 hover:text-zinc-600"}`}
            >
              当前运行
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setTab("history"); }}
              className={`text-[10px] px-2 py-0.5 rounded ${tab === "history" ? "bg-zinc-100 text-zinc-700 font-medium" : "text-zinc-400 hover:text-zinc-600"}`}
            >
              历史记录 {pipelineRunHistory.length > 0 && `(${pipelineRunHistory.length})`}
            </button>
          </>
        )}
        <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-zinc-600 text-[10px]">
          {open ? "▼ 收起" : "▲ 展开"}
        </button>
      </div>

      {/* 内容区 */}
      {open && (
        <div className="flex-1 overflow-y-auto">
          {tab === "current" && (
            <CurrentTab
              grouped={grouped}
              stepRuns={stepRuns}
              enabledSteps={enabledSteps}
              expandedStage={expandedStage}
              onToggleStage={(id) => setExpandedStage((prev) => prev === id ? null : id)}
            />
          )}
          {tab === "history" && (
            <HistoryTab
              runs={pipelineRunHistory}
              expandedRun={expandedHistoryRun}
              expandedStage={expandedHistoryStage}
              onToggleRun={(id) => {
                setExpandedHistoryRun((prev) => prev === id ? null : id);
                setExpandedHistoryStage(null);
              }}
              onToggleStage={(id) => setExpandedHistoryStage((prev) => prev === id ? null : id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── 当前运行 Tab ──────────────────────────────────────────────────────────────

function CurrentTab({ grouped, stepRuns, enabledSteps, expandedStage, onToggleStage }: {
  grouped: Record<string, PipelineStage[]>;
  stepRuns: StepRunMap;
  enabledSteps: Record<string, boolean>;
  expandedStage: string | null;
  onToggleStage: (id: string) => void;
}) {
  return (
    <div className="p-3 space-y-3">
      {Object.entries(grouped).map(([cat, stageList]) => (
        <div key={cat}>
          <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 mb-1">
            {CATEGORY_LABEL[cat] ?? cat}
          </div>
          <div className="space-y-0.5">
            {stageList.map((s) => {
              const latestRun = stepRuns[s.id]?.[0];
              const isDisabled = enabledSteps[s.id] === false;
              return (
                <StageRow
                  key={s.id}
                  stage={s}
                  latestRun={latestRun}
                  isDisabled={isDisabled}
                  expanded={expandedStage === s.id}
                  onToggle={() => onToggleStage(s.id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function StageRow({ stage, latestRun, isDisabled, expanded, onToggle }: {
  stage: PipelineStage;
  latestRun: StepRun | undefined;
  isDisabled: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusColor = !latestRun || isDisabled ? "bg-zinc-200"
    : latestRun.status === "success" ? "bg-green-400"
    : latestRun.status === "error" ? "bg-red-400"
    : latestRun.status === "running" ? "bg-blue-400 animate-pulse"
    : "bg-zinc-200";

  return (
    <div>
      <button
        onClick={latestRun ? onToggle : undefined}
        className="w-full flex items-center gap-2 text-left px-2 py-1 rounded hover:bg-zinc-50 group"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
        <span className={`text-[10px] font-mono ${isDisabled ? "text-zinc-300 line-through" : "text-zinc-600"}`}>
          {stage.id}
        </span>
        {latestRun && (
          <>
            <span className="text-[9px] text-zinc-400 font-mono">{latestRun.methodId}</span>
            <span className="text-[9px] text-zinc-300 ml-auto">{latestRun.durationMs}ms</span>
          </>
        )}
        {latestRun && (
          <span className="text-[9px] text-zinc-300 group-hover:text-zinc-500">{expanded ? "▾" : "▸"}</span>
        )}
      </button>
      {expanded && latestRun && (
        <div className="ml-4 mt-0.5 border-l border-zinc-100 pl-2 space-y-1">
          {latestRun.output !== undefined && (
            <div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Output</div>
              <JsonView value={truncateStrings(latestRun.output)} />
            </div>
          )}
          {latestRun.trace !== undefined && (
            <div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Trace</div>
              <JsonView value={truncateStrings(latestRun.trace)} />
            </div>
          )}
          {latestRun.error && (
            <div className="text-[9px] text-red-600 font-mono">
              {latestRun.error.code}: {latestRun.error.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 历史记录 Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ runs, expandedRun, expandedStage, onToggleRun, onToggleStage }: {
  runs: PipelineRunRecord[];
  expandedRun: string | null;
  expandedStage: string | null;
  onToggleRun: (id: string) => void;
  onToggleStage: (id: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-zinc-400 py-8">
        暂无历史记录。运行 pipeline 后点击「💾 保存 Run」保存。
      </div>
    );
  }
  return (
    <div className="p-3 space-y-1">
      {runs.map((run) => (
        <div key={run.id}>
          <button
            onClick={() => onToggleRun(run.id)}
            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-zinc-50"
          >
            <span className="text-[10px] font-medium text-zinc-700">{run.name}</span>
            <span className="text-[9px] text-zinc-400">{run.stageCount} stages</span>
            <span className="text-[9px] text-zinc-300 ml-auto">
              {new Date(run.createdAt).toLocaleString("zh-CN", {
                month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
              })}
            </span>
            <span className="text-[9px] text-zinc-300">{expandedRun === run.id ? "▾" : "▸"}</span>
          </button>
          {expandedRun === run.id && (
            <div className="ml-2 space-y-0.5 border-l border-zinc-100 pl-2">
              {Object.entries(run.stages).map(([sid, entry]) => (
                <HistoryStageRow
                  key={sid}
                  stageId={sid}
                  entry={entry}
                  expanded={expandedStage === sid}
                  onToggle={() => onToggleStage(sid)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HistoryStageRow({ stageId, entry, expanded, onToggle }: {
  stageId: string;
  entry: PipelineRunStageEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dotColor = entry.status === "success" ? "bg-green-400"
    : entry.status === "error" ? "bg-red-400"
    : "bg-zinc-200";
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 text-left px-1 py-0.5 rounded hover:bg-zinc-50"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-[10px] font-mono text-zinc-600">{stageId}</span>
        <span className="text-[9px] text-zinc-400">{entry.methodId}</span>
        <span className="text-[9px] text-zinc-300 ml-auto">{entry.durationMs}ms</span>
        <span className="text-[9px] text-zinc-300">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-zinc-100 pl-2">
          {entry.output !== undefined && <JsonView value={truncateStrings(entry.output)} />}
        </div>
      )}
    </div>
  );
}
