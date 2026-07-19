/**
 * Workspace Layout — feat-200.5 Week 5
 *
 * 全屏 flex 布局：Sidebar (248px) + 主内容区。
 * AuthGuard：未登录自动跳 /login。
 * 首次 mount 拉项目列表。
 */

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { Sidebar } from "@/components/layout/Sidebar";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const { fetchProjects } = useProjectsStore();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;

    const check = () => {
      const t = useAuthStore.getState().token;
      if (!t) {
        router.replace("/login");
      } else {
        void fetchProjects();
      }
      checkedRef.current = true;
    };

    if (useAuthStore.persist.hasHydrated()) {
      check();
    } else {
      const unsub = useAuthStore.persist.onFinishHydration(() => {
        check();
        unsub();
      });
      return unsub;
    }
  }, [router, fetchProjects]);

  if (!token) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-sm" style={{ color: "var(--ink-3)" }}>加载中...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col md:flex-row" style={{ background: "var(--bg)" }}>
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
