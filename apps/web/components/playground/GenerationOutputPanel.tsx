"use client";

import { useState } from "react";
import { StepRun } from "@/lib/types";
import type {
  ProductPersonaOutput,
  SellingPointsOutput,
  ContentIdeasOutput,
} from "@harness/shared-types";

interface Props {
  runs: StepRun[];
}

export default function GenerationOutputPanel({ runs }: Props) {
  const [selectedRunIdx, setSelectedRunIdx] = useState(0);
  const run = runs[selectedRunIdx];

  return (
    <aside className="w-80 shrink-0 bg-zinc-50 flex flex-col overflow-hidden border-l border-zinc-200">
      {/* 标题栏 + 运行历史选择 */}
      <div className="px-4 py-3 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">营销内容</h3>
        {runs.length > 1 && (
          <select
            value={selectedRunIdx}
            onChange={(e) => setSelectedRunIdx(Number(e.target.value))}
            className="text-[10px] text-zinc-500 bg-transparent border-none outline-none cursor-pointer"
          >
            {runs.map((r, i) => (
              <option key={r.id} value={i}>
                Run #{runs.length - i} {r.status === "success" ? "✓" : r.status === "error" ? "✗" : "…"}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">
        {!run ? (
          <EmptyGenState />
        ) : (
          <>
            <StatusBar run={run} />
            {run.warnings && run.warnings.length > 0 && <WarningsSection warnings={run.warnings} />}
            {run.error && <ErrorSection error={run.error} />}
            {run.output !== undefined && run.status === "success" && (
              <GenOutputSection methodId={run.methodId} output={run.output} />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// ─── 空状态 ───────────────────────────────────────────────────────────────────

function EmptyGenState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-16 px-4">
      <div className="w-8 h-8 rounded border border-zinc-200 bg-white flex items-center justify-center text-zinc-300 text-lg">💡</div>
      <p className="text-xs text-zinc-400">
        运行 <span className="font-medium text-zinc-500">Generation</span> 后，营销内容将显示在这里。
      </p>
    </div>
  );
}

// ─── 状态栏 ───────────────────────────────────────────────────────────────────

function StatusBar({ run }: { run: StepRun }) {
  const color =
    run.status === "running" ? "bg-blue-50 text-blue-700 border-blue-200"
    : run.status === "success" ? "bg-green-50 text-green-700 border-green-200"
    : "bg-red-50 text-red-700 border-red-200";
  return (
    <div className={`flex items-center gap-2 px-4 py-2 border-b text-xs font-medium ${color}`}>
      {run.status === "running" && <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />}
      <span>{run.status === "running" ? "生成中…" : run.status === "success" ? "成功" : "错误"}</span>
      {run.durationMs !== undefined && <span className="ml-auto opacity-70">{run.durationMs}ms</span>}
      <span className="opacity-50 font-mono text-[10px]">{run.methodId}</span>
    </div>
  );
}

function WarningsSection({ warnings }: { warnings: string[] }) {
  return (
    <div className="px-4 py-2 border-b border-zinc-200 bg-amber-50">
      {warnings.map((w, i) => (
        <p key={i} className="text-[10px] text-amber-700">⚠ {w}</p>
      ))}
    </div>
  );
}

function ErrorSection({ error }: { error: { code: string; message: string } }) {
  return (
    <div className="px-4 py-3 border-b border-zinc-200">
      <p className="text-[10px] font-mono text-red-500 mb-1">{error.code}</p>
      <p className="text-xs text-red-700 leading-relaxed">{error.message}</p>
    </div>
  );
}

// ─── 内容区路由 ───────────────────────────────────────────────────────────────

function GenOutputSection({ methodId, output }: { methodId: string; output: unknown }) {
  if (methodId === "product-persona") {
    return <PersonaSection output={output as ProductPersonaOutput} />;
  }
  if (methodId === "selling-points") {
    return <SellingPointsSection output={output as SellingPointsOutput} />;
  }
  if (methodId === "content-ideas") {
    return <ContentIdeasSection output={output as ContentIdeasOutput} />;
  }
  // marketing-ideas：回退到简单文本展示
  const o = output as { generatedContent?: string; citedEvidenceIds?: string[] };
  return (
    <div className="px-4 py-3 space-y-3">
      <pre className="text-[10px] font-mono text-zinc-700 whitespace-pre-wrap break-all leading-relaxed">
        {o.generatedContent ?? ""}
      </pre>
      {(o.citedEvidenceIds ?? []).length > 0 && (
        <EvidenceFooter ids={o.citedEvidenceIds!} />
      )}
    </div>
  );
}

// ─── 产品画像 ─────────────────────────────────────────────────────────────────

function PersonaSection({ output }: { output: ProductPersonaOutput }) {
  return (
    <div className="px-4 py-3 space-y-4">
      <div>
        <SectionLabel>目标人群</SectionLabel>
        <p className="text-xs text-zinc-700 leading-relaxed mt-1">{output.targetSegment}</p>
      </div>
      <div>
        <SectionLabel>核心痛点</SectionLabel>
        <ul className="mt-1 space-y-1">
          {output.painPoints.map((p, i) => (
            <li key={i} className="text-xs text-zinc-700 flex gap-1.5">
              <span className="text-red-400 shrink-0">•</span>{p}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionLabel>核心需求</SectionLabel>
        <ul className="mt-1 space-y-1">
          {output.coreNeeds.map((n, i) => (
            <li key={i} className="text-xs text-zinc-700 flex gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>{n}
            </li>
          ))}
        </ul>
      </div>
      {output.citedEvidenceIds.length > 0 && <EvidenceFooter ids={output.citedEvidenceIds} />}
      {output.summary && <MarkdownSummary text={output.summary} />}
    </div>
  );
}

// ─── 卖点地图 ─────────────────────────────────────────────────────────────────

function SellingPointsSection({ output }: { output: SellingPointsOutput }) {
  return (
    <div className="px-4 py-3 space-y-4">
      <div>
        <SectionLabel>核心卖点</SectionLabel>
        <div className="mt-1 space-y-2">
          {output.sellingPoints.map((sp, i) => (
            <div key={i} className="border-l-2 border-violet-300 pl-2">
              <div className="flex items-start justify-between gap-1">
                <p className="text-[11px] font-semibold text-zinc-800">{sp.title}</p>
                {sp.evidenceIds.length > 0 && (
                  <span className="text-[9px] text-violet-500 font-mono shrink-0">{sp.evidenceIds.join(" ")}</span>
                )}
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed mt-0.5">{sp.description}</p>
            </div>
          ))}
        </div>
      </div>
      {output.differentiators.length > 0 && (
        <div>
          <SectionLabel>差异化优势</SectionLabel>
          <ul className="mt-1 space-y-1">
            {output.differentiators.map((d, i) => (
              <li key={i} className="text-xs text-zinc-700 flex gap-1.5">
                <span className="text-violet-400 shrink-0">★</span>{d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {output.citedEvidenceIds.length > 0 && <EvidenceFooter ids={output.citedEvidenceIds} />}
      {output.summary && <MarkdownSummary text={output.summary} />}
    </div>
  );
}

// ─── 内容 Idea ────────────────────────────────────────────────────────────────

function ContentIdeasSection({ output }: { output: ContentIdeasOutput }) {
  return (
    <div className="px-4 py-3 space-y-3">
      <SectionLabel>内容创意（{output.ideas.length} 条）</SectionLabel>
      {output.ideas.map((idea, i) => (
        <div key={i} className="bg-white border border-zinc-200 rounded p-2.5 space-y-1">
          <div className="flex items-start justify-between gap-1">
            <p className="text-[11px] font-semibold text-zinc-800">
              <span className="text-zinc-400 font-mono mr-1">{String(i + 1).padStart(2, "0")}</span>
              {idea.title}
            </p>
            <span className="text-[9px] bg-zinc-100 text-zinc-500 rounded px-1 py-0.5 shrink-0 font-mono">{idea.format}</span>
          </div>
          <p className="text-[10px] text-zinc-600 leading-relaxed">{idea.angle}</p>
          {idea.evidenceIds.length > 0 && (
            <p className="text-[9px] text-violet-500 font-mono">{idea.evidenceIds.join(" ")}</p>
          )}
        </div>
      ))}
      {output.citedEvidenceIds.length > 0 && <EvidenceFooter ids={output.citedEvidenceIds} />}
      {output.summary && <MarkdownSummary text={output.summary} />}
    </div>
  );
}

// ─── 共用子组件 ───────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">{children}</p>
  );
}

function EvidenceFooter({ ids }: { ids: string[] }) {
  return (
    <div className="pt-2 border-t border-zinc-100">
      <p className="text-[9px] text-zinc-400">
        📎 引用 evidence：
        <span className="font-mono text-violet-500 ml-1">{ids.join(" ")}</span>
      </p>
    </div>
  );
}

function MarkdownSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-zinc-100 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[9px] text-zinc-400 hover:text-zinc-600 flex items-center gap-1"
      >
        {open ? "▾" : "▸"} {open ? "折叠摘要" : "展开 markdown 摘要"}
      </button>
      {open && (
        <pre className="mt-2 text-[10px] font-mono text-zinc-600 whitespace-pre-wrap break-all leading-relaxed">
          {text}
        </pre>
      )}
    </div>
  );
}
