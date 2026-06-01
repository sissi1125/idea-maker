/**
 * useEventSourceWithReplay — feat-300.6 任务 1
 *
 * 一个稳健的 SSE 订阅 hook：
 *   1. 启动时立即 connectSSE + 并行调 fetchHistory 拿"已经发生"的事件做回放
 *   2. 用调用方提供的 getEntryKey 函数把 history + SSE 流统一去重合并
 *   3. 45s watchdog：长时间无任何事件（包括 SSE comment 心跳）→ 视为代理切断 → 自动关连接 + 重新 fetchHistory + 重连
 *   4. unmount cleanup：关 EventSource、清 watchdog timer
 *
 * 为什么自己实现而不用第三方库（如 use-eventsource）：
 *   - 第三方包都不处理"重连后丢历史"问题（plan §3.3）
 *   - 项目零额外前端依赖原则
 *   - 测试上可直接 mock global EventSource，hook 内逻辑独立可测
 *
 * **泛型 T**：调用方决定 entries 元素的形态。
 *   - 对 agent run：T = StepFramePayload，key = stepIndex
 *   - 未来 ingestion：T = StageFramePayload，key = stageId
 *
 * **为什么是 Map 而不是数组**：
 *   stepIndex 重复时直接 set 覆盖，自然幂等；要拿有序列表时 Array.from(map.values()).sort(by stepIndex)。
 *   如果用数组 + findIndex 去重，复杂度从 O(1) 退化 O(n²)。
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type SseStatus =
  | "idle"           // 未启动
  | "connecting"     // 连接中
  | "open"           // SSE 已建立
  | "reconnecting"   // watchdog 触发重连
  | "closed";        // 终态（finish 帧 / 主动关 / 不可恢复错误）

export interface UseEventSourceWithReplayOptions<T> {
  /** 是否启用 hook（runId 还没拿到时传 false 不启动） */
  enabled: boolean;
  /** 调 connectAgentSSE 等返回 EventSource 实例 */
  connect: () => EventSource;
  /** 调 getSteps 等返回历史事件数组，用于初次回放 + 重连补齐 */
  fetchHistory: () => Promise<T[]>;
  /** 把后端 SSE 帧反序列化成 T（默认 JSON.parse + 直接 cast） */
  parseEvent?: (raw: MessageEvent) => T | null;
  /**
   * 取 entry 的唯一 key（用于去重）。
   * 对 agent run，传 entry => entry.stepIndex。
   * 注意：history 元素和 SSE event 必须用同一个 key 函数，否则去重失效。
   */
  getEntryKey: (entry: T) => number | string;
  /**
   * SSE event 类型 → 是否进入 entries Map。
   * 默认只收"step"事件；其他事件类型（cost / finish / error）调用方自己监听 onAux。
   */
  isEntryEvent?: (eventType: string) => boolean;
  /**
   * 副路事件（cost / finish / error 等）回调。
   * 调用方用来更新状态机，不进 entries。
   */
  onAux?: (event: MessageEvent) => void;
  /** finish 帧到达时调，回调内调用方可置 closed */
  onFinish?: (event: MessageEvent) => void;
  /** 无任何事件超时（含 SSE comment），ms，默认 45000 */
  watchdogTimeoutMs?: number;
  /** 最大自动重连次数；超过则置 closed 不再尝试，默认 3 */
  maxReconnects?: number;
}

export interface UseEventSourceWithReplayResult<T> {
  /** 去重后的 entries（按 key 索引）；调用方按 key 排序拿数组 */
  entries: Map<string | number, T>;
  /** 当前连接状态 */
  status: SseStatus;
  /** 主动重连（用户点"重试"按钮时） */
  reconnect: () => void;
  /** 主动关闭（提前结束） */
  close: () => void;
  /** 自动重连次数已用 */
  reconnectAttempts: number;
}

export function useEventSourceWithReplay<T>(
  opts: UseEventSourceWithReplayOptions<T>,
): UseEventSourceWithReplayResult<T> {
  const {
    enabled,
    connect,
    fetchHistory,
    parseEvent = (e: MessageEvent) => safeJsonParse<T>(e.data),
    getEntryKey,
    isEntryEvent = (t) => t === "step" || t === "message",
    onAux,
    onFinish,
    watchdogTimeoutMs = 45_000,
    maxReconnects = 3,
  } = opts;

  // 用 useState + 函数式更新让 React 感知，但内部修改用 ref 做防抖
  const [entries, setEntries] = useState<Map<string | number, T>>(new Map());
  const [status, setStatus] = useState<SseStatus>("idle");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // mutable refs：避免每次重新订阅
  const esRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true); // unmount 后置 false，防止 fetchHistory 回调时 setState
  // doReconnect 的 ref：解决 resetWatchdog 在 doReconnect 定义之前需要引用的 TDZ
  const doReconnectRef = useRef<() => void>(() => undefined);
  /**
   * 终态标记 —— 收到 finish 帧后置 true，永久禁止重连（feat-300.6 修复 reconnect loop）。
   *
   * 历史 bug：原版 onerror 用 `esRef.current?.readyState !== CLOSED` 判定是否要重连，
   * 但 closeStream 把 esRef.current 设为 null，optional-chain 返回 undefined → !== CLOSED →
   * 触发 doReconnect。NestJS @Sse 在 Observable complete 时关流 → 浏览器 onerror →
   * 我们误判为「异常断开」→ 又连一次 → 又收到回放的 finish → 又关 → 死循环。
   *
   * 现在用显式 finishedRef，语义清晰：一旦业务说"完了"（finish/error 帧），任何 onerror
   * 都视为正常 cleanup 不再重连。
   */
  const finishedRef = useRef(false);

  const resetWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      // 45s 无任何事件（onmessage / onerror / SSE comment 浏览器都不暴露）→ 强制重连
      if (aliveRef.current) doReconnectRef.current();
    }, watchdogTimeoutMs);
  }, [watchdogTimeoutMs]);

  const mergeHistory = useCallback(
    (history: T[]) => {
      if (!aliveRef.current) return;
      setEntries((prev) => {
        const next = new Map(prev);
        for (const h of history) {
          next.set(getEntryKey(h), h);
        }
        return next;
      });
    },
    [getEntryKey],
  );

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const doConnect = useCallback(() => {
    if (!aliveRef.current) return;
    setStatus("connecting");
    closeStream();
    const es = connect();
    esRef.current = es;

    es.onopen = () => {
      if (!aliveRef.current) return;
      setStatus("open");
      resetWatchdog();
    };

    // 默认 onmessage 处理"无 event 字段"的帧；后端用 @Sse 时帧带 event 字段，需 addEventListener
    const handleAny = (raw: MessageEvent, eventType: string) => {
      if (!aliveRef.current) return;
      resetWatchdog();
      if (isEntryEvent(eventType)) {
        const parsed = parseEvent(raw);
        if (parsed) {
          setEntries((prev) => {
            const next = new Map(prev);
            next.set(getEntryKey(parsed), parsed);
            return next;
          });
        }
      } else {
        onAux?.(raw);
        if (eventType === "finish" || eventType === "error") {
          // 收到终态帧：标记 finishedRef → 之后 browser 触发的 onerror 不再尝试重连
          finishedRef.current = true;
          if (eventType === "finish") onFinish?.(raw);
          setStatus("closed");
          closeStream();
        }
      }
    };

    es.onmessage = (e) => handleAny(e, "message");
    // 后端 @Sse 帧类型：step / cost / finish / error
    for (const t of ["step", "cost", "finish", "error"]) {
      es.addEventListener(t, (e) => handleAny(e as MessageEvent, t));
    }

    es.onerror = () => {
      if (!aliveRef.current) return;
      // 业务终态（finish / error 帧）已经收到 → close() 引发的 onerror 是预期，不重连
      if (finishedRef.current) return;
      // Stale 闭包：esRef 已经被替换或清空 → 这个 onerror 属于旧连接，忽略
      if (esRef.current !== es) return;
      // 真正的异常断开 → 走 doReconnect（fetchHistory + 新 EventSource）
      doReconnectRef.current();
    };
  }, [connect, parseEvent, getEntryKey, isEntryEvent, onAux, onFinish, resetWatchdog, closeStream]);

  const doReconnect = useCallback(() => {
    if (!aliveRef.current) return;
    // 终态防御：业务已经收到 finish/error 帧后绝不重连（即使有 race 把这里调进来）
    if (finishedRef.current) return;
    setReconnectAttempts((n) => {
      if (n >= maxReconnects) {
        setStatus("closed");
        closeStream();
        return n;
      }
      setStatus("reconnecting");
      closeStream();
      // 先拉历史补齐，再重连
      fetchHistory()
        .then(mergeHistory)
        .catch(() => undefined)
        .finally(() => {
          if (aliveRef.current) doConnect();
        });
      return n + 1;
    });
  }, [maxReconnects, fetchHistory, mergeHistory, closeStream, doConnect]);

  // 把最新 doReconnect 同步给 ref，给 resetWatchdog / onerror 闭包用
  // 必须在 useEffect 里更新 ref（不能渲染期赋值，eslint 规则 react-hooks/refs）
  useEffect(() => {
    doReconnectRef.current = doReconnect;
  }, [doReconnect]);

  /**
   * Ref 隔离：把会随 render 变化但语义稳定的 helpers（doConnect / mergeHistory /
   * closeStream）放进 ref，让启动 effect 的依赖**只剩"连什么"**而不是"怎么连"。
   *
   * 这是 feat-300.6 第五个真实 bug 的根因 + 修复：
   *   原 deps：[enabled, connect, fetchHistory, mergeHistory, closeStream, doConnect]
   *   doConnect 依赖 parseEvent/getEntryKey/isEntryEvent/onAux/onFinish 等 callback；
   *   useAgentRun 调用本 hook 时把 getEntryKey/isEntryEvent 写成**箭头字面量** →
   *   每次 render 都是新函数 → doConnect useCallback 每 render 都重算 → useEffect
   *   每 render 都 re-run → 每次都关旧 SSE 开新 SSE + reset finishedRef → 无限循环。
   *
   * 教训：**useEffect 的 deps 是"该不该重启效果"的语义，不是"避免闭包陷阱"的句法**。
   * 当一个东西"身份变了但行为没变"时，应该放 ref，不应该放 deps。
   */
  const doConnectRef = useRef(doConnect);
  const mergeHistoryRef = useRef(mergeHistory);
  const closeStreamRef = useRef(closeStream);
  useEffect(() => {
    doConnectRef.current = doConnect;
    mergeHistoryRef.current = mergeHistory;
    closeStreamRef.current = closeStream;
  }); // 每次 render 后同步（不放 deps，无 stale 风险）

  // 启动 effect：**只依赖**真正决定"连不连 / 连哪里"的输入：
  //   - enabled：要不要连
  //   - connect：连哪个 EventSource（runId/token 变会换新 connect）
  //   - fetchHistory：拉哪段历史（同理）
  // doConnect / mergeHistory / closeStream 用 ref 读最新值，不进 deps，避免假重启。
  useEffect(() => {
    aliveRef.current = true;
    // 重置终态：新 run 开始时（runId 变 → connect/fetchHistory 引用变 → effect re-run）
    // 必须把上次 run 的 "finished" 状态清掉，否则新 run 的 onerror 会被误认为"已完成"
    finishedRef.current = false;
    if (!enabled) {
      return () => {
        aliveRef.current = false;
        closeStreamRef.current();
      };
    }

    fetchHistory()
      .then((h) => mergeHistoryRef.current(h))
      .catch(() => undefined)
      .finally(() => {
        if (aliveRef.current) doConnectRef.current();
      });

    return () => {
      aliveRef.current = false;
      closeStreamRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connect, fetchHistory]);

  const reconnect = useCallback(() => {
    // 用户主动重连：清掉终态标记，否则 onerror 会立刻被吞掉无法触发新一轮 doReconnect
    finishedRef.current = false;
    setReconnectAttempts(0);
    doReconnect();
  }, [doReconnect]);

  const close = useCallback(() => {
    setStatus("closed");
    closeStream();
  }, [closeStream]);

  return { entries, status, reconnect, close, reconnectAttempts };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
