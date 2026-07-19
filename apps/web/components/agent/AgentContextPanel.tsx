/**
 * AgentContextPanel — 透明上下文入口（v1.0 优化项 1）
 *
 * 目的：让用户在每次 Agent 对话时，能一键看到"实际传给 Agent 的上下文"，
 * 而不是只能盯着 ReAct trace 步骤。
 *
 * 展示内容（按"真正进入 Agent 入参"的来源拼装）：
 *   1. 用户消息 — 当次 Chat 输入框发出的 prompt
 *   2. 项目记忆 — agent_memory（用户偏好、风格、禁忌、受众）
 *   3. 平台规则 — platform_rules（max_length / banned_keywords / mandatory_tag）
 *   4. 可用工具 — 后端 agent-tools.service.ts 注册的能力清单（前端枚举）
 *
 * 设计取舍：
 *   - 不另起后端接口：memory / platform-rules 都已有 list 端点，复用即可
 *   - 工具清单写在前端常量里：避免引入"AvailableTools" 新 API，要保持同步靠 PR 评审
 *   - 模态以 fixed overlay 实现，不引入额外 dialog 依赖
 */

"use client";

import { useEffect, useState } from "react";
import { X, BookOpen, ShieldCheck, MessageSquare, Wrench, FileText, Code } from "lucide-react";
import { memoryApi, platformRulesApi, autoGenerationsApi, agentApi } from "@/lib/api";
import type {
  MemoryRow, PlatformRule, ProjectAutoGenLatest, AutoGenCardType, ChatMessage,
} from "@/lib/api";
import { Markdown } from "@/components/markdown/Markdown";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** 当次对话的用户消息（来自 Chat 页 lastPrompt） */
  userMessage: string;
  /** 当前 agent run id（有则拉真实 system prompt 落库快照；无则仅展示结构化分区） */
  runId?: string | null;
}

/**
 * Agent 可用工具枚举——与后端 agent-tools.service.ts 的注册保持同步。
 * 这是一份只读说明文本，不参与执行，所以可以前端硬编码。
 */
const AGENT_TOOLS: Array<{ name: string; desc: string }> = [
  { name: "search_kb", desc: "检索项目知识库（产品 / 竞品 / 历史资料）的相关片段" },
  { name: "search_history", desc: "检索本项目历史生成记录，复用既有素材" },
  { name: "search_notes", desc: "检索用户保存的笔记库" },
  { name: "search_web", desc: "联网搜索补充外部信息" },
  { name: "generate_draft", desc: "调 LLM 生成草稿（基于已收集上下文）" },
  { name: "critic_review", desc: "对草稿做合规 / 偏好审查并给出修改建议" },
  { name: "log_decision", desc: "记录关键决策，写入 trace" },
];

interface ContextLoadState {
  requestKey: string | null;
  status: "idle" | "loaded" | "error";
  error: string | null;
}

export function AgentContextPanel({ open, onClose, projectId, userMessage, runId }: Props) {
  const [memory, setMemory] = useState<MemoryRow[]>([]);
  const [rules, setRules] = useState<PlatformRule[]>([]);
  const [knowledge, setKnowledge] = useState<Partial<Record<AutoGenCardType, ProjectAutoGenLatest>>>({});
  const [rawPrompt, setRawPrompt] = useState<string | null>(null);
  const [rawMessages, setRawMessages] = useState<ChatMessage[] | null>(null);
  const [loadState, setLoadState] = useState<ContextLoadState>({
    requestKey: null,
    status: "idle",
    error: null,
  });
  // loading/error 由当前请求 key 派生，避免 effect 启动时同步 setState 造成级联渲染。
  const requestKey = open && projectId ? `${projectId}:${runId ?? "latest"}` : null;
  const isCurrentRequest = requestKey !== null && loadState.requestKey === requestKey;
  const loading = requestKey !== null && (!isCurrentRequest || loadState.status === "idle");
  const error = isCurrentRequest && loadState.status === "error" ? loadState.error : null;

  // 打开时按需拉一次；关闭后不清状态，二次打开还能看上次的快照
  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    // runId 存在时并发去拉落库的真实 prompt；不存在就 null 占位
    const ctxPromise = runId
      ? agentApi
          .getRunContext(projectId, runId)
          .catch(() => ({ systemPrompt: null, inputMessages: null }))
      : Promise.resolve({ systemPrompt: null, inputMessages: null });
    Promise.all([
      memoryApi.listMemory(projectId),
      platformRulesApi.listRules(projectId),
      autoGenerationsApi.getLatestProjectAutoGen(projectId),
      ctxPromise,
    ])
      .then(([m, r, k, ctx]) => {
        if (cancelled) return;
        setMemory(m);
        setRules(r.rules);
        const idx: Partial<Record<AutoGenCardType, ProjectAutoGenLatest>> = {};
        for (const it of k.items) idx[it.cardType] = it;
        setKnowledge(idx);
        setRawPrompt(ctx.systemPrompt ?? null);
        setRawMessages((ctx.inputMessages as ChatMessage[] | null) ?? null);
        setLoadState({ requestKey, status: "loaded", error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadState({
          requestKey,
          status: "error",
          error: err instanceof Error ? err.message : "加载上下文失败",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, requestKey, runId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(11,17,32,.45)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-[14px] shadow-2xl w-[640px] max-w-[92vw] max-h-[82vh] flex flex-col"
        style={{ border: "1px solid var(--line)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
          <BookOpen size={16} className="text-purple-500" />
          <div className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            本次 Agent 对话的实际上下文
          </div>
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100"
            style={{ color: "var(--ink-3)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[13px]">
          {/* 真实 system prompt（落库快照）——v1.0 优化项 1 终极版 */}
          <Section icon={<Code size={13} />} title="实际发给 LLM 的 system prompt">
            {!runId ? (
              <Empty text="发送一条消息后此处显示本次 run 实际拼接的 prompt 原文" />
            ) : loading ? (
              <Empty text="加载中…" />
            ) : !rawPrompt ? (
              <Empty text="未捕获到 prompt 快照（可能 run 尚未启动到组装阶段，或后端旧版本）" />
            ) : (
              <pre
                className="rounded-md p-3 text-[11.5px] leading-[1.55] overflow-auto max-h-[260px]"
                style={{
                  background: "#0b1120",
                  color: "#e6e9f0",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {rawPrompt}
              </pre>
            )}
          </Section>

          {/* 真实输入 messages */}
          {runId && rawMessages && rawMessages.length > 0 && (
            <Section icon={<Code size={13} />} title={`输入 messages（${rawMessages.length} 条）`}>
              <pre
                className="rounded-md p-3 text-[11.5px] leading-[1.55] overflow-auto max-h-[180px]"
                style={{
                  background: "#0b1120",
                  color: "#e6e9f0",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {JSON.stringify(rawMessages, null, 2)}
              </pre>
            </Section>
          )}

          {/* 用户消息 */}
          <Section icon={<MessageSquare size={13} />} title="用户消息">
            {userMessage ? (
              <div
                className="rounded-md p-3 leading-[1.6]"
                style={{ background: "var(--brand-soft)", color: "var(--ink)" }}
              >
                {userMessage}
              </div>
            ) : (
              <Empty text="还未发送消息" />
            )}
          </Section>

          {/* 产品知识快照——核心：让用户看到 agent 真的拿到了产品定位 */}
          <Section icon={<FileText size={13} />} title="产品知识快照（注入 system prompt）">
            {loading ? (
              <Empty text="加载中…" />
            ) : !knowledge.intro && !knowledge.compete ? (
              <Empty text="尚未上传产品 / 竞品资料——Agent 将只能依赖 search_kb 工具检索碎片，强烈建议先在知识库上传产品资料" />
            ) : (
              <div className="space-y-3">
                {(["intro", "compete"] as const).map((k) =>
                  knowledge[k] ? (
                    <div
                      key={k}
                      className="rounded-md p-3"
                      style={{
                        background:
                          k === "intro"
                            ? "var(--brand-soft)"
                            : "rgba(224,140,90,.06)",
                        border: "1px solid var(--line-2)",
                      }}
                    >
                      <div
                        className="text-[11.5px] font-semibold mb-1.5 uppercase tracking-wider"
                        style={{ color: k === "intro" ? "var(--brand)" : "var(--tool)" }}
                      >
                        {k === "intro" ? "产品介绍" : "竞品分析"}
                      </div>
                      <div
                        className="max-h-[180px] overflow-y-auto pr-1"
                        style={{ scrollbarWidth: "thin" }}
                      >
                        <Markdown content={knowledge[k]!.resultNotes ?? ""} />
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </Section>

          {/* 项目记忆 */}
          <Section icon={<BookOpen size={13} />} title={`项目记忆（${memory.length}）`}>
            {loading ? (
              <Empty text="加载中…" />
            ) : memory.length === 0 ? (
              <Empty text="项目尚未沉淀任何偏好记忆——可在「记忆」面板手动添加或反馈后蒸馏" />
            ) : (
              <ul className="space-y-1.5">
                {memory.map((m) => (
                  <li
                    key={m.id}
                    className="flex gap-2 items-start rounded-md p-2"
                    style={{ background: "rgba(11,17,32,.03)" }}
                  >
                    <span
                      className="chip text-[10px] flex-none"
                      style={{ background: "rgba(180,83,9,.1)", color: "var(--tool)" }}
                    >
                      {m.kind}
                    </span>
                    <span style={{ color: "var(--ink)" }}>{m.content}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 平台规则 */}
          <Section icon={<ShieldCheck size={13} />} title={`平台规则（${rules.length}）`}>
            {loading ? (
              <Empty text="加载中…" />
            ) : rules.length === 0 ? (
              <Empty text="未配置平台规则——Agent 将按通用约束生成" />
            ) : (
              <ul className="space-y-1.5">
                {rules.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-md p-2 leading-[1.55]"
                    style={{ background: "rgba(11,17,32,.03)" }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: "var(--ink)" }}>
                        {r.name}
                      </span>
                      <span
                        className="chip text-[10px]"
                        style={{
                          background: r.enabled ? "var(--brand-soft)" : "rgba(11,17,32,.06)",
                          color: r.enabled ? "var(--brand)" : "var(--ink-3)",
                        }}
                      >
                        {r.enabled ? "启用" : "禁用"}
                      </span>
                    </div>
                    <div className="text-[11.5px] mt-1" style={{ color: "var(--ink-3)" }}>
                      {summariseRuleConfig(r)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 可用工具 */}
          <Section icon={<Wrench size={13} />} title={`可用工具（${AGENT_TOOLS.length}）`}>
            <ul className="space-y-1">
              {AGENT_TOOLS.map((t) => (
                <li key={t.name} className="flex gap-2 items-start">
                  <code
                    className="text-[11.5px] flex-none mt-[1px] rounded px-1.5 py-0.5"
                    style={{ background: "rgba(11,17,32,.05)", color: "var(--ink)" }}
                  >
                    {t.name}
                  </code>
                  <span style={{ color: "var(--ink-2)" }}>{t.desc}</span>
                </li>
              ))}
            </ul>
          </Section>

          {error && (
            <div
              className="rounded-md p-3 text-[12px]"
              style={{
                background: "rgba(179,38,30,.06)",
                border: "1px solid rgba(179,38,30,.18)",
                color: "var(--err)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div
          className="px-5 py-2.5 text-[11.5px] border-t border-gray-100"
          style={{ color: "var(--ink-3)" }}
        >
          说明：以上是发起本次 Agent run 时后端拼接 system prompt 用到的实际素材；具体每轮检索到的 chunk 见下方 trace 时间轴里的 <code>search_kb</code> 节点。
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-1.5 text-[12px] font-semibold mb-2 uppercase tracking-wider"
        style={{ color: "var(--ink-3)" }}
      >
        <span style={{ color: "var(--brand)" }}>{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
      {text}
    </div>
  );
}

function summariseRuleConfig(rule: PlatformRule): string {
  const parts: string[] = [];
  const c = rule.config;
  if (c.maxLength != null) parts.push(`字数 ≤ ${c.maxLength}`);
  if (c.bannedKeywords && c.bannedKeywords.length > 0) {
    parts.push(`禁用词 ${c.bannedKeywords.length} 个`);
  }
  if (c.mandatoryTagPattern) {
    parts.push(`必带 ${c.mandatoryTagPattern}${c.mandatoryTagMin ? ` × ${c.mandatoryTagMin}` : ""}`);
  }
  if (c.styleHint) parts.push(`风格：${c.styleHint}`);
  return parts.length > 0 ? parts.join(" · ") : "无特殊约束";
}
