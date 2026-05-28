/**
 * Chat 主界面 — feat-200.6 Week 6
 *
 * 迁移自原型 Chat.jsx。对接真实 API：
 *   - POST /projects/:pid/generate → 同步等待结果
 *   - 返回 pipelineTrace + retrievedChunks + resultNotes
 *
 * 组件结构：
 *   - ProjectInfoCards：自动生成的产品介绍 / 竞品分析卡片
 *   - PresetGrid：快速开始预设问题
 *   - ChatInput：文本输入 + Ctrl+Enter 发送
 *   - PipelineTraceView：4 阶段 Agent 思考可视化
 *   - GeneratedResult：生成结果展示（resultNotes）
 *
 * 状态机：idle → running → done → (可再次提问)
 */

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Send, FileText, Layers, Sparkles,
  ChevronUp, ChevronDown, DollarSign,
} from "lucide-react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { generationsApi, autoGenerationsApi } from "@/lib/api";
import type {
  GenerateResponse, ProjectAutoGenLatest, ProjectAutoGenInFlight, AutoGenCardType,
} from "@/lib/api";
import { PipelineTraceView } from "@/components/pipeline/PipelineTrace";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";
import { AddToLibraryButton } from "@/components/notes/AddToLibraryButton";
import { SaveSegmentsList } from "@/components/notes/SaveSegmentsList";
import { Markdown } from "@/components/markdown/Markdown";

// ── 预设问题 ──────────────────────────────────────────────────────────────

const PRESET_QUESTIONS = [
  { id: "q1", icon: "💡", title: "生成 5 个卖点及小红书笔记" },
  { id: "q2", icon: "📊", title: "对比竞品优势，生成差异化卖点" },
  { id: "q3", icon: "🎨", title: "为产品生成 3 种不同风格的文案" },
  { id: "q4", icon: "📱", title: "生成小红书、微博、抖音三端文案" },
  { id: "q5", icon: "🌟", title: "生成产品使用场景故事和配图 prompt" },
];

// ── ProjectInfoCards ──────────────────────────────────────────────────────

/**
 * 自动生成的项目摘要卡片（产品介绍 + 竞品分析）。
 *
 * 数据来源：GET /projects/:pid/auto-generations/latest，按 cardType 索引：
 *   intro   → 产品介绍卡（ingestion product 类完成后自动生成）
 *   compete → 竞品分析卡
 *
 * 渲染策略：
 *   - 该 kind 存在 succeeded summary → 显示真实 resultNotes（截断显示，超长 fade）
 *   - 不存在 → 保留引导文案（提示用户去知识库上传对应类别资料）
 *
 * 不在这里展示完整 Markdown 排版；最朴素的 white-space:pre-line 即可，
 * Phase 4 再考虑接 react-markdown。
 */
/**
 * 兼容历史 result_notes：有些早期生成把整个 GenerationOutput JSON.stringify 写进了 result_notes
 * （bug 已在 orchestrator.extractResultText 修复，但 DB 里可能还残留）。
 * 如果发现是 JSON 形式且有 generatedContent / summary 字段，提取出来；否则原样返回。
 */
function normalizeSummaryText(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.generatedContent === "string") return parsed.generatedContent;
    if (typeof parsed.summary === "string") return parsed.summary;
  } catch { /* 不是合法 JSON 就原样返回 */ }
  return raw;
}

function ProjectInfoCards({
  summaries,
  inFlight,
  loading,
}: {
  summaries: Partial<Record<AutoGenCardType, ProjectAutoGenLatest>>;
  inFlight: Partial<Record<AutoGenCardType, ProjectAutoGenInFlight>>;
  loading: boolean;
}) {
  const cards: Array<{
    kind: AutoGenCardType;
    title: string;
    accent: boolean;
    emptyBody: string;
    chips: string[];
    Icon: typeof FileText;
  }> = [
    { kind: "intro",   title: "产品介绍", accent: true,
      emptyBody: "上传产品资料后，Agent 会自动提取核心卖点、受众画像、产品参数等关键信息。",
      chips: ["自动生成", "产品资料驱动"],
      Icon: FileText },
    { kind: "compete", title: "竞品分析", accent: false,
      emptyBody: "上传竞品资料后，Agent 会自动对比差异化、定价策略、功能缺口。",
      chips: ["自动生成", "竞品资料驱动"],
      Icon: Layers },
  ];

  return (
    <div className="flex gap-3.5">
      {cards.map(c => {
        const summary = summaries[c.kind];
        const flight = inFlight[c.kind];
        const normalizedNotes = normalizeSummaryText(summary?.resultNotes ?? null);
        const hasContent = !!normalizedNotes;

        // 三种状态：
        //   1. flight.status='running' / 'queued' → 显示"LLM 生成中"横幅，正文有旧摘要就保留
        //   2. flight.status='failed' → 显示红色"上次生成失败"横幅 + error
        //   3. 无 flight → 走旧逻辑（hasContent 显示，否则引导文案）
        const isGenerating = flight?.status === "running" || flight?.status === "queued";
        const isFailed = flight?.status === "failed";

        const body = hasContent ? normalizedNotes! : c.emptyBody;
        const chips = hasContent
          ? [
              `生成于 ${formatRelativeTime(summary!.generatedAt)}`,
              `${summary!.durationMs ?? 0}ms`,
            ]
          : c.chips;

        // header 右上角的状态徽章
        let badge: { text: string; bg: string; color: string; spin?: boolean };
        if (isGenerating) {
          badge = {
            text: flight!.status === "queued" ? "排队中…" : "LLM 生成中…",
            bg: "rgba(79,168,154,.12)",
            color: "var(--brand)",
            spin: true,
          };
        } else if (isFailed) {
          badge = { text: "上次生成失败", bg: "rgba(179,38,30,.08)", color: "var(--err)" };
        } else if (hasContent) {
          badge = {
            text: "Agent 已生成",
            bg: c.accent ? "var(--brand-soft)" : "rgba(224,140,90,.1)",
            color: c.accent ? "var(--brand)" : "var(--tool)",
          };
        } else {
          badge = {
            text: "Agent 自动生成",
            bg: c.accent ? "var(--brand-soft)" : "rgba(224,140,90,.1)",
            color: c.accent ? "var(--brand)" : "var(--tool)",
          };
        }

        return (
          <div key={c.kind} className="card flex-1 min-w-0 p-[16px_18px] flex flex-col gap-2.5"
               style={{
                 borderColor: c.accent ? "rgba(79,168,154,.25)" : "var(--line)",
                 background: c.accent ? "linear-gradient(180deg, rgba(79,168,154,.05), #fff 40%)" : "#fff",
               }}>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-[6px] flex items-center justify-center"
                    style={{
                      background: c.accent ? "var(--brand-soft)" : "rgba(180,83,9,.1)",
                      color: c.accent ? "var(--brand)" : "var(--tool)",
                    }}>
                <c.Icon size={13} strokeWidth={1.8} />
              </span>
              <div className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{c.title}</div>
              <span className="chip text-[10.5px] inline-flex items-center gap-1"
                    style={{ background: badge.bg, color: badge.color }}>
                {badge.spin ? (
                  <span className="inline-block w-[10px] h-[10px] rounded-full flex-none"
                        style={{
                          border: "1.5px solid rgba(79,168,154,.3)",
                          borderTopColor: "var(--brand)",
                          animation: "spin .9s linear infinite",
                        }} />
                ) : (
                  <Sparkles size={10} strokeWidth={2} />
                )}
                {badge.text}
              </span>
            </div>

            {/* 进行中提示行——独立于正文，让用户即便有旧摘要也清楚知道正在重生成 */}
            {isGenerating && (
              <div className="text-[12px] leading-[1.5] flex items-center gap-2 rounded-md px-2 py-1.5"
                   style={{ background: "rgba(79,168,154,.06)", color: "var(--brand)" }}>
                <span className="inline-block w-2 h-2 rounded-full"
                      style={{
                        background: "var(--brand)",
                        animation: "dot 1.4s infinite",
                      }} />
                {hasContent
                  ? "Agent 正在基于新文档重新生成摘要…（旧版本仍在下方显示）"
                  : "Agent 正在分析知识库内容生成摘要，预计 10–30 秒…"}
              </div>
            )}

            {/* 失败提示行 */}
            {isFailed && flight?.error && (
              <div className="text-[12px] leading-[1.5] rounded-md px-2 py-1.5"
                   style={{ background: "rgba(179,38,30,.06)", color: "var(--err)" }}>
                ⚠ {flight.error}
              </div>
            )}

            {/* 正文：超长内容内部滚动，不撑高卡片；引导文案不需要滚动 */}
            <div className="text-[13px] leading-[1.65] whitespace-pre-line pr-1"
                 style={{
                   color: hasContent ? "var(--ink)" : "var(--ink-2)",
                   maxHeight: hasContent ? "14em" : undefined,
                   overflowY: hasContent ? "auto" : "visible",
                   // 细滚动条 + 留点右边距防止贴到卡片边缘
                   scrollbarWidth: "thin",
                   scrollbarColor: "rgba(11,17,32,.18) transparent",
                 }}>
              {loading ? "加载中…" : body}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chips.map(ch => (
                <span key={ch} className="chip" style={{ background: "rgba(11,17,32,.04)" }}>{ch}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 简化的相对时间：分钟/小时/天，足够 MVP 用；避免引入 dayjs */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const d = Math.floor(hr / 24);
  return `${d} 天前`;
}

// ── PresetGrid ────────────────────────────────────────────────────────────

function PresetGrid({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
      {PRESET_QUESTIONS.map(q => (
        <button key={q.id}
          onClick={() => onPick(q.title)}
          className="flex-none inline-flex gap-[7px] items-center whitespace-nowrap
                     rounded-full cursor-pointer text-[12.5px] font-medium
                     hover:border-[var(--brand)] hover:text-[var(--brand)] hover:bg-[var(--brand-soft)]"
          style={{
            padding: "7px 12px",
            border: "1px solid var(--line)",
            background: "#fff",
            color: "var(--ink-2)",
            transition: ".15s",
          }}>
          <span className="text-[14px] leading-none">{q.icon}</span>
          <span>{q.title}</span>
        </button>
      ))}
    </div>
  );
}

// ── ChatInput ─────────────────────────────────────────────────────────────

function ChatInput({
  value,
  setValue,
  onSend,
  disabled,
}: {
  value: string;
  setValue: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="card" style={{ padding: "12px 12px 10px", boxShadow: "var(--shadow-md)", borderColor: "var(--line-strong)" }}>
      <textarea
        placeholder="你的需求或进一步优化…（如：把语气改得更俏皮一点、强化「续航」卖点）"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onSend();
        }}
        rows={3}
        className="w-full border-none outline-none resize-none bg-transparent text-[14px] leading-[1.55] px-1.5 py-1"
        style={{ color: "var(--ink)", fontFamily: "inherit" }}
      />
      <div className="flex items-center gap-1.5 pt-2" style={{ borderTop: "1px solid var(--line-2)" }}>
        <span className="flex-1" />
        <span className="text-[11.5px] mr-1.5" style={{ color: "var(--ink-4)" }}>
          按 <span className="kbd">Ctrl</span> <span className="kbd">↵</span> 发送
        </span>
        <button className="btn btn-sm btn-primary"
                onClick={onSend}
                disabled={disabled || !value.trim()}
                style={{ opacity: disabled || !value.trim() ? 0.5 : 1 }}>
          发送 <Send size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ── GeneratedResult ───────────────────────────────────────────────────────

function GeneratedResult({ result }: { result: GenerateResponse }) {
  // 兼容历史 result_notes 是 JSON 形式（normalizeSummaryText 也在用同一个清洗逻辑）
  const cleanedNotes = normalizeSummaryText(result.resultNotes ?? null);
  const cost = result.costBreakdown;
  return (
    <div className="card fade-in p-[18px_20px]" style={{ boxShadow: "var(--shadow-md)" }}>
      <div className="flex items-start gap-[11px] mb-3.5">
        <span className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center flex-none"
              style={{ background: "linear-gradient(135deg, #E5C56F, #C9A23E)", boxShadow: "0 4px 10px rgba(201,162,62,.25)" }}>
          <Sparkles size={14} strokeWidth={2} style={{ color: "#fff" }} />
        </span>
        <div className="flex-1">
          <div className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>生成结果</div>
          <div className="text-[12px] mt-0.5" style={{ color: "var(--ink-3)" }}>
            {result.status === "succeeded" ? "生成完成" : "生成失败"}
            {result.durationMs && ` · ${(result.durationMs / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>

      {/* Result notes（markdown 渲染——不再显示 ** - 等原始符号） */}
      {cleanedNotes && (
        <div className="rounded-[9px] p-[12px_16px] mb-3.5"
             style={{ background: "linear-gradient(180deg, #FEFAEF, #fff)",
                      border: "1px solid var(--line-2)" }}>
          <Markdown content={cleanedNotes} />
        </div>
      )}

      {/* Error */}
      {result.error && (
        <div className="rounded-lg p-3 mb-3.5 text-[13px]"
             style={{ background: "rgba(179,38,30,.06)", border: "1px solid rgba(179,38,30,.18)", color: "var(--err)" }}>
          {result.error}
        </div>
      )}

      {/* 成本分解行：USD + token + 各类调用次数；6 个 chip 排成一行 */}
      {cost && (
        <div className="flex gap-2 items-center flex-wrap text-[11px] mono pt-3"
             style={{ borderTop: "1px solid var(--line-2)", color: "var(--ink-3)" }}>
          <span className="chip inline-flex items-center gap-1"
                style={{ background: "rgba(214,180,80,.12)", color: "var(--gen)" }}>
            <DollarSign size={10} strokeWidth={2} />
            ${cost.costUsd.toFixed(4)}
          </span>
          <span className="chip" style={{ background: "rgba(11,17,32,.04)" }}>
            prompt {cost.llmTokensPrompt.toLocaleString()}
          </span>
          <span className="chip" style={{ background: "rgba(11,17,32,.04)" }}>
            completion {cost.llmTokensCompletion.toLocaleString()}
          </span>
          {cost.embeddingCalls > 0 && (
            <span className="chip" style={{ background: "rgba(11,17,32,.04)" }}>
              embed×{cost.embeddingCalls}
            </span>
          )}
          {cost.retrievalCalls > 0 && (
            <span className="chip" style={{ background: "rgba(11,17,32,.04)" }}>
              retrieval×{cost.retrievalCalls}
            </span>
          )}
          {cost.rerankerCalls > 0 && (
            <span className="chip" style={{ background: "rgba(11,17,32,.04)" }}>
              rerank×{cost.rerankerCalls}
            </span>
          )}
        </div>
      )}

      {/* 保存到笔记库——整段保存 + 拆段保存（每段一个按钮） */}
      {result.status === "succeeded" && result.generationId && cleanedNotes && (
        <div className="mt-3" style={{
          borderTop: "1px solid var(--line-2)",
          paddingTop: "12px",
        }}>
          <div className="flex justify-end">
            <AddToLibraryButton
              generationId={result.generationId}
              content={cleanedNotes}
              titleSeed={result.query}
            />
          </div>
          <SaveSegmentsList
            generationId={result.generationId}
            content={cleanedNotes}
          />
        </div>
      )}

      {/* 反馈面板（仅 succeeded 时显示——失败的没必要让用户评分） */}
      {result.status === "succeeded" && result.generationId && cleanedNotes && (
        <FeedbackPanel
          generationId={result.generationId}
          originalContent={cleanedNotes}
        />
      )}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────

type Phase = "idle" | "running" | "done";

export default function ProjectChatPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { setCurrentProject, currentProject: getCurrent } = useProjectsStore();
  const user = useAuthStore((s) => s.user);
  const project = getCurrent();

  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState("");
  const [showPresets, setShowPresets] = useState(true);
  const [lastPrompt, setLastPrompt] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  // ── 项目级自动摘要（产品介绍 / 竞品对比） ──────────────────────────────
  //
  // 进入页面拉一次；同时通过 reloadTick 计数器允许其他事件（如 generate 完）触发重拉。
  // 失败静默——卡片自然降级到引导文案。
  // 用 cancelled 标记 + cleanup 避免 strict-mode 双调用 / 切项目时写过期数据。
  const [summaries, setSummaries] = useState<Partial<Record<AutoGenCardType, ProjectAutoGenLatest>>>({});
  const [inFlight, setInFlight] = useState<Partial<Record<AutoGenCardType, ProjectAutoGenInFlight>>>({});
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [summariesReloadTick, setSummariesReloadTick] = useState(0);

  /**
   * 拉一次 + 如果发现有 running/queued auto-gen，启动 3s 轮询直到全部结束。
   * tick 改变会重新走整套流程，所以 generate 完后 setSummariesReloadTick 即可强制刷新。
   */
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const { items, inFlight: flights } =
          await autoGenerationsApi.getLatestProjectAutoGen(projectId);
        if (cancelled) return { hasRunning: false };
        const nextSummaries: Partial<Record<AutoGenCardType, ProjectAutoGenLatest>> = {};
        for (const it of items) nextSummaries[it.cardType] = it;
        const nextFlight: Partial<Record<AutoGenCardType, ProjectAutoGenInFlight>> = {};
        for (const f of flights) nextFlight[f.cardType] = f;
        setSummaries(nextSummaries);
        setInFlight(nextFlight);
        const hasRunning = flights.some(
          (f) => f.status === "running" || f.status === "queued",
        );
        return { hasRunning };
      } catch {
        return { hasRunning: false };
      } finally {
        if (!cancelled) setSummariesLoading(false);
      }
    };

    const loop = async () => {
      const { hasRunning } = await fetchOnce();
      if (cancelled) return;
      if (hasRunning) {
        // 还有进行中的，3 秒后再拉一次（auto-gen 一般 10-30s 完成）
        pollTimer = setTimeout(loop, 3000);
      }
    };
    loop();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [projectId, summariesReloadTick]);

  const startGenerate = async (text: string) => {
    if (!text.trim() || !projectId) return;
    setLastPrompt(text.trim());
    setPhase("running");
    setShowPresets(false);
    setResult(null);
    setError(null);

    try {
      const res = await generationsApi.generate(projectId, text.trim());
      setResult(res);
      setPhase("done");
      // 生成完后用户可能刚在隔壁知识库上传了新文档，重拉摘要，
      // 让 auto-gen 的新结果可被看到
      setSummariesReloadTick(t => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      setPhase("done");
    }
  };

  const onSend = () => {
    if (!input.trim()) return;
    startGenerate(input.trim());
    setInput("");
  };

  // 用户首字母 avatar
  const userInitials = (user?.displayName ?? user?.email ?? "U").slice(0, 2).toUpperCase();

  return (
    <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
      <div className="max-w-[980px] mx-auto px-7 py-6 pb-24">
        {/* Project header */}
        <div className="mb-1.5">
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
            {project?.name ?? "项目"}
          </h1>
          <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
            {project?.description ?? ""}
          </p>
        </div>

        {/* Auto-generated info cards（项目级最新成功摘要 + 进行中状态） */}
        <ProjectInfoCards summaries={summaries} inFlight={inFlight} loading={summariesLoading} />

        {/* Conversation thread */}
        {lastPrompt && (
          <div className="mt-6 flex gap-3 items-start">
            {/* User avatar */}
            <div className="w-[30px] h-[30px] rounded-full flex-none flex items-center justify-center text-[11.5px] font-semibold"
                 style={{ background: "linear-gradient(135deg, #F0BC8B, #DA8A4A)", color: "#fff" }}>
              {userInitials}
            </div>
            <div className="flex-1 pt-1">
              <div className="text-[11.5px] mb-1" style={{ color: "var(--ink-3)" }}>
                {user?.displayName ?? user?.email ?? "你"} · 刚刚
              </div>
              <div className="card inline-block max-w-full text-[13.5px] leading-[1.55]"
                   style={{ padding: "10px 14px", background: "var(--brand-soft)", borderColor: "rgba(79,168,154,.22)", color: "var(--ink)" }}>
                {lastPrompt}
              </div>
            </div>
          </div>
        )}

        {/* Agent response */}
        {(phase === "running" || phase === "done") && (
          <div className="mt-3.5 flex gap-3 items-start">
            {/* Agent avatar */}
            <div className="w-[30px] h-[30px] rounded-full flex-none flex items-center justify-center text-[14px] font-bold"
                 style={{
                   background: "linear-gradient(135deg, #6BBFAF 0%, #3D8C7F 100%)",
                   color: "#fff",
                   boxShadow: "0 4px 10px rgba(79,168,154,.32)",
                 }}>
              H
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-3.5">
              <div className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                Harness Agent · {phase === "running" ? "思考中…" : "回复"}
              </div>

              <PipelineTraceView
                running={phase === "running"}
                finished={phase === "done"}
                trace={result?.pipelineTrace ?? null}
                retrievedChunks={result?.retrievedChunks ?? []}
              />

              {phase === "done" && result && (
                <GeneratedResult result={result} />
              )}

              {phase === "done" && error && !result && (
                <div className="card p-4 text-[13px]"
                     style={{ background: "rgba(179,38,30,.06)", border: "1px solid rgba(179,38,30,.18)", color: "var(--err)" }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sticky bottom composer */}
      <div className="sticky bottom-0"
           style={{ background: "linear-gradient(180deg, rgba(247,246,242,0), var(--bg) 35%)", padding: "24px 28px 18px", marginTop: -24 }}>
        <div className="max-w-[980px] mx-auto">
          {/* Presets toggle */}
          <div className="flex items-center justify-between mx-0.5 mb-2.5">
            <div className="text-[11.5px] font-semibold tracking-wider uppercase flex items-center gap-2"
                 style={{ color: "var(--ink-3)" }}>
              📋 快速开始 — 预设问题
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowPresets(s => !s)}>
              {showPresets ? <><ChevronDown size={12} strokeWidth={2} /> 收起</> : <><ChevronUp size={12} strokeWidth={2} /> 展开</>}
            </button>
          </div>
          {showPresets && (
            <div className="mb-3">
              <PresetGrid onPick={(text) => startGenerate(text)} />
            </div>
          )}
          <ChatInput value={input} setValue={setInput} onSend={onSend} disabled={phase === "running"} />
        </div>
      </div>
    </main>
  );
}
