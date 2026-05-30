/**
 * AgentSseService 单测：
 *  - emit 走 EventEmitter2
 *  - subscribe 按 runId 过滤
 *  - finish / error 关流
 *  - 心跳定时（fakeTimers）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { firstValueFrom, take, toArray } from "rxjs";
import { AgentSseService, AGENT_EVENT, HEARTBEAT_INTERVAL_MS } from "../agent-sse.service";

describe("AgentSseService.emit*", () => {
  let bus: EventEmitter2;
  let svc: AgentSseService;

  beforeEach(() => {
    bus = new EventEmitter2();
    svc = new AgentSseService(bus);
  });

  it("emitStep 触发 agent.step 事件", () => {
    const handler = vi.fn();
    bus.on(AGENT_EVENT.step, handler);
    svc.emitStep({
      runId: "r-1",
      stepIndex: 0,
      stepType: "reasoning",
    });
    expect(handler).toHaveBeenCalledWith({
      runId: "r-1",
      stepIndex: 0,
      stepType: "reasoning",
    });
  });

  it("emitCost / emitFinish / emitError 各自触发独立事件名", () => {
    const cost = vi.fn();
    const finish = vi.fn();
    const error = vi.fn();
    bus.on(AGENT_EVENT.cost, cost);
    bus.on(AGENT_EVENT.finish, finish);
    bus.on(AGENT_EVENT.error, error);

    svc.emitCost({ runId: "r", usedUsd: 0.01, percentBudget: 5, stepIndex: 1 });
    svc.emitFinish({
      runId: "r",
      generationId: "g",
      text: "ok",
      finishReason: "done",
      costUsedUsd: 0.01,
      stepsUsed: 3,
      status: "succeeded",
    });
    svc.emitError({ runId: "r", code: "internal", message: "x" });

    expect(cost).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("AgentSseService.subscribe", () => {
  let bus: EventEmitter2;
  let svc: AgentSseService;

  beforeEach(() => {
    bus = new EventEmitter2();
    svc = new AgentSseService(bus);
  });
  afterEach(() => vi.useRealTimers());

  it("过滤 runId：不属于本 run 的事件被丢弃", async () => {
    const frames$ = svc.subscribe("r-1");
    const collect = firstValueFrom(frames$.pipe(take(1), toArray()));

    // 不同 runId 的事件应被过滤
    svc.emitStep({ runId: "r-other", stepIndex: 0, stepType: "reasoning" });
    // 命中本 run 的事件
    svc.emitStep({ runId: "r-1", stepIndex: 0, stepType: "reasoning" });

    const frames = await collect;
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe("step");
    expect((frames[0].data as { runId: string }).runId).toBe("r-1");
  });

  it("finish 帧到达后 takeWhile inclusive 关流", async () => {
    const frames$ = svc.subscribe("r-1");
    const collect = firstValueFrom(frames$.pipe(toArray()));

    svc.emitStep({ runId: "r-1", stepIndex: 0, stepType: "reasoning" });
    svc.emitFinish({
      runId: "r-1",
      generationId: "g",
      text: "ok",
      finishReason: "done",
      costUsedUsd: 0.01,
      stepsUsed: 1,
      status: "succeeded",
    });

    // 再发 step 应该不被收到（流已关）
    svc.emitStep({ runId: "r-1", stepIndex: 1, stepType: "reasoning" });

    const frames = await collect;
    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe("step");
    expect(frames[1].type).toBe("finish");
  });

  it("error 帧也关流（与 finish 同理）", async () => {
    const frames$ = svc.subscribe("r-1");
    const collect = firstValueFrom(frames$.pipe(toArray()));

    svc.emitError({ runId: "r-1", code: "abort", message: "abort" });
    // 再发 step 不收
    svc.emitStep({ runId: "r-1", stepIndex: 0, stepType: "reasoning" });

    const frames = await collect;
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe("error");
  });

  it("心跳间隔 15s 触发 keepalive", async () => {
    vi.useFakeTimers();
    const frames$ = svc.subscribe("r-1");
    const collect = firstValueFrom(frames$.pipe(take(2), toArray()));

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    const frames = await collect;
    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe("keepalive");
    expect(frames[1].type).toBe("keepalive");
  });

  it("HEARTBEAT_INTERVAL_MS 必须 < 反向代理默认 60s", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(60_000);
  });
});
