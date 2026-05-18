"use client";

import { useState } from "react";
import { PipelineStage } from "./PipelineStepList";
import { StepRun } from "@/lib/types";

interface Props {
  stage: PipelineStage;
  runs: StepRun[];
}

export default function OutputTracePanel({ stage, runs }: Props) {
  const [selectedRunIdx, setSelectedRunIdx] = useState(0);

  const run = runs[selectedRunIdx];

  return (
    <aside className="w-80 shrink-0 bg-zinc-50 flex flex-col overflow-hidden border-l border-zinc-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Output / Trace
        </h3>
        {runs.length > 1 && (
          <select
            value={selectedRunIdx}
            onChange={(e) => setSelectedRunIdx(Number(e.target.value))}
            className="text-[10px] text-zinc-500 bg-transparent border-none outline-none cursor-pointer"
          >
            {runs.map((r, i) => (
              <option key={r.id} value={i}>
                Run #{runs.length - i}{" "}
                {r.status === "success" ? "✓" : r.status === "error" ? "✗" : "…"}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-0">
        {!run ? (
          <EmptyState stage={stage} />
        ) : (
          <>
            <StatusBar run={run} />
            {run.warnings && run.warnings.length > 0 && <WarningsSection warnings={run.warnings} />}
            {run.error && <ErrorSection error={run.error} />}
            {run.output !== undefined && <OutputSection output={run.output} />}
            {run.trace !== undefined && <TraceSection trace={run.trace} />}
          </>
        )}
      </div>
    </aside>
  );
}

function EmptyState({ stage }: { stage: PipelineStage }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-16 px-4">
      <div className="w-8 h-8 rounded border border-zinc-200 bg-white flex items-center justify-center text-zinc-300 text-xs font-mono">
        {}
      </div>
      <p className="text-xs text-zinc-400">
        运行 <span className="font-medium text-zinc-500">{stage.name}</span> 后，产物和 trace 会显示在这里。
      </p>
    </div>
  );
}

function StatusBar({ run }: { run: StepRun }) {
  const color =
    run.status === "running"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : run.status === "success"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-red-50 text-red-700 border-red-200";

  return (
    <div className={`flex items-center gap-2 px-4 py-2 border-b text-xs font-medium ${color}`}>
      {run.status === "running" && (
        <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
      )}
      <span className="capitalize">
        {run.status === "running" ? "运行中…" : run.status === "success" ? "成功" : "错误"}
      </span>
      {run.durationMs !== undefined && (
        <span className="ml-auto opacity-70">{run.durationMs}ms</span>
      )}
      <span className="opacity-50 font-mono">{run.methodId}</span>
    </div>
  );
}

function WarningsSection({ warnings }: { warnings: string[] }) {
  return (
    <section className="border-b border-zinc-200">
      <SectionHeader label="Warnings" count={warnings.length} defaultOpen />
      <div className="px-4 py-3 flex flex-col gap-1">
        {warnings.map((w, i) => (
          <p key={i} className="text-xs text-amber-700 leading-relaxed">
            ⚠ {w}
          </p>
        ))}
      </div>
    </section>
  );
}

function ErrorSection({ error }: { error: { code: string; message: string } }) {
  return (
    <section className="border-b border-zinc-200">
      <SectionHeader label="Error" defaultOpen />
      <div className="px-4 py-3">
        <p className="text-[10px] font-mono text-red-500 mb-1">{error.code}</p>
        <p className="text-xs text-red-700 leading-relaxed">{error.message}</p>
      </div>
    </section>
  );
}

function OutputSection({ output }: { output: unknown }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-zinc-200">
      <SectionHeader label="Output" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <pre className="px-4 py-3 text-[10px] font-mono text-zinc-700 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </section>
  );
}

function TraceSection({ trace }: { trace: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <SectionHeader label="Trace" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <pre className="px-4 py-3 text-[10px] font-mono text-zinc-500 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {JSON.stringify(trace, null, 2)}
        </pre>
      )}
    </section>
  );
}

function SectionHeader({
  label,
  count,
  open,
  defaultOpen,
  onToggle,
}: {
  label: string;
  count?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: () => void;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen ?? true);
  const isOpen = onToggle ? open : localOpen;
  const toggle = onToggle ?? (() => setLocalOpen((v) => !v));

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-600 transition-colors text-left"
    >
      <span>{isOpen ? "▾" : "▸"}</span>
      <span>{label}</span>
      {count !== undefined && (
        <span className="ml-1 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[8px] font-normal text-zinc-600">
          {count}
        </span>
      )}
    </button>
  );
}
