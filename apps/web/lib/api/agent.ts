/**
 * Agent API client — feat-300.6 任务 0
 *
 * 对接后端 AgentController：
 *   POST   /projects/:pid/agent/run                              启动一次 run
 *   GET    /projects/:pid/agent/runs/:runId                      run 元数据
 *   GET    /projects/:pid/agent/runs/:runId/steps?limit=&offset= step 历史快照
 *   GET    /projects/:pid/agent/runs/:runId/stream  [SSE]         实时事件流
 *   DELETE /projects/:pid/agent/runs/:runId                      中断 run
 *
 * SSE 的两步式启动（plan §3.1）：
 *   1) POST run → 拿 runId
 *   2) new EventSource(.../stream?token=...) 实时订阅
 *   3) **并行**调 GET /steps 拿"已经发生"的历史，按 stepIndex 与 SSE 流去重
 *      —— 防止 SSE 连上前漏掉头几帧
 *
 * connectAgentSSE 用 URL query token 鉴权（plan §3.2）：浏览器 EventSource
 * 不支持自定义 header，后端 SSE Guard 接受 ?token=xxx 作为 Authorization 兜底。
 */

import { apiFetch } from "./client";

// ── 类型（与后端 agent.types.ts 保持镜像，但只暴露前端用到的字段） ──────────

export type AgentFinishReason = "done" | "max_steps" | "budget" | "aborted" | "error";
export type AgentRunStatus = "running" | "succeeded" | "failed";
export type AgentStepType = "reasoning" | "tool_call" | "tool_result" | "finish" | "context_compress";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentRunStartOpts {
  budgetUsd?: number;
  maxSteps?: number;
  modelOverride?: string;
}

export interface AgentRunStartResponse {
  runId: string;
  generationId: string;
}

export interface AgentRunRow {
  id: string;
  generationId: string | null;
  projectId: string;
  status: AgentRunStatus;
  finishReason: AgentFinishReason | null;
  maxSteps: number;
  budgetUsd: number;
  stepsUsed: number;
  costUsedUsd: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AgentStepRow {
  id: string;
  runId: string;
  stepIndex: number;
  stepType: AgentStepType;
  toolName: string | null;
  input: unknown;
  output: unknown;
  tokenUsage: { prompt?: number; completion?: number; total?: number } | null;
  durationMs: number | null;
  createdAt: string;
}

// ── SSE 帧 payload（与后端 StepFramePayload/CostFramePayload/FinishFramePayload/ErrorFramePayload 镜像）─

export interface StepFramePayload {
  runId: string;
  stepIndex: number;
  stepType: AgentStepType;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  promptIds?: string[];
  promptVersions?: string[];
}

export interface CostFramePayload {
  runId: string;
  usedUsd: number;
  percentBudget: number;
  stepIndex: number;
}

export interface FinishFramePayload {
  runId: string;
  generationId: string;
  text: string;
  finishReason: AgentFinishReason;
  costUsedUsd: number;
  stepsUsed: number;
  status: AgentRunStatus;
}

export interface ErrorFramePayload {
  runId: string;
  code: string;
  message: string;
  eventId?: string;
}

// ── HTTP 调用 ────────────────────────────────────────────────────────────────

/**
 * 启动一个 agent run。同步返回 runId / generationId；ReAct 实际执行在后端，
 * 客户端拿 runId 后立即调 connectAgentSSE 接事件流。
 */
export async function runAgent(
  projectId: string,
  messages: ChatMessage[],
  opts: AgentRunStartOpts = {},
): Promise<AgentRunStartResponse> {
  return apiFetch<AgentRunStartResponse>(`/projects/${projectId}/agent/run`, {
    method: "POST",
    body: { messages, ...opts },
  });
}

/** 查 run 元数据（status / finishReason / cost / 时间）；SSE 断开后回填同等信息 */
export async function getRun(projectId: string, runId: string): Promise<AgentRunRow> {
  return apiFetch<AgentRunRow>(`/projects/${projectId}/agent/runs/${runId}`);
}

/**
 * 拿 step 全量历史。**用途**：
 *   - SSE 重连后，按 stepIndex 与已渲染列表去重补齐（plan §3.3）
 *   - 历史 trace 回放页面（生成历史点开看 trace）
 */
export async function getSteps(
  projectId: string,
  runId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<AgentStepRow[]> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  // 注意：后端 controller 直接返回数组 AgentStepRow[]，不是 { steps: [...] }
  // 这里曾经误包了 .steps 解构，导致 history 永远是 undefined，trace 永远不渲染
  // —— 是 feat-300.6 第一版 UI 卡在「Agent 正在启动…」的根因之一
  return apiFetch<AgentStepRow[]>(
    `/projects/${projectId}/agent/runs/${runId}/steps${qs}`,
  );
}

/**
 * v1.0 优化项 1：拿 run 启动时落库的真实 system prompt + messages。
 * 「查看上下文」面板用——避免前端 / 后端各自重新渲染导致不一致。
 */
export async function getRunContext(
  projectId: string,
  runId: string,
): Promise<{ runId: string; systemPrompt: string | null; inputMessages: ChatMessage[] | null }> {
  return apiFetch(`/projects/${projectId}/agent/runs/${runId}/context`);
}

/** 中断 run：后端把 AbortController.abort()，agent 主循环走 'aborted' 收尾 */
export async function abortRun(projectId: string, runId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/agent/runs/${runId}`, { method: "DELETE" });
}

/**
 * 启动 SSE 连接。**注意**：
 *   - URL query token 鉴权（plan §3.2）：EventSource 不支持自定义 header
 *   - 调用方负责 cleanup（`new EventSource(...)` 返回值的 .close()）
 *   - 重连策略不在这里：建议用 useEventSourceWithReplay hook 管理
 */
export function connectAgentSSE(projectId: string, runId: string, token: string): EventSource {
  const baseUrl = resolveBaseUrl();
  const url = `${baseUrl}/projects/${projectId}/agent/runs/${runId}/stream?token=${encodeURIComponent(token)}`;
  return new EventSource(url);
}

/**
 * 与 client.ts 中 resolveBaseUrl 同语义；为避免循环 import 在本文件复制一份。
 * 优先级：NEXT_PUBLIC_API_URL → window.location.origin（非 localhost）→ http://localhost:3001
 */
function resolveBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && env.trim()) return env.trim();
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:3001";
    }
    return window.location.origin;
  }
  return "http://localhost:3001";
}
