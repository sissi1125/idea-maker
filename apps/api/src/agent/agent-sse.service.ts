/**
 * AgentSseService — feat-300.3 任务 5
 *
 * 把 AgentRunner 发出的事件通过 EventEmitter2 桥接到 SSE Observable，供
 * AgentController 的 @Sse 端点订阅。
 *
 * 设计参考：apps/api/src/ingestion/ingestion.controller.ts 的实现模式。
 * 沿用同样的"事件总线 + per-id 过滤 + RxJS merge + 心跳保活"路子，避免在
 * 项目里制造第二套 SSE 范式。
 *
 * **心跳实现**（feat-300.3 plan §3.2）：
 *   每 15s 发一个 keepalive 事件。客户端可以选择忽略；反向代理（Cloudflare
 *   100s / Nginx 60s / Fly 60s）看到"有数据流过"就不会切断连接。
 *   纯 SSE comment（"`: heartbeat\n\n`"）需要 NestJS @Sse 不支持的低层 API；
 *   退而求其次：定义 type='keepalive' 帧让客户端按需丢弃，效果等价。
 *
 * **事件分类**（与 agent.types.ts 的 AgentSseEventType 对齐）：
 *   step / cost / finish / error 四种业务事件 + keepalive 心跳。
 *
 * **emit / subscribe 解耦**：
 *   AgentRunner 调 emit；Controller 调 subscribe。两边不直接交互，由 EventBus
 *   中转。AgentRunner 不需要知道有几个客户端在听（也可以一个客户端断线后仍跑）。
 */

import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Observable, ReplaySubject, interval, map, merge, takeWhile } from "rxjs";
import type {
  CostFramePayload,
  ErrorFramePayload,
  FinishFramePayload,
  StepFramePayload,
} from "./agent.types";

/** 事件总线上的事件名常量，避免 magic string 散落 */
export const AGENT_EVENT = {
  step: "agent.step",
  cost: "agent.cost",
  finish: "agent.finish",
  error: "agent.error",
} as const;

/** SSE 帧形态：NestJS @Sse 期望 { type, data } */
export interface AgentSseFrame {
  type: "step" | "cost" | "finish" | "error" | "keepalive";
  data: unknown;
}

/** 心跳间隔（毫秒）—— 必须 < 反向代理超时（默认 60s） */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Buffer 保留时长：finish/error 后保留这么久供晚连的客户端回放，然后释放 */
const BUFFER_TTL_MS = 60_000;

@Injectable()
export class AgentSseService {
  private readonly logger = new Logger(AgentSseService.name);

  /**
   * Per-runId ReplaySubject 缓冲（feat-300.6 修复）。
   *
   * 历史 bug：原版用 `fromEvent(eventBus)` 订阅，是 fire-and-forget——
   * AgentRunner 在 SSE 订阅连上前发出的 step / cost 事件全部丢失。
   * Run 跑得快（~4s）+ POST→SSE 之间有 200ms 网络延迟 = 前几步看不到，
   * 浏览器 EventSource 长时间无数据 → onerror → 触发 watchdog 重连死循环。
   *
   * 现在：每个 runId 配一个 ReplaySubject（无上限缓冲）：
   *   - emit 时 next() 进缓冲
   *   - subscribe 时**先回放历史，再接收实时事件**——天然解决"早 emit 晚 subscribe"
   *   - finish/error 帧后 complete()，并在 BUFFER_TTL_MS 后清掉避免内存泄露
   *
   * 为什么 ReplaySubject 不是 BehaviorSubject：后者只缓最近一个值，不够；
   * 为什么不用 RxJS shareReplay：依赖上游 source observable，本场景没有上游。
   *
   * EventEmitter2 保留：未来可能有其他模块想监听 agent 事件（如自动 distill 触发），
   * 双路径互不干扰。
   */
  private readonly buffers = new Map<string, ReplaySubject<AgentSseFrame>>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly eventBus: EventEmitter2) {}

  /** 获取或创建该 runId 的 ReplaySubject */
  private getBuffer(runId: string): ReplaySubject<AgentSseFrame> {
    let buf = this.buffers.get(runId);
    if (!buf) {
      // 不限缓冲条数：一个 run 最多 12 步 × 几条帧 = 几十条，无需限制
      buf = new ReplaySubject<AgentSseFrame>();
      this.buffers.set(runId, buf);
    }
    return buf;
  }

  /** 释放某 runId 的缓冲（finish/error 后延时调） */
  private scheduleCleanup(runId: string): void {
    // 已经有 timer → 不重复
    if (this.cleanupTimers.has(runId)) return;
    const t = setTimeout(() => {
      this.buffers.get(runId)?.complete();
      this.buffers.delete(runId);
      this.cleanupTimers.delete(runId);
    }, BUFFER_TTL_MS);
    this.cleanupTimers.set(runId, t);
  }

  /** AgentRunner 每步入库后调一次 */
  emitStep(payload: StepFramePayload): void {
    this.getBuffer(payload.runId).next({ type: "step", data: payload });
    this.eventBus.emit(AGENT_EVENT.step, payload);
  }

  /** 累计成本变更后调，给前端 budget 仪表盘 */
  emitCost(payload: CostFramePayload): void {
    this.getBuffer(payload.runId).next({ type: "cost", data: payload });
    this.eventBus.emit(AGENT_EVENT.cost, payload);
  }

  /** Run 结束（success / budget / max_steps / aborted）后调一次 */
  emitFinish(payload: FinishFramePayload): void {
    const buf = this.getBuffer(payload.runId);
    buf.next({ type: "finish", data: payload });
    // 不 complete()——让 takeWhile 在订阅侧处理；缓冲保留 TTL 时间让晚连客户端回放
    this.eventBus.emit(AGENT_EVENT.finish, payload);
    this.scheduleCleanup(payload.runId);
  }

  /** 系统异常或 abort 时调 */
  emitError(payload: ErrorFramePayload): void {
    const buf = this.getBuffer(payload.runId);
    buf.next({ type: "error", data: payload });
    this.eventBus.emit(AGENT_EVENT.error, payload);
    this.scheduleCleanup(payload.runId);
  }

  /**
   * Controller 订阅入口。
   *
   * - ReplaySubject 自动回放历史 + 接收实时事件
   * - 与 15s 心跳合流
   * - takeWhile inclusive：finish/error 帧发完才关流，让客户端能收到最后一帧
   */
  subscribe(runId: string): Observable<AgentSseFrame> {
    const buffered$ = this.getBuffer(runId).asObservable();

    const keepalive$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map<number, AgentSseFrame>(() => ({ type: "keepalive", data: { ts: Date.now() } })),
    );

    return merge(buffered$, keepalive$).pipe(
      takeWhile((f) => f.type !== "finish" && f.type !== "error", true),
    );
  }
}
