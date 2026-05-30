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
import { Observable, filter, fromEvent, interval, map, merge, takeWhile } from "rxjs";
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

@Injectable()
export class AgentSseService {
  private readonly logger = new Logger(AgentSseService.name);

  constructor(private readonly eventBus: EventEmitter2) {}

  /** AgentRunner 每步入库后调一次 */
  emitStep(payload: StepFramePayload): void {
    this.eventBus.emit(AGENT_EVENT.step, payload);
  }

  /** 累计成本变更后调，给前端 budget 仪表盘 */
  emitCost(payload: CostFramePayload): void {
    this.eventBus.emit(AGENT_EVENT.cost, payload);
  }

  /** Run 结束（success / budget / max_steps / aborted）后调一次 */
  emitFinish(payload: FinishFramePayload): void {
    this.eventBus.emit(AGENT_EVENT.finish, payload);
  }

  /** 系统异常或 abort 时调 */
  emitError(payload: ErrorFramePayload): void {
    this.eventBus.emit(AGENT_EVENT.error, payload);
  }

  /**
   * Controller 订阅入口。
   *
   * 给定 runId 返回一个 Observable<AgentSseFrame>：
   *   - 过滤事件总线上仅属于该 runId 的事件
   *   - 加 15s 心跳保活
   *   - 收到 finish / error 后 takeWhile inclusive 停止订阅，释放资源
   */
  subscribe(runId: string): Observable<AgentSseFrame> {
    const matchesRun = (e: { runId: string }) => e.runId === runId;

    const step$ = fromEvent<StepFramePayload>(this.eventBus, AGENT_EVENT.step).pipe(
      filter(matchesRun),
      map<StepFramePayload, AgentSseFrame>((data) => ({ type: "step", data })),
    );

    const cost$ = fromEvent<CostFramePayload>(this.eventBus, AGENT_EVENT.cost).pipe(
      filter(matchesRun),
      map<CostFramePayload, AgentSseFrame>((data) => ({ type: "cost", data })),
    );

    const finish$ = fromEvent<FinishFramePayload>(this.eventBus, AGENT_EVENT.finish).pipe(
      filter(matchesRun),
      map<FinishFramePayload, AgentSseFrame>((data) => ({ type: "finish", data })),
    );

    const error$ = fromEvent<ErrorFramePayload>(this.eventBus, AGENT_EVENT.error).pipe(
      filter(matchesRun),
      map<ErrorFramePayload, AgentSseFrame>((data) => ({ type: "error", data })),
    );

    const keepalive$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map<number, AgentSseFrame>(() => ({ type: "keepalive", data: { ts: Date.now() } })),
    );

    // takeWhile inclusive=true：finish/error 帧发出去之后再关流，让客户端能收到
    return merge(step$, cost$, finish$, error$, keepalive$).pipe(
      takeWhile((f) => f.type !== "finish" && f.type !== "error", true),
    );
  }
}
