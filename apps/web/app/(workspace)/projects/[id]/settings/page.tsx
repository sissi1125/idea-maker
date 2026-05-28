/**
 * 项目设置页面 — feat-200.6 补充
 *
 * 对接后端：
 *   GET  /projects/:pid/settings  → 加载当前配置
 *   PUT  /projects/:pid/settings  → 保存修改
 *
 * 页面分 3 个 Section：
 *   1. LLM 配置 — provider / API Key / model / temperature / maxTokens（可编辑）
 *   2. 思考深度 — thinkingDepth（可编辑）
 *   3. RAG 策略 — 完整 pipeline 各阶段当前方法（只读展示）
 *
 * RAG 策略展示两条 pipeline：
 *   Ingestion Pipeline：idempotency → preprocess → chunk → embedding → storage
 *   Generation Pipeline：context-mgmt → query-rewrite → intent → retrieval → filter
 *                        → rerank → citation → prompt-build → generation → evaluation → fallback
 *
 * 方法名对应 packages/rag-core + packages/shared-types 中的实际实现。
 * 当前为固定配置（default.yaml），暂不支持用户修改 RAG 策略。
 *
 * 面试考点：
 *   - 受控表单 vs 非受控表单
 *   - Partial<T> 与 dirty diff 只提交变化字段
 *   - API Key 安全：前端不存明文、后端不回传
 */

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Settings, Save, Check, AlertCircle, RotateCcw,
  Cpu, Brain, Key, Thermometer, Hash,
  ArrowRight, Database, FileText, Scissors, Box, HardDrive,
  MessageSquare, Search, Compass, Filter, ArrowUpDown, Quote,
  Layers, Sparkles, ShieldCheck, LifeBuoy,
} from "lucide-react";
import { projectsApi } from "@/lib/api";
import type { ProjectSettings } from "@/lib/api";
import { useProjectsStore } from "@/lib/stores/projects-store";

// ── 常量：下拉选项 ──────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: "", label: "未设置（使用系统默认）" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "自定义 OpenAI 兼容" },
] as const;

const MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  custom: [],
};

const THINKING_DEPTHS = [
  { value: "", label: "未设置（使用默认）" },
  { value: "fast", label: "快速 — 跳过 evaluation，最快出结果" },
  { value: "standard", label: "标准 — 完整 pipeline，含 evaluation" },
  { value: "deep", label: "深度 — 多轮 rewrite + 严格评估" },
] as const;

// ── RAG 策略常量（对应 rag-core 实际实现 + default.yaml 配置） ──────────────

/**
 * 每个 stage 的定义：
 *   id     — 对应 rag-core stage 函数名
 *   label  — 中文名
 *   method — 当前使用的方法（来自 default.yaml / ingestion-job-runner 硬编码）
 *   desc   — 方法简述
 *   icon   — lucide icon
 *   color  — 进度条 / 图标色
 */
interface StageInfo {
  id: string;
  label: string;
  method: string;
  desc: string;
  icon: typeof Settings;
  color: string;
  bg: string;
}

const INGESTION_STAGES: StageInfo[] = [
  {
    id: "idempotency", label: "去重校验", method: "sha256-content",
    desc: "基于文件内容 SHA-256 哈希判重，避免重复入库",
    icon: Database, color: "#6366F1", bg: "rgba(99,102,241,.08)",
  },
  {
    id: "preprocess", label: "文档预处理", method: "auto",
    desc: "按 MIME 类型自动选择：markdown-structure / pdf-pages / markitdown",
    icon: FileText, color: "#8B5CF6", bg: "rgba(139,92,246,.08)",
  },
  {
    id: "chunk", label: "文本分块", method: "recursive",
    desc: "递归分块（chunkSize=600, overlap=80），保留标题层级上下文",
    icon: Scissors, color: "#EC4899", bg: "rgba(236,72,153,.08)",
  },
  {
    id: "embedding", label: "向量化", method: "openai-3-small",
    desc: "OpenAI text-embedding-3-small（dim=1024）；无 API Key 时降级 debug-deterministic",
    icon: Box, color: "#F59E0B", bg: "rgba(245,158,11,.08)",
  },
  {
    id: "storage", label: "向量存储", method: "pgvector-replace-version",
    desc: "写入 pgvector，按 document_id 替换旧 chunks，HNSW 索引",
    icon: HardDrive, color: "#10B981", bg: "rgba(16,185,129,.08)",
  },
];

const GENERATION_STAGES: StageInfo[] = [
  {
    id: "context-management", label: "上下文管理", method: "session-history",
    desc: "注入会话历史（MVP 阶段传空 history，无多轮对话）",
    icon: MessageSquare, color: "#6366F1", bg: "rgba(99,102,241,.08)",
  },
  {
    id: "query-rewrite", label: "查询改写", method: "rule-keyword-expansion",
    desc: "基于规则扩展关键词（maxExpansions=3），不调 LLM",
    icon: Search, color: "#8B5CF6", bg: "rgba(139,92,246,.08)",
  },
  {
    id: "intent-recognition", label: "意图识别", method: "rule-based",
    desc: "基于关键词规则判断查询意图（marketing / comparison / general）",
    icon: Compass, color: "#EC4899", bg: "rgba(236,72,153,.08)",
  },
  {
    id: "retrieval", label: "向量检索", method: "dense-vector",
    desc: "pgvector 余弦相似度检索（topK=10），用 OpenAI embedding 编码查询",
    icon: Database, color: "#F59E0B", bg: "rgba(245,158,11,.08)",
  },
  {
    id: "filter", label: "结果过滤", method: "score-threshold",
    desc: "过滤相似度低于 0.3 的匹配结果",
    icon: Filter, color: "#EF4444", bg: "rgba(239,68,68,.08)",
  },
  {
    id: "rerank", label: "重排序", method: "score-only",
    desc: "按原始相似度分数排序取 topN=5，不调用额外模型",
    icon: ArrowUpDown, color: "#14B8A6", bg: "rgba(20,184,166,.08)",
  },
  {
    id: "citation", label: "引用标注", method: "chunk-citation",
    desc: "为每个 chunk 生成引用标记，关联源文档和位置",
    icon: Quote, color: "#6366F1", bg: "rgba(99,102,241,.08)",
  },
  {
    id: "prompt-build", label: "Prompt 构建", method: "marketing-template",
    desc: "营销文案模板，注入系统角色 + 参考资料 + 用户查询",
    icon: Layers, color: "#8B5CF6", bg: "rgba(139,92,246,.08)",
  },
  {
    id: "generation", label: "LLM 生成", method: "marketing-ideas",
    desc: "调用 LLM 生成营销创意（temperature=0.7, maxTokens=2000）",
    icon: Sparkles, color: "#F59E0B", bg: "rgba(245,158,11,.08)",
  },
  {
    id: "evaluation", label: "质量评估", method: "rag-metrics-only",
    desc: "计算 RAG 指标（相关性、覆盖度），不调 LLM faithfulness 检查",
    icon: ShieldCheck, color: "#10B981", bg: "rgba(16,185,129,.08)",
  },
  {
    id: "fallback", label: "兜底策略", method: "reject-answer",
    desc: "检索结果为 0 时返回友好提示，引导用户补充资料",
    icon: LifeBuoy, color: "#EF4444", bg: "rgba(239,68,68,.08)",
  },
];

// ── 表单 state 类型 ──────────────────────────────────────────────────────────

interface FormState {
  provider: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  thinkingDepth: string;
}

function settingsToForm(s: ProjectSettings): FormState {
  return {
    provider: s.provider ?? "",
    apiKey: "",
    model: s.model ?? "",
    temperature: s.temperature ?? 0.7,
    maxTokens: s.maxTokens ?? 2000,
    thinkingDepth: s.thinkingDepth ?? "",
  };
}

function diffForm(
  original: FormState,
  current: FormState,
): Partial<Record<keyof FormState, unknown>> {
  const changes: Partial<Record<keyof FormState, unknown>> = {};
  for (const key of Object.keys(original) as (keyof FormState)[]) {
    if (key === "apiKey") {
      if (current.apiKey.trim()) changes.apiKey = current.apiKey.trim();
      continue;
    }
    if (String(original[key]) !== String(current[key])) {
      changes[key] = current[key];
    }
  }
  return changes;
}

// ── 通用子组件 ──────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  desc,
  badge,
  children,
}: {
  icon: typeof Settings;
  title: string;
  desc: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-[20px_22px] flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span
          className="w-7 h-7 rounded-[7px] flex items-center justify-center"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          <Icon size={14} strokeWidth={1.8} />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {title}
            </div>
            {badge && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(11,17,32,.06)", color: "var(--ink-3)" }}
              >
                {badge}
              </span>
            )}
          </div>
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            {desc}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12.5px] font-semibold" style={{ color: "var(--ink-2)" }}>
        {label}
      </label>
      {children}
      {hint && (
        <div className="text-[11px]" style={{ color: "var(--ink-4)" }}>{hint}</div>
      )}
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg text-[13px] px-3 py-2 outline-none"
      style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg text-[13px] px-3 py-2 outline-none"
      style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
    />
  );
}

// ── RAG Pipeline Stage 行组件 ────────────────────────────────────────────────

function StageRow({ stage, index, total }: { stage: StageInfo; index: number; total: number }) {
  const Icon = stage.icon;
  return (
    <div className="flex items-start gap-3">
      {/* 左侧：序号连线 */}
      <div className="flex flex-col items-center flex-none w-7">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
          style={{ background: stage.bg, color: stage.color }}
        >
          {index + 1}
        </div>
        {index < total - 1 && (
          <div className="w-px flex-1 min-h-[20px]" style={{ background: "var(--line)" }} />
        )}
      </div>

      {/* 右侧：内容 */}
      <div className="flex-1 pb-3">
        <div className="flex items-center gap-2 mb-0.5">
          <Icon size={13} strokeWidth={1.8} style={{ color: stage.color }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
            {stage.label}
          </span>
          <code
            className="text-[11px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: stage.bg, color: stage.color }}
          >
            {stage.method}
          </code>
        </div>
        <div className="text-[12px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
          {stage.desc}
        </div>
      </div>
    </div>
  );
}

/** Pipeline 流程图：stages 列表 + 箭头连接 */
function PipelineView({
  title,
  stages,
  accentColor,
}: {
  title: string;
  stages: StageInfo[];
  accentColor: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ArrowRight size={13} strokeWidth={2} style={{ color: accentColor }} />
        <span className="text-[12.5px] font-semibold" style={{ color: accentColor }}>
          {title}
        </span>
        <span className="text-[11px]" style={{ color: "var(--ink-4)" }}>
          {stages.length} stages
        </span>
      </div>
      <div className="pl-1">
        {stages.map((stage, i) => (
          <StageRow key={stage.id} stage={stage} index={i} total={stages.length} />
        ))}
      </div>
    </div>
  );
}

// ── 主页面 ──────────────────────────────────────────────────────────────────

export default function ProjectSettingsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { setCurrentProject, currentProject: getCurrent } = useProjectsStore();
  const project = getCurrent();

  const [form, setForm] = useState<FormState>({
    provider: "", apiKey: "", model: "",
    temperature: 0.7, maxTokens: 2000, thinkingDepth: "",
  });
  const [original, setOriginal] = useState<FormState>(form);
  const [hasApiKey, setHasApiKey] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  /**
   * 把加载逻辑 inline 进 useEffect，配合 cancelled 标记——
   * 避免 useCallback + useEffect(() => cb()) 那种 lint react-hooks/set-state-in-effect 误报，
   * 同时保证项目切换 / strict-mode 双调用时不会写入过期数据。
   */
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const { settings } = await projectsApi.getSettings(projectId);
        if (cancelled) return;
        const formState = settingsToForm(settings);
        setForm(formState);
        setOriginal(formState);
        setHasApiKey(!!settings.provider);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载设置失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const changes = diffForm(original, form);
  const isDirty = Object.keys(changes).length > 0;

  const handleSave = async () => {
    if (!projectId || !isDirty) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(changes)) {
        payload[key === "apiKey" ? "encryptedApiKey" : key] = val;
      }
      const { settings } = await projectsApi.updateSettings(projectId, payload);
      const formState = settingsToForm(settings);
      setForm(formState);
      setOriginal(formState);
      setHasApiKey(!!settings.provider);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => { setForm(original); setSaved(false); setError(null); };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const handleProviderChange = (v: string) => { set("provider", v); set("model", ""); };
  const modelOptions = [
    { value: "", label: "未设置（使用系统默认）" },
    ...(MODELS[form.provider] ?? []),
  ];

  if (loading) {
    return (
      <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
        <div className="max-w-[720px] mx-auto px-7 py-6">
          <div className="flex items-center gap-3 mb-6">
            <Settings size={20} strokeWidth={1.8} style={{ color: "var(--ink-3)" }} />
            <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
              项目设置
            </h1>
          </div>
          <div className="text-[13px]" style={{ color: "var(--ink-3)" }}>加载中…</div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
      <div className="max-w-[720px] mx-auto px-7 py-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Settings size={20} strokeWidth={1.8} style={{ color: "var(--ink-3)" }} />
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
                项目设置
              </h1>
              <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                {project?.name ?? "项目"} · 配置 LLM 参数与查看 RAG 策略
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <button onClick={handleReset} className="btn btn-sm btn-ghost" style={{ color: "var(--ink-3)" }}>
                <RotateCcw size={12} strokeWidth={2} /> 重置
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="btn btn-sm btn-primary"
              style={{ opacity: !isDirty || saving ? 0.5 : 1 }}
            >
              {saving ? "保存中…" : saved ? <><Check size={12} strokeWidth={2} /> 已保存</> : <><Save size={12} strokeWidth={2} /> 保存设置</>}
            </button>
          </div>
        </div>

        {saved && (
          <div className="rounded-lg p-3 mb-4 text-[13px] flex items-center gap-2 fade-in"
               style={{ background: "rgba(31,138,91,.06)", border: "1px solid rgba(31,138,91,.18)", color: "var(--ok)" }}>
            <Check size={14} strokeWidth={2} /> 设置已保存，下次生成时将使用新配置。
          </div>
        )}
        {error && (
          <div className="rounded-lg p-3 mb-4 text-[13px] flex items-center gap-2"
               style={{ background: "rgba(179,38,30,.06)", border: "1px solid rgba(179,38,30,.18)", color: "var(--err)" }}>
            <AlertCircle size={14} strokeWidth={2} /> {error}
          </div>
        )}

        <div className="flex flex-col gap-5">
          {/* ── Section 1: LLM 配置 ────────────────────────────────── */}
          <Section icon={Cpu} title="LLM 配置" desc="选择大模型供应商、模型和生成参数">
            <Field label="Provider" hint="选择 LLM 供应商，留空则使用系统默认（需后端已配置 OPENAI_API_KEY）">
              <SelectInput value={form.provider} onChange={handleProviderChange} options={PROVIDERS} />
            </Field>

            {form.provider && (
              <Field
                label="API Key"
                hint={hasApiKey ? "已设置。留空保持不变，输入新值将覆盖。" : "输入对应供应商的 API Key，将加密存储。"}
              >
                <div className="relative">
                  <Key size={14} strokeWidth={1.8} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-4)" }} />
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => set("apiKey", e.target.value)}
                    placeholder={hasApiKey ? "••••••••（已设置，输入新值覆盖）" : "sk-..."}
                    className="w-full rounded-lg text-[13px] pl-9 pr-3 py-2 outline-none"
                    style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
                  />
                </div>
              </Field>
            )}

            <Field label="Model" hint="选择具体模型，留空则使用 provider 默认模型">
              {form.provider && MODELS[form.provider]?.length ? (
                <SelectInput value={form.model} onChange={(v) => set("model", v)} options={modelOptions} />
              ) : (
                <TextInput
                  value={form.model}
                  onChange={(v) => set("model", v)}
                  placeholder={form.provider === "custom" ? "输入模型名称" : "先选择 Provider"}
                />
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Temperature" hint="0 = 确定性输出，1 = 创意最大">
                <div className="flex items-center gap-3">
                  <Thermometer size={14} strokeWidth={1.8} style={{ color: "var(--ink-4)" }} />
                  <input type="range" min={0} max={1} step={0.05} value={form.temperature}
                         onChange={(e) => set("temperature", Number(e.target.value))}
                         className="flex-1 accent-[var(--brand)]" />
                  <input type="number" min={0} max={1} step={0.05} value={form.temperature}
                         onChange={(e) => set("temperature", Number(e.target.value))}
                         className="w-16 rounded-lg text-[13px] px-2 py-1.5 text-center outline-none mono"
                         style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }} />
                </div>
              </Field>
              <Field label="Max Tokens" hint="生成内容的最大 token 数">
                <div className="flex items-center gap-3">
                  <Hash size={14} strokeWidth={1.8} style={{ color: "var(--ink-4)" }} />
                  <input type="number" min={100} max={16000} step={100} value={form.maxTokens}
                         onChange={(e) => set("maxTokens", Number(e.target.value))}
                         className="flex-1 rounded-lg text-[13px] px-3 py-1.5 outline-none mono"
                         style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }} />
                </div>
              </Field>
            </div>
          </Section>

          {/* ── Section 2: 思考深度 ──────────────────────────────── */}
          <Section icon={Brain} title="思考深度" desc="控制 Agent 推理和评估的精细程度">
            <Field label="Thinking Depth" hint="深度越高，质量越好但耗时更长、成本更高">
              <SelectInput value={form.thinkingDepth} onChange={(v) => set("thinkingDepth", v)} options={THINKING_DEPTHS} />
            </Field>
            <div className="rounded-lg p-3 text-[12px] leading-relaxed"
                 style={{ background: "rgba(11,17,32,.02)", border: "1px solid var(--line-2)" }}>
              <table className="w-full" style={{ color: "var(--ink-2)" }}>
                <thead>
                  <tr className="text-left text-[11px]" style={{ color: "var(--ink-4)" }}>
                    <th className="pb-1.5 font-semibold">模式</th>
                    <th className="pb-1.5 font-semibold">Query Rewrite</th>
                    <th className="pb-1.5 font-semibold">Evaluation</th>
                    <th className="pb-1.5 font-semibold">预估耗时</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ opacity: form.thinkingDepth === "fast" ? 1 : 0.5 }}>
                    <td className="py-1">⚡ 快速</td><td>单轮</td><td>跳过</td><td>~3s</td>
                  </tr>
                  <tr style={{ opacity: !form.thinkingDepth || form.thinkingDepth === "standard" ? 1 : 0.5 }}>
                    <td className="py-1">⚖️ 标准</td><td>单轮</td><td>完整</td><td>~8s</td>
                  </tr>
                  <tr style={{ opacity: form.thinkingDepth === "deep" ? 1 : 0.5 }}>
                    <td className="py-1">🧠 深度</td><td>多轮扩展</td><td>严格 + 重试</td><td>~15s</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── Section 3: RAG 策略（只读） ──────────────────────── */}
          <Section
            icon={Layers}
            title="RAG 策略"
            desc="从文档入库到内容生成的完整 pipeline 各阶段方法"
            badge="只读"
          >
            {/* 说明 */}
            <div
              className="rounded-lg p-3 text-[12px] leading-relaxed flex items-start gap-2"
              style={{ background: "rgba(79,168,154,.04)", border: "1px solid rgba(79,168,154,.15)", color: "var(--ink-2)" }}
            >
              <span className="text-[14px] mt-px">🔬</span>
              <div>
                以下配置来自 <code className="text-[11px] px-1 py-0.5 rounded" style={{ background: "rgba(11,17,32,.06)" }}>default.yaml</code> 和 Ingestion Runner 硬编码。
                在 Playground 实验确定最佳方案后，可直接修改配置文件切换策略。暂不支持从界面修改。
              </div>
            </div>

            {/* Ingestion Pipeline */}
            <PipelineView
              title="Ingestion Pipeline — 文档 → 向量"
              stages={INGESTION_STAGES}
              accentColor="#8B5CF6"
            />

            {/* 分隔 */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
              <span className="text-[11px] font-semibold" style={{ color: "var(--ink-4)" }}>
                文档入库完成 → 用户提问触发
              </span>
              <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
            </div>

            {/* Generation Pipeline */}
            <PipelineView
              title="Generation Pipeline — 查询 → 结果"
              stages={GENERATION_STAGES}
              accentColor="#F59E0B"
            />
          </Section>

          {/*
            ── Section 4：平台规则（占位） ─────────────────────────────────
            feat-200.8 Week 8 实装；现在只放占位说明，让用户在 Settings 入口
            就能预期到这块功能在哪里。
          */}
          <Section
            icon={ShieldCheck}
            title="平台规则"
            desc="定义产出内容的平台合规约束（小红书 / 微博 / 抖音 / 公众号）"
          >
            <div className="rounded-md p-3.5 text-[12.5px] leading-[1.65]"
                 style={{
                   background: "rgba(11,17,32,.025)",
                   border: "1px dashed var(--line-strong)",
                   color: "var(--ink-3)",
                 }}>
              <div className="font-semibold mb-1.5" style={{ color: "var(--ink-2)" }}>
                Week 8 上线（feat-200.8）
              </div>
              生成时按选定平台注入规则（字数 / 敏感词 / 排版风格 / 话题标签格式），
              并对生成结果做合规校验，违规处标红提示。
              <div className="mt-2 text-[11.5px]" style={{ color: "var(--ink-4)" }}>
                当前可在 Chat 主界面通过 query 自由指定平台风格，正式校验逻辑稍后接入。
              </div>
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}
