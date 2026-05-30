/**
 * Agent 公共类型 — feat-300.3 任务 1
 *
 * AgentRunner / Controller / SSE 共用的输入输出 + 状态枚举。
 *
 * 为什么单独成文件：
 *   - controller / runner / repository 三处都引；放到 runner 里产生循环 import 风险
 *   - 类型独立后续 shared-types 包能轻松 re-export（如未来给前端共享）
 *
 * 与 schema.ts 的关系：
 *   schema.ts 是 DDL 字符串，agent.types.ts 是 TS 形态。两边的状态枚举值
 *   必须保持同步（schema CHECK + 这里的 union 同时改）。
 */

/**
 * ChatMessage 兼容 ai-sdk 的 CoreMessage 形态。
 *
 * 之所以自己定义而不是 `import type { CoreMessage } from 'ai'`：
 *   - 我们需要在 controller / 前端 / 持久化层流转这个类型，使用 ai-sdk 的
 *     CoreMessage 会让前端被迫依赖 ai-sdk
 *   - 简化字段：本 MVP 不支持 multi-modal content blocks（image / file），
 *     只允许 string content
 *   - 转换层在 AgentRunner 入口：ChatMessage[] → CoreMessage[]
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * AgentRunInput — 启动一个 agent run 的全部入参。
 *
 * 来源：
 *   - projectId / userId：controller 从 URL + JWT 抽
 *   - messages：POST body
 *   - budgetUsd / maxSteps / modelOverride：可选，未传则用项目默认（feat-300.3 plan §2）
 */
export interface AgentRunInput {
  projectId: string;
  userId: string;
  messages: ChatMessage[];
  /** 美元预算上限，默认 0.20，可 per-run 覆盖 */
  budgetUsd?: number;
  /** ReAct 步数上限，默认 12 */
  maxSteps?: number;
  /** 强制覆盖项目默认 model（用于 admin 调试 / A/B） */
  modelOverride?: string;
}

/**
 * AgentRunOutput — run 完成后的同步返回（POST /agent/run 体内）。
 *
 * SSE 流的最终 finish 事件包含同样的字段，可让前端在 SSE 断线时通过 GET /runs/:id
 * 回填同一份信息（保证两条路径数据一致）。
 */
export interface AgentRunOutput {
  runId: string;
  /** 关联的 generations 行 id；前端"生成历史"里点这条会展开 trace */
  generationId: string;
  /** 最终给用户的文本——可能是 LLM 自然结束的输出，也可能是 fallback 拼的 chunks */
  text: string;
  finishReason: AgentFinishReason;
  costUsedUsd: number;
  stepsUsed: number;
}

/**
 * agent_runs.status 三态。
 * 注意：'running' 不在 controller 同步返回里出现——它只是中间态，
 * GET /agent/runs/:id 在 run 还在跑时会返回。
 */
export type AgentRunStatus = "running" | "succeeded" | "failed";

/**
 * agent_runs.finish_reason 四态（task 4 会扩展加 'aborted'）。
 *
 *   - 'done'      LLM 自主收尾（result.finishReason === 'stop'）
 *   - 'max_steps' 步数耗尽（ai-sdk finishReason === 'length' or 'tool-calls' at maxSteps）
 *   - 'budget'    成本闸门触发（CostTracker.over 抛 BudgetExceededError）
 *   - 'aborted'   用户调 DELETE 端点中断（AbortController）
 *   - 'error'    其他异常导致 run 失败（status='failed' 时填）
 */
export type AgentFinishReason = "done" | "max_steps" | "budget" | "aborted" | "error";

/**
 * SSE 帧类型——前端 EventSource 监听的事件名。
 *   - step      每步入库后推；payload 见 StepFramePayload
 *   - cost      每步累计成本变化时推
 *   - finish    run 结束（不论原因）
 *   - error     系统级异常（business error 在 step.output 里）
 *
 * 心跳帧不是 event 类型，是 SSE comment（: heartbeat\n\n），客户端不触发回调。
 */
export type AgentSseEventType = "step" | "cost" | "finish" | "error";

/**
 * SSE step 帧 payload，对应 agent_steps 一行 + 额外的 toolCallId（前端关联用）。
 */
export interface StepFramePayload {
  runId: string;
  stepIndex: number;
  stepType: "reasoning" | "tool_call" | "tool_result" | "finish" | "context_compress";
  toolName?: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  /** prompt 版本号入 trace（feat-300.3 任务 0：PromptDefinition.version 写入这里） */
  promptIds?: string[];
  promptVersions?: string[];
}

/**
 * SSE cost 帧 payload——budget 仪表盘更新。
 */
export interface CostFramePayload {
  runId: string;
  /** 截至当前累计使用美元 */
  usedUsd: number;
  /** budget 百分比 0-100，可超过 100（超后立刻触发 finish）*/
  percentBudget: number;
  /** 触发本次更新的 step 索引 */
  stepIndex: number;
}

/**
 * SSE finish 帧 payload——含同步 GET /agent/runs/:id 也能拿到的同样字段。
 */
export interface FinishFramePayload extends AgentRunOutput {
  status: AgentRunStatus;
}

/**
 * SSE error 帧 payload——经脱敏（feat-300.3 plan §3.8）。
 */
export interface ErrorFramePayload {
  runId: string;
  /** 错误类型代码：业务可识别（'budget_exceeded' / 'abort' / 'validation' / 'internal'） */
  code: string;
  /** 用户可见的错误消息（已脱敏） */
  message: string;
  /** 内部 log correlation id，用户反馈时报这个查后端日志 */
  eventId?: string;
}
