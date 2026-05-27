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
import { generationsApi } from "@/lib/api";
import type { GenerateResponse } from "@/lib/api";
import { PipelineTraceView } from "@/components/pipeline/PipelineTrace";

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
 * MVP 阶段用占位内容提示用户先上传文档。
 */
function ProjectInfoCards() {
  const cards = [
    { kind: "intro",   title: "产品介绍", accent: true,
      body: "上传产品资料后，Agent 会自动提取核心卖点、受众画像、产品参数等关键信息。",
      chips: ["自动生成", "产品资料驱动"],
      Icon: FileText },
    { kind: "compete", title: "竞品分析", accent: false,
      body: "上传竞品资料后，Agent 会自动对比差异化、定价策略、功能缺口。",
      chips: ["自动生成", "竞品资料驱动"],
      Icon: Layers },
  ];

  return (
    <div className="flex gap-3.5">
      {cards.map(c => (
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
            <span className="chip text-[10.5px]"
                  style={{
                    background: c.accent ? "var(--brand-soft)" : "rgba(224,140,90,.1)",
                    color: c.accent ? "var(--brand)" : "var(--tool)",
                  }}>
              <Sparkles size={10} strokeWidth={2} /> Agent 自动生成
            </span>
          </div>
          <div className="text-[13px] leading-[1.65]" style={{ color: "var(--ink-2)" }}>
            {c.body}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {c.chips.map(ch => (
              <span key={ch} className="chip" style={{ background: "rgba(11,17,32,.04)" }}>{ch}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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

      {/* Result notes */}
      {result.resultNotes && (
        <div className="rounded-[9px] p-[12px_14px] mb-3.5 text-[13.5px] leading-[1.75] whitespace-pre-wrap"
             style={{ background: "linear-gradient(180deg, #FEFAEF, #fff)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
          {result.resultNotes}
        </div>
      )}

      {/* Error */}
      {result.error && (
        <div className="rounded-lg p-3 mb-3.5 text-[13px]"
             style={{ background: "rgba(179,38,30,.06)", border: "1px solid rgba(179,38,30,.18)", color: "var(--err)" }}>
          {result.error}
        </div>
      )}

      {/* Cost footer */}
      {result.costBreakdown && (
        <div className="flex gap-3 items-center flex-wrap text-[11.5px] mono pt-3"
             style={{ borderTop: "1px solid var(--line-2)", color: "var(--ink-3)" }}>
          <DollarSign size={11} strokeWidth={2} />
          <span>${result.costBreakdown.totalCostUsd.toFixed(4)}</span>
          <span>in {result.costBreakdown.totalTokensIn} / out {result.costBreakdown.totalTokensOut}</span>
        </div>
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

        {/* Auto-generated info cards */}
        <ProjectInfoCards />

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
