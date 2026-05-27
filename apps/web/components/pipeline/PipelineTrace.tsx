/**
 * PipelineTrace — feat-200.6 Week 6
 *
 * 迁移自原型 AgentThinking.jsx。
 * 4 阶段进度可视化（思考 → 检索 → 工具 → 生成）：
 *   - running=true 时：伪动画（每阶段按时间依次推进）
 *   - finished=true 时：所有进度 100%，展示详情面板
 *   - 简/详细视图切换（展开查看 trace + retrieved chunks + tool calls + self-eval）
 *
 * 设计：
 *   - useStageProgress hook：running 时用 rAF 驱动 4 阶段顺序进度条
 *   - PhaseRow：单行进度（icon + label + bar + percentage）
 *   - ThinkingTraceDetail：从 PipelineTrace.stages 读取真实数据（finished 后展示）
 *   - 对接后端 PipelineTrace 类型（stages 数组、cost breakdown）
 */

"use client";

import { useState, useEffect, useRef } from "react";
import {
  Check, ChevronUp, ChevronDown, Brain, Search, Wrench, Sparkles,
  FileText,
} from "lucide-react";
import type { PipelineTrace as PipelineTraceType, StageResult } from "@/lib/api";

// ── 常量 ──────────────────────────────────────────────────────────────────

const STAGE_META = [
  { id: "think",  label: "思考", color: "var(--think)",  bg: "var(--think-bg)",  emoji: "💭", note: "分析需求 · 拆解步骤", Icon: Brain },
  { id: "search", label: "检索", color: "var(--search)", bg: "var(--search-bg)", emoji: "🔍", note: "知识库语义检索",      Icon: Search },
  { id: "tool",   label: "工具", color: "var(--tool)",   bg: "var(--tool-bg)",   emoji: "🛠",  note: "调用生成 / 评分工具", Icon: Wrench },
  { id: "gen",    label: "生成", color: "var(--gen)",     bg: "var(--gen-bg)",    emoji: "✨",  note: "写稿 · 自我评估",    Icon: Sparkles },
];

// ── useStageProgress hook ─────────────────────────────────────────────────

/**
 * 4 阶段伪动画 hook。
 * running 时 rAF 驱动各阶段顺序推进；finished 时直接 [100,100,100,100]。
 *
 * 实现：
 *   - useSyncExternalStore 模式：用 ref 存数据 + subscribe rAF 回调
 *   - 避免在 useEffect body 直接 setState（lint react-hooks/set-state-in-effect）
 *   - 避免在 render 中读 ref.current（lint react-hooks/refs）
 */
function useStageProgress(running: boolean, finished: boolean): number[] {
  const computeProgress = (elapsed: number): number[] => {
    const phaseDurations = [1400, 1600, 1400, 1800];
    const result = [0, 0, 0, 0];
    let consumed = 0;
    for (let i = 0; i < 4; i++) {
      const d = phaseDurations[i];
      if (elapsed >= consumed + d) result[i] = 100;
      else if (elapsed > consumed) result[i] = Math.round(((elapsed - consumed) / d) * 100);
      consumed += d;
    }
    return result;
  };

  // 动画进度用 state 管理，仅在 rAF callback（非 effect body）中 setState
  const [progress, setProgress] = useState(() =>
    finished ? [100, 100, 100, 100] : [0, 0, 0, 0],
  );
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (finished || !running) return;

    startTimeRef.current = performance.now();
    let raf: number;

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      const next = computeProgress(elapsed);
      setProgress(next);
      if (next[3] < 100) raf = requestAnimationFrame(tick);
    };

    // 首帧在下一个 rAF 中启动（不在 effect body 直接 setState）
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, finished]);

  if (finished) return [100, 100, 100, 100];
  if (!running) return [0, 0, 0, 0];
  return progress;
}

// ── ProgressBar ───────────────────────────────────────────────────────────

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="relative h-[6px] flex-1 rounded-full overflow-hidden"
         style={{ background: "rgba(11,17,32,.06)" }}>
      <div className="absolute inset-0 rounded-full"
           style={{
             width: `${value}%`,
             background: color,
             transition: "width .35s cubic-bezier(.2,.7,.2,1)",
           }}
      />
      {value > 0 && value < 100 && (
        <div className="absolute top-0 bottom-0 w-[36%]"
             style={{
               background: "linear-gradient(90deg, transparent, rgba(255,255,255,.6), transparent)",
               animation: "shimmer 1.4s linear infinite",
               mixBlendMode: "overlay",
             }}
        />
      )}
    </div>
  );
}

// ── PhaseRow ──────────────────────────────────────────────────────────────

function PhaseRow({ stage, value }: { stage: typeof STAGE_META[0]; value: number }) {
  const active = value > 0 && value < 100;
  const done = value === 100;
  const StageIcon = stage.Icon;

  return (
    <div className="flex items-center gap-3 py-[3px]">
      <div className="flex items-center gap-2 w-[110px] flex-none"
           style={{ color: done || active ? "var(--ink)" : "var(--ink-3)" }}>
        <div className="w-[22px] h-[22px] rounded-[6px] flex items-center justify-center"
             style={{ background: done ? stage.bg : active ? stage.bg : "rgba(11,17,32,.04)" }}>
          <StageIcon size={13} strokeWidth={1.8} style={{ color: done || active ? stage.color : "var(--ink-4)" }} />
        </div>
        <span className="text-[13px] font-semibold">{stage.label}</span>
      </div>
      <ProgressBar value={value} color={stage.color} />
      <div className="w-14 text-right mono text-[11.5px] font-semibold"
           style={{
             color: done ? stage.color : "var(--ink-3)",
             fontVariantNumeric: "tabular-nums",
           }}>
        {done ? (
          <span className="inline-flex items-center gap-1">
            <Check size={11} strokeWidth={2.4} /> 完成
          </span>
        ) : active ? `${value}%` : "0%"}
      </div>
    </div>
  );
}

// ── DotPulse ──────────────────────────────────────────────────────────────

function DotPulse() {
  return (
    <span className="inline-flex gap-[3px] items-center">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-1 h-1 rounded-full bg-current"
              style={{ animation: `dot 1.2s ease-in-out ${i * 0.15}s infinite` }} />
      ))}
    </span>
  );
}

// ── ThinkingTraceDetail ───────────────────────────────────────────────────

/**
 * 从真实 PipelineTrace stages 渲染详情。
 * 如果 trace 为 null（伪动画阶段），显示占位。
 */
function ThinkingTraceDetail({ trace }: { trace: PipelineTraceType | null }) {
  if (!trace) {
    return (
      <div className="px-[18px] py-3.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        Trace 数据加载中…
      </div>
    );
  }

  return (
    <div className="px-[18px] pb-3.5">
      {trace.stages.map((stage: StageResult) => (
        <div key={stage.stageId} className="py-3.5" style={{ borderTop: "1px solid var(--line-2)" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>
              {stage.stageId}
            </span>
            <span className="chip mono text-[10.5px]"
                  style={{
                    background: stage.status === "success" ? "rgba(31,138,91,.08)" : "rgba(179,38,30,.08)",
                    color: stage.status === "success" ? "var(--ok)" : "var(--err)",
                  }}>
              {stage.status} · {stage.durationMs}ms
            </span>
          </div>
          {stage.output != null && (
            <pre className="text-[12px] leading-relaxed p-2.5 rounded-lg overflow-auto max-h-[200px]"
                 style={{ background: "#FAFAF6", border: "1px solid var(--line-2)", color: "var(--ink-2)" }}>
              {String(typeof stage.output === "string"
                ? stage.output
                : JSON.stringify(stage.output, null, 2))}
            </pre>
          )}
          {stage.warnings && stage.warnings.length > 0 && (
            <div className="mt-2 text-[11.5px]" style={{ color: "var(--warn)" }}>
              ⚠ {stage.warnings.join(" · ")}
            </div>
          )}
        </div>
      ))}

      {/* Cost summary */}
      <div className="pt-3 flex gap-3 flex-wrap text-[11.5px] mono"
           style={{ borderTop: "1px solid var(--line-2)", color: "var(--ink-3)" }}>
        <span>⏱ {trace.totalDurationMs}ms</span>
        <span>💰 ${trace.cost.totalCostUsd.toFixed(4)}</span>
        <span>in {trace.cost.totalTokensIn} / out {trace.cost.totalTokensOut}</span>
      </div>
    </div>
  );
}

// ── RetrievedChunks ───────────────────────────────────────────────────────

function RetrievedChunks({ chunks }: { chunks: unknown[] }) {
  if (!chunks || chunks.length === 0) return null;

  return (
    <div className="px-[18px] pb-3.5">
      <div className="text-[11.5px] font-semibold mb-2" style={{ color: "var(--search)", letterSpacing: ".06em", textTransform: "uppercase" }}>
        🔍 检索到 {chunks.length} 个 chunk
      </div>
      <div className="flex flex-col gap-1.5">
        {(chunks as Array<Record<string, unknown>>).slice(0, 5).map((c, i) => (
          <div key={i} className="p-2.5 rounded-lg text-[12.5px] leading-relaxed"
               style={{ background: "#FAFAF6", border: "1px solid var(--line-2)", color: "var(--ink-2)" }}>
            <div className="flex items-center gap-2 mb-1">
              <FileText size={12} strokeWidth={1.6} style={{ color: "var(--ink-3)" }} />
              <span className="font-semibold text-[12px]" style={{ color: "var(--ink)" }}>
                {(c.fileName as string) ?? (c.file as string) ?? `Chunk ${i + 1}`}
              </span>
              {typeof c.score === "number" && (
                <span className="mono text-[11px]" style={{ color: "var(--search)" }}>
                  {Math.round((c.score as number) * 100)}%
                </span>
              )}
            </div>
            <div className="line-clamp-2">
              {(c.content as string) ?? (c.preview as string) ?? JSON.stringify(c).slice(0, 200)}
            </div>
          </div>
        ))}
        {chunks.length > 5 && (
          <div className="text-[11.5px] text-center" style={{ color: "var(--ink-4)" }}>
            还有 {chunks.length - 5} 个 chunk…
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────

interface PipelineTraceProps {
  /** true: 正在执行（伪动画） */
  running: boolean;
  /** true: 执行完成 */
  finished: boolean;
  /** 后端返回的 pipeline trace（finished 后有值） */
  trace?: PipelineTraceType | null;
  /** 检索到的 chunks */
  retrievedChunks?: unknown[];
}

export function PipelineTraceView({
  running,
  finished,
  trace = null,
  retrievedChunks = [],
}: PipelineTraceProps) {
  const [expanded, setExpanded] = useState(false);
  const progress = useStageProgress(running, finished);
  const currentIdx = progress.findIndex(p => p < 100);
  const activeStage = currentIdx === -1 ? STAGE_META[3] : STAGE_META[currentIdx];
  const overall = Math.round(progress.reduce((a, b) => a + b, 0) / 4);

  // 完成后自动展开详情
  const prevFinished = useRef(finished);
  useEffect(() => {
    if (finished && !prevFinished.current) setExpanded(true);
    prevFinished.current = finished;
  }, [finished]);

  return (
    <div className="card fade-in overflow-hidden"
         style={{
           borderColor: running ? "rgba(79,168,154,.4)" : "var(--line)",
           boxShadow: running
             ? "0 0 0 4px rgba(79,168,154,.08), var(--shadow-md)"
             : "var(--shadow-sm)",
           transition: "box-shadow .3s, border-color .3s",
         }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3"
           style={{ borderBottom: "1px solid var(--line-2)" }}>
        {/* Circular progress */}
        <div className="relative w-7 h-7 flex-none">
          <div className="absolute inset-0 rounded-full"
               style={{ background: `conic-gradient(${activeStage.color} ${overall * 3.6}deg, rgba(11,17,32,.07) 0)` }} />
          <div className="absolute inset-[3px] rounded-full bg-white flex items-center justify-center
                          text-[11px] font-bold mono" style={{ color: "var(--ink)" }}>
            {overall}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold flex items-center gap-2" style={{ color: "var(--ink)" }}>
            {running ? (
              <>Agent 正在 {activeStage.label}<span style={{ color: activeStage.color }}><DotPulse /></span></>
            ) : finished ? (
              <><Check size={14} strokeWidth={2.2} style={{ color: "var(--ok)" }} /> 思考完成 · 4 / 4 阶段</>
            ) : "Agent 待命"}
          </div>
          <div className="text-[11.5px] mt-0.5" style={{ color: "var(--ink-3)" }}>
            {running
              ? activeStage.note
              : finished && trace
                ? `共耗时 ${(trace.totalDurationMs / 1000).toFixed(1)}s · ${trace.stages.length} 个阶段 · ${retrievedChunks.length} 个 chunk`
                : "等待请求"}
          </div>
        </div>

        <button className="btn btn-sm btn-ghost"
                onClick={() => setExpanded(!expanded)}
                disabled={!finished && !running}
                style={{ opacity: running || finished ? 1 : 0.4 }}>
          {expanded
            ? <><ChevronUp size={12} strokeWidth={2} /> 收起</>
            : <><ChevronDown size={12} strokeWidth={2} /> 详情</>}
        </button>
      </div>

      {/* Phase bars */}
      <div className="px-[18px] py-3 flex flex-col gap-0.5">
        {STAGE_META.map((s, i) => (
          <PhaseRow key={s.id} stage={s} value={progress[i]} />
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && finished && (
        <>
          <RetrievedChunks chunks={retrievedChunks} />
          <ThinkingTraceDetail trace={trace} />
        </>
      )}
    </div>
  );
}
