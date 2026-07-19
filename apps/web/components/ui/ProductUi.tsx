"use client";

import { useEffect, type ReactNode, type SelectHTMLAttributes } from "react";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";

/** 统一危险操作确认框，替代浏览器原生 confirm，保证视觉、键盘与文案一致。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  busy = false,
  tone = "danger",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    // 弹窗打开时锁定页面滚动，并允许 Esc 无副作用关闭。
    const previous = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onClose, open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog-panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description">
        <button className="dialog-close" onClick={onClose} disabled={busy} aria-label="关闭弹窗"><X size={17} /></button>
        <div className={`dialog-icon ${tone === "danger" ? "dialog-icon-danger" : "dialog-icon-primary"}`}><AlertTriangle size={19} /></div>
        <h2 id="confirm-dialog-title" className="dialog-title">{title}</h2>
        <p id="confirm-dialog-description" className="dialog-description">{description}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button className={tone === "danger" ? "btn btn-danger" : "btn btn-primary"} onClick={() => void onConfirm()} disabled={busy} autoFocus>
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

/** 页面头部统一标题、说明和主操作，避免业务页面各自维护不同间距。 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** 状态徽章用文字和颜色共同表达，不能只靠颜色区分业务状态。 */
export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  const palette = {
    neutral: { background: "var(--line-2)", color: "var(--ink-2)" },
    brand: { background: "var(--brand-soft)", color: "var(--brand-ink)" },
    success: { background: "#E9EEEC", color: "var(--ok)" },
    warning: { background: "#F2EFE8", color: "var(--warn)" },
    danger: { background: "#F4EAE9", color: "var(--err)" },
  }[tone];

  return <span className="chip" style={palette}>{children}</span>;
}

/** 来源徽标同时表达数据由谁产生；title 中说明后续消费优先级。 */
export function ProvenanceBadge({ source, confidence }: { source: string; confidence?: number }) {
  const meta: Record<string, { label: string; priority: string; tone: "brand" | "neutral" | "warning" }> = {
    user: { label: "用户维护", priority: "优先级高", tone: "brand" },
    document: { label: "文档提取", priority: "有原文依据时优先级高", tone: "neutral" },
    website: { label: "官网抓取", priority: "官方来源，优先级中", tone: "neutral" },
    platform: { label: "平台生成", priority: "批准后可用，优先级低于用户维护", tone: "warning" },
    historical_content: { label: "历史内容", priority: "仅作参考", tone: "warning" },
    inferred: { label: "AI 推断", priority: "低置信，必须人工确认", tone: "warning" },
  };
  const item = meta[source] ?? { label: source, priority: "普通来源", tone: "neutral" as const };
  const confidenceText = confidence == null ? "" : ` · 置信度 ${Math.round(confidence * 100)}%`;
  return <StatusBadge tone={item.tone} ><span title={`${item.priority}${confidenceText}`}>{item.label}{confidenceText}</span></StatusBadge>;
}

/** 空状态使用统一的直立文字和安静边框，避免各页面遗留斜体或彩色卡片。 */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

/** 统一 Select 的箭头、圆角与交互状态，同时保留原生键盘和屏幕阅读器能力。 */
export function SelectField({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-shell">
      <select {...props} className={`field select-field ${className}`}>{children}</select>
      <ChevronDown className="select-icon" size={15} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/** 项目 Guide 把全链路解释和当前建议合并，帮助新用户理解每一步为什么存在。 */
export function ProjectGuide({
  current,
  nextTitle,
  nextDescription,
  action,
}: {
  current: 1 | 2 | 3 | 4;
  nextTitle: string;
  nextDescription: string;
  action: ReactNode;
}) {
  const steps = [
    { title: "添加资料", description: "提供产品手册、官网等真实信息来源" },
    { title: "确认信息", description: "审核 AI 整理的事实与可用表达" },
    { title: "创建内容", description: "按平台、受众和场景生成内容方向" },
    { title: "核查保存", description: "检查依据与规则，沉淀为内容资产" },
  ];
  return (
    <section className="project-guide" aria-label="项目引导">
      <ol className="guide-steps">
        {steps.map((step, index) => {
          const number = index + 1;
          const state = number < current ? "complete" : number === current ? "active" : "pending";
          return (
            <li key={step.title} className="guide-step" data-state={state} aria-current={state === "active" ? "step" : undefined}>
              <span className="guide-step-number">{state === "complete" ? <Check size={13} /> : number}</span>
              <div className="text-[13px] font-semibold">{step.title}</div>
              <p className="text-[11px] leading-5 mt-1">{step.description}</p>
            </li>
          );
        })}
      </ol>
      <div className="guide-next">
        <div>
          <div className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--brand-ink)" }}>建议下一步</div>
          <h2 className="text-lg font-semibold">{nextTitle}</h2>
          <p className="text-[13px] leading-6 mt-1" style={{ color: "var(--ink-3)" }}>{nextDescription}</p>
        </div>
        {action}
      </div>
    </section>
  );
}

/** 工作流状态是业务阶段的只读投影，明确告诉用户当前在哪里、下一步是什么。 */
export function WorkflowTrack({
  steps,
  activeIndex,
}: {
  steps: string[];
  activeIndex: number;
}) {
  return (
    <ol className="workflow-track" aria-label="内容任务状态">
      {steps.map((step, index) => (
        <li
          key={step}
          className="workflow-step"
          data-state={index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending"}
          aria-current={index === activeIndex ? "step" : undefined}
        >
          {step}
        </li>
      ))}
    </ol>
  );
}

/** 主流程步骤只描述用户任务，不暴露 RAG、Claim 或 Agent 内部阶段。 */
export function ProductSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ["添加资料", "确认信息", "创建内容", "核查保存"];
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-4 mb-6" aria-label="项目进度">
      {steps.map((label, index) => {
        const step = index + 1;
        const complete = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2 text-xs" style={{ color: active ? "var(--ink)" : "var(--ink-3)" }}>
            <span
              className="w-6 h-6 flex-none rounded-full grid place-items-center border text-[11px]"
              style={{
                background: complete || active ? "var(--brand)" : "var(--bg-2)",
                borderColor: complete || active ? "var(--brand)" : "var(--line-strong)",
                color: complete || active ? "#fff" : "var(--ink-3)",
              }}
            >
              {complete ? <Check size={13} /> : step}
            </span>
            <span style={{ fontWeight: active ? 600 : 400 }}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
