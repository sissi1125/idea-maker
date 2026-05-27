/**
 * Providers — feat-200.5 Week 5
 *
 * 客户端 wrapper：
 *   1. 注入 tokenGetter（让 apiFetch 能读 zustand 里的 JWT）
 *   2. 首次 mount 时 refreshUser（hydrate + 验证 token）
 *
 * 为什么抽成独立组件而不放 layout.tsx：
 *   layout.tsx 是 Server Component，不能用 "use client"；
 *   Provider 需要 useEffect + store 交互，必须是 Client Component。
 */

"use client";

import { useEffect, useRef } from "react";
import { setTokenGetter } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 注入 token getter：apiFetch 在每次请求时调此函数读 token
    setTokenGetter(() => useAuthStore.getState().token);

    // hydrate 后尝试刷新 user（验证 token 是否还有效）
    void useAuthStore.getState().refreshUser();
  }, []);

  return <>{children}</>;
}
