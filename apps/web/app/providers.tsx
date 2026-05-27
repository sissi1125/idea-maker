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

  // ⚠️ 同步注入 token getter（不能放 useEffect！）
  // React effect 执行顺序是 child → parent（bottom-up），
  // 如果放 useEffect，子组件 WorkspaceLayout 的 fetchProjects() 会先执行，
  // 此时 tokenGetter 还是 null → 401 Unauthorized。
  // 同步调用确保在任何子组件 effect 之前就已注入。
  setTokenGetter(() => useAuthStore.getState().token);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // hydrate 后尝试刷新 user（验证 token 是否还有效）
    void useAuthStore.getState().refreshUser();
  }, []);

  return <>{children}</>;
}
