/**
 * AgentStepCard — feat-300.6 任务 4
 *
 * 一条 agent_steps 的多态渲染。按 stepType 分 5 类视觉：
 *   - reasoning        💭 LLM 自然语言思考，markdown 渲染，默认展开
 *   - tool_call        🔧 工具调用入参，JSON pretty，默认折叠
 *   - tool_result      📦 工具返回，JSON pretty + 长文本 max-h，默认折叠
 *   - context_compress 🧠 历史摘要压缩，展示摘要文本
 *   - finish           🏁 LLM 自主收尾
 *
 * 设计要点（plan §3.5）：
 *   - 默认折叠 tool_result：长度大但日常少看
 *   - 默认展开 reasoning：transparency 核心卖点
 *   - 长文本用 max-h + overflow-auto 隔离，避免撑破布局
 *   - whitespace-pre-wrap + break-words：长中文 / 长 URL 兼容
 *   - 父组件可通过 forceExpanded prop 强制覆盖（"全部展开 / 全部折叠"开关）
 */

"use client";

import { useState } from "react";
import {
  Brain, Wrench, Package, Layers, CheckCircle2, ChevronDown, ChevronRight, Clock,
} from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import type { UnifiedStep } from "@/lib/hooks/useAgentRun";

interface AgentStepCardProps {
  step: UnifiedStep;
  /** 父组件强制展开/折叠覆盖（undefined = 用自身默认） */
  forceExpanded?: boolean;
}

const TYPE_META: Record<
  UnifiedStep["stepType"],
  { icon: typeof Brain; label: string; color: string; defaultOpen: boolean }
> = {
  reasoning: {
    icon: Brain,
    label: "思考",
    color: "text-purple-600 bg-purple-50 border-purple-200",
    defaultOpen: true,
  },
  tool_call: {
    icon: Wrench,
    label: "调用工具",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    defaultOpen: false,
  },
  tool_result: {
    icon: Package,
    label: "工具返回",
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    defaultOpen: false,
  },
  context_compress: {
    icon: Layers,
    label: "上下文压缩",
    color: "text-amber-600 bg-amber-50 border-amber-200",
    defaultOpen: false,
  },
  finish: {
    icon: CheckCircle2,
    label: "完成",
    color: "text-green-700 bg-green-50 border-green-200",
    defaultOpen: true,
  },
};

export function AgentStepCard({ step, forceExpanded }: AgentStepCardProps) {
  const meta = TYPE_META[step.stepType];
  // 自身控制的开关；父组件 forceExpanded 优先（受控/非受控混合）
  // 不用 useEffect 同步 forceExpanded：直接派生 open，避免 setState-in-effect 反模式
  const [selfOpen, setSelfOpen] = useState(meta.defaultOpen);
  const open = forceExpanded !== undefined ? forceExpanded : selfOpen;
  const setOpen = (v: boolean | ((p: boolean) => boolean)) => {
    // forceExpanded 接管时点击仍切换 selfOpen，下次父组件释放 force 时反映用户最近选择
    setSelfOpen((prev) => (typeof v === "function" ? v(prev) : v));
  };

  const Icon = meta.icon;
  const title = step.toolName
    ? `${meta.label} · ${step.toolName}`
    : meta.label;

  return (
    <div className={`border rounded-lg ${meta.color.split(" ").slice(-1).join(" ")} bg-white`}>
      {/* 头部：图标 + 标题 + step index + 耗时 + 折叠箭头 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition rounded-t-lg"
      >
        <span className={`flex items-center justify-center w-7 h-7 rounded-full ${meta.color}`}>
          <Icon size={16} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">{title}</span>
          <span className="ml-2 text-xs text-gray-400">#{step.stepIndex}</span>
        </span>
        {step.durationMs != null && (
          <span className="text-xs text-gray-400 inline-flex items-center gap-1">
            <Clock size={12} />
            {formatDuration(step.durationMs)}
          </span>
        )}
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>

      {/* 内容区：按 stepType 多态 */}
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100">
          <StepContent step={step} />
        </div>
      )}
    </div>
  );
}

function StepContent({ step }: { step: UnifiedStep }) {
  switch (step.stepType) {
    case "reasoning": {
      const text = extractText(step.output);
      return text ? (
        <div className="prose prose-sm max-w-none text-gray-800">
          <Markdown content={text} />
        </div>
      ) : (
        <EmptyState>无思考文本</EmptyState>
      );
    }
    case "tool_call": {
      return (
        <div>
          <SubLabel>入参</SubLabel>
          <JsonBlock value={step.input} />
        </div>
      );
    }
    case "tool_result": {
      return (
        <div>
          <SubLabel>返回</SubLabel>
          <JsonBlock value={step.output} maxHeight="max-h-[400px]" />
        </div>
      );
    }
    case "context_compress": {
      const summary = extractField(step.output, "summary");
      const cnt = extractField(step.input, "compressedTurnCount");
      return (
        <div className="space-y-2">
          {cnt != null && (
            <div className="text-xs text-gray-500">
              压缩 {String(cnt)} 轮对话为摘要
            </div>
          )}
          {!!summary && (
            <div className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded p-2 whitespace-pre-wrap break-words">
              {String(summary)}
            </div>
          )}
        </div>
      );
    }
    case "finish": {
      const text = extractText(step.output);
      return text ? (
        <div className="prose prose-sm max-w-none text-gray-800">
          <Markdown content={text} />
        </div>
      ) : (
        <EmptyState>无收尾文本</EmptyState>
      );
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-gray-500 mb-1">{children}</div>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-gray-400 italic">{children}</div>;
}

function JsonBlock({ value, maxHeight = "max-h-[300px]" }: { value: unknown; maxHeight?: string }) {
  let str: string;
  try {
    str = JSON.stringify(value, null, 2);
  } catch {
    str = String(value);
  }
  return (
    <pre
      className={`text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-auto ${maxHeight} whitespace-pre-wrap break-words text-gray-700`}
    >
      {str}
    </pre>
  );
}

function extractText(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  return null;
}

function extractField(v: unknown, key: string): unknown {
  if (!v || typeof v !== "object") return null;
  return (v as Record<string, unknown>)[key];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
