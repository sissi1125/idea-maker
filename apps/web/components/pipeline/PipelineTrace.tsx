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
/**
 * 4 阶段进度 + 实时计时。
 *
 * 设计取舍（feat-200.7 修正）：
 *   旧实现用固定 phaseDurations 跑 ~6 秒就到 95%——但实际 LLM 调用 10-30s 很常见，
 *   用户看到进度条到顶但结果还没出来，体验断层。
 *
 *   新实现：
 *   - running 时：每个阶段进度永远不到 100%（最高 90%）+ 在 90% 处呼吸
 *     表示"在做但还没完"。第 i 阶段在大约 [i*4s, (i+1)*4s] 区间逐步到 90。
 *     最后一阶段保持在 90% 呼吸直到 finished=true。
 *   - finished：4 阶段全 100%。
 *   - 同时返回 elapsedMs，供 Header 显示"已耗时 X.Xs"。
 */
function useStageProgress(
  running: boolean,
  finished: boolean,
): { progress: number[]; elapsedMs: number } {
  // 每阶段大约用 4s 推进到 90%；最后一阶段超过预期时间保持 90 呼吸（不会到 100）
  const computeProgress = (elapsed: number): number[] => {
    const STAGE_TARGET = 90;           // 单阶段最高百分比（running 阶段不超过 90）
    const STAGE_DURATION = 4000;       // 单阶段名义时长 4s
    const result = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const stageStart = i * STAGE_DURATION;
      const stageEnd = stageStart + STAGE_DURATION;
      if (elapsed >= stageEnd) result[i] = STAGE_TARGET;
      else if (elapsed > stageStart) {
        result[i] = Math.round(((elapsed - stageStart) / STAGE_DURATION) * STAGE_TARGET);
      }
    }
    return result;
  };

  const [progress, setProgress] = useState<number[]>(() =>
    finished ? [100, 100, 100, 100] : [0, 0, 0, 0],
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (finished || !running) return;
    startTimeRef.current = performance.now();
    let raf: number;
    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      setElapsedMs(elapsed);
      setProgress(computeProgress(elapsed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, finished]);

  if (finished) return { progress: [100, 100, 100, 100], elapsedMs };
  if (!running) return { progress: [0, 0, 0, 0], elapsedMs: 0 };
  return { progress, elapsedMs };
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
/**
 * Pipeline 各阶段详情——默认折叠（默认看到的是 stage 列表 + 耗时 chip）。
 * 点开某个 stage 才看 output JSON。
 *
 * 旧实现把所有 stage 的 output 全 pre 渲染出来——展开后页面巨长。
 */
function ThinkingTraceDetail({ trace }: { trace: PipelineTraceType | null }) {
  const [openStage, setOpenStage] = useState<string | null>(null);

  if (!trace) {
    return (
      <div className="px-[18px] py-3.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
        Trace 数据加载中…
      </div>
    );
  }

  return (
    <div className="px-[18px] pb-3.5">
      <div className="text-[11.5px] font-semibold mb-2"
           style={{ color: "var(--think)", letterSpacing: ".06em", textTransform: "uppercase" }}>
        💭 Pipeline trace · {trace.stages.length} 阶段（点击单条展开 output）
      </div>
      {trace.stages.map((stage: StageResult) => {
        const open = openStage === stage.stageId;
        const ok = stage.status === "success";
        return (
          <div key={stage.stageId} className="py-2"
               style={{ borderTop: "1px solid var(--line-2)" }}>
            <button
              type="button"
              onClick={() => setOpenStage(open ? null : stage.stageId)}
              className="w-full text-left flex items-center gap-2"
            >
              {open ? <ChevronUp size={11} style={{ color: "var(--ink-3)" }} />
                    : <ChevronDown size={11} style={{ color: "var(--ink-3)" }} />}
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>
                {stage.stageId}
              </span>
              <span className="text-[11px]" style={{ color: "var(--ink-4)" }}>
                {stage.methodId}
              </span>
              <span className="chip mono text-[10.5px]"
                    style={{
                      background: ok ? "rgba(31,138,91,.08)" : "rgba(179,38,30,.08)",
                      color: ok ? "var(--ok)" : "var(--err)",
                    }}>
                {stage.status} · {stage.durationMs}ms
              </span>
            </button>
            {open && stage.output != null && (
              <pre className="mt-2 text-[12px] leading-relaxed p-2.5 rounded-lg overflow-auto max-h-[260px]"
                   style={{ background: "#FAFAF6", border: "1px solid var(--line-2)",
                            color: "var(--ink-2)" }}>
                {String(typeof stage.output === "string"
                  ? stage.output
                  : JSON.stringify(stage.output, null, 2))}
              </pre>
            )}
            {open && stage.warnings && stage.warnings.length > 0 && (
              <div className="mt-2 text-[11.5px]" style={{ color: "var(--warn)" }}>
                ⚠ {stage.warnings.join(" · ")}
              </div>
            )}
          </div>
        );
      })}

      {/* Cost summary */}
      <div className="pt-3 mt-2 flex gap-3 flex-wrap text-[11.5px] mono"
           style={{ borderTop: "1px solid var(--line-2)", color: "var(--ink-3)" }}>
        <span>⏱ {trace.totalDurationMs}ms</span>
        <span>💰 ${trace.cost.costUsd.toFixed(4)}</span>
        <span>prompt {trace.cost.llmTokensPrompt} / completion {trace.cost.llmTokensCompletion}</span>
      </div>
    </div>
  );
}

// ── RetrievedChunks ───────────────────────────────────────────────────────

/**
 * 检索 chunks 子面板——默认折叠，点击 header 展开。
 * 折叠态只保留"检索到 N 个 chunk"摘要行，不暴露内容；
 * 展开态才渲染前 5 条 chunk 详情。
 */
function RetrievedChunks({ chunks }: { chunks: unknown[] }) {
  const [open, setOpen] = useState(false);
  if (!chunks || chunks.length === 0) return null;

  return (
    <div className="px-[18px] pb-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-[11.5px] font-semibold mb-2"
        style={{ color: "var(--search)", letterSpacing: ".06em", textTransform: "uppercase" }}
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        🔍 检索到 {chunks.length} 个 chunk
        <span className="ml-1 normal-case tracking-normal text-[10.5px] font-normal"
              style={{ color: "var(--ink-4)" }}>
          ({open ? "点击收起" : "点击展开看内容"})
        </span>
      </button>
      {open && (
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
                {(c.content as string) ?? (c.text as string) ?? (c.preview as string)
                  ?? JSON.stringify(c).slice(0, 200)}
              </div>
            </div>
          ))}
          {chunks.length > 5 && (
            <div className="text-[11.5px] text-center" style={{ color: "var(--ink-4)" }}>
              还有 {chunks.length - 5} 个 chunk…
            </div>
          )}
        </div>
      )}
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
  const { progress, elapsedMs } = useStageProgress(running, finished);
  // running 时取第一个未到 90% 的阶段做"当前阶段"
  // finished 时全为 100，currentIdx = -1 → 取最后一个
  const currentIdx = running ? progress.findIndex(p => p < 90) : -1;
  const activeStage = currentIdx === -1 ? STAGE_META[3] : STAGE_META[currentIdx];
  const overall = Math.round(progress.reduce((a, b) => a + b, 0) / 4);

  // 完成后**不**自动展开——让用户先看结果，详情按需点开
  // （上一版自动展开会把页面一下子拉很长，干扰阅读）

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
          <div className="text-[11.5px] mt-0.5 flex items-center gap-2" style={{ color: "var(--ink-3)" }}>
            {running ? (
              <>
                <span>{activeStage.note}</span>
                <span className="mono" style={{ color: activeStage.color }}>
                  · 已耗时 {(elapsedMs / 1000).toFixed(1)}s
                </span>
              </>
            ) : finished && trace ? (
              <>共耗时 {(trace.totalDurationMs / 1000).toFixed(1)}s · {trace.stages.length} 个阶段 · {retrievedChunks.length} 个 chunk</>
            ) : (
              "等待请求"
            )}
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

      {/* 展开后才渲染 chunks + trace；二者各自再有独立的折叠按钮（默认收起） */}
      {expanded && finished && (
        <div style={{ borderTop: "1px solid var(--line-2)" }}>
          <RetrievedChunks chunks={retrievedChunks} />
          <ThinkingTraceDetail trace={trace} />
        </div>
      )}
    </div>
  );
}
