/**
 * ToastProvider — feat-200.8.2
 *
 * 全局 toast 容器：右下角浮动、auto-dismiss、4 种 variant。
 *
 * 设计取舍：
 *   - 不引入 react-hot-toast / sonner 等三方库，自写约 100 行——
 *     依赖最少，样式与项目色板完全统一
 *   - useToast() hook 走 Context；非组件场景（API client 错误）也能通过 setToastHandler 注册
 *   - auto-dismiss 默认 4s；error variant 6s（看清楚再消失）；可手动 X 关闭
 *   - 同时最多 4 条；超出按 FIFO 挤掉最旧的
 *   - 写入新 toast 走 reducer 而非 setState 数组——避免快速连续推送时丢消息
 *
 * 调用方式：
 *   const toast = useToast();
 *   toast.error("操作失败");
 *   toast.success("已保存");
 *   toast.info("提示信息");
 *   toast.warn("即将到期");
 */

"use client";

import {
  createContext, useCallback, useContext, useEffect, useReducer, useRef,
} from "react";
import { Check, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "warn" | "info";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  /** 自动消失毫秒数。null = 不自动消失，需手动 X 关闭 */
  duration: number | null;
}

interface ToastApi {
  push: (variant: ToastVariant, message: string, duration?: number | null) => void;
  success: (message: string, duration?: number | null) => void;
  error: (message: string, duration?: number | null) => void;
  warn: (message: string, duration?: number | null) => void;
  info: (message: string, duration?: number | null) => void;
}

// ── reducer 状态 ────────────────────────────────────────────────────────────

const MAX_VISIBLE = 4;

type Action =
  | { type: "push"; item: ToastItem }
  | { type: "dismiss"; id: string };

function reducer(state: ToastItem[], action: Action): ToastItem[] {
  switch (action.type) {
    case "push": {
      const next = [...state, action.item];
      // 超 MAX_VISIBLE 砍掉最早的
      if (next.length > MAX_VISIBLE) return next.slice(-MAX_VISIBLE);
      return next;
    }
    case "dismiss":
      return state.filter((t) => t.id !== action.id);
  }
}

// ── Context + module-level handler ────────────────────────────────────────

const ToastContext = createContext<ToastApi | null>(null);

/**
 * 非组件场景使用（如 apiFetch 全局错误捕获）：
 * import { setGlobalToastHandler } from "@/components/toast/ToastProvider";
 * setGlobalToastHandler((v, m) => ...);
 *
 * Provider 挂载时自动注册自身；卸载时清空。
 */
let globalHandler: ToastApi | null = null;
export function getGlobalToast(): ToastApi | null {
  return globalHandler;
}

// ── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);
  // 计数器生成唯一 id（不用 randomUUID 避免 server/client 不一致）
  const counterRef = useRef(0);

  const push = useCallback(
    (variant: ToastVariant, message: string, duration?: number | null) => {
      counterRef.current += 1;
      const id = `toast-${counterRef.current}`;
      const d =
        duration === undefined
          ? variant === "error" ? 6000 : 4000
          : duration;
      dispatch({ type: "push", item: { id, variant, message, duration: d } });
    },
    [],
  );

  const api: ToastApi = {
    push,
    success: (m, d) => push("success", m, d),
    error: (m, d) => push("error", m, d),
    warn: (m, d) => push("warn", m, d),
    info: (m, d) => push("info", m, d),
  };

  // 模块级 handler——非组件代码（apiFetch / store）能拿到
  useEffect(() => {
    globalHandler = api;
    return () => { globalHandler = null; };
    // 故意只在 mount/unmount 注册，api 是稳定引用（push 走 useCallback，其他都是该函数包裹）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={(id) => dispatch({ type: "dismiss", id })} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ── Viewport：渲染当前 toasts ────────────────────────────────────────────────

const VARIANT_STYLE: Record<ToastVariant, {
  bg: string; color: string; border: string; Icon: typeof Check;
}> = {
  success: {
    bg: "rgba(31,138,91,.95)", color: "#fff",
    border: "rgba(31,138,91,1)", Icon: Check,
  },
  error: {
    bg: "rgba(179,38,30,.95)", color: "#fff",
    border: "rgba(179,38,30,1)", Icon: AlertCircle,
  },
  warn: {
    bg: "rgba(201,89,29,.95)", color: "#fff",
    border: "rgba(201,89,29,1)", Icon: AlertTriangle,
  },
  info: {
    bg: "rgba(11,17,32,.92)", color: "#fff",
    border: "rgba(11,17,32,1)", Icon: Info,
  },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="fixed z-[60] flex flex-col gap-2 pointer-events-none"
      style={{ right: "20px", bottom: "20px", maxWidth: "360px" }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  const style = VARIANT_STYLE[toast.variant];
  const Icon = style.Icon;

  useEffect(() => {
    if (toast.duration == null) return;
    const timer = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  return (
    <div
      className="rounded-lg shadow-lg pointer-events-auto flex items-start gap-2.5 fade-up"
      style={{
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        padding: "10px 12px",
        boxShadow: "0 12px 28px rgba(11,17,32,.18), 0 4px 10px rgba(11,17,32,.08)",
        backdropFilter: "blur(6px)",
      }}
    >
      <Icon size={14} strokeWidth={2} className="flex-none mt-[2px]" />
      <div className="flex-1 text-[13px] leading-[1.55]">{toast.message}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="flex-none opacity-70 hover:opacity-100"
        style={{ color: style.color }}
        aria-label="关闭通知"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
