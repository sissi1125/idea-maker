/**
 * Sidebar — feat-200.5 Week 5
 *
 * 从原型 Sidebar.jsx 迁移：品牌标志 + 项目切换器 + 导航 + 底部用户区。
 * 对接 useProjectsStore + useAuthStore。
 *
 * 导航项说明：
 *   - 对话 / 知识库 / 内容资产 / 项目设置 → Week 6-7 实现页面
 *   - 所有项目 → /projects 列表页（Week 5 已有）
 *   - 底部成本 → 从 project.totalCostUsd 读
 */

"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  MessageSquare, Upload, Clock, Settings,
  Folder, ChevronDown, Check, DollarSign, LogOut,
} from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useProjectsStore } from "@/lib/stores/projects-store";

const NAV_ITEMS = [
  { id: "chat",     label: "对话",     icon: MessageSquare, path: "" },
  { id: "knowledge",label: "知识库",   icon: Upload,        path: "/knowledge" },
  { id: "history",  label: "内容资产", icon: Clock,         path: "/history" },
  { id: "settings", label: "项目设置", icon: Settings,      path: "/settings" },
] as const;

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const {
    projects,
    currentProjectId,
    setCurrentProject,
    currentProject: getCurrentProject,
  } = useProjectsStore();
  const project = getCurrentProject();

  const [showSwitcher, setShowSwitcher] = useState(false);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const handleNavClick = (path: string) => {
    if (!currentProjectId) return;
    router.push(`/projects/${currentProjectId}${path}`);
  };

  const handleSwitchProject = (id: string) => {
    setCurrentProject(id);
    setShowSwitcher(false);
    router.push(`/projects/${id}`);
  };

  const isActive = (itemPath: string) => {
    if (!currentProjectId) return false;
    const full = `/projects/${currentProjectId}${itemPath}`;
    if (itemPath === "") {
      // "对话" active when exactly on /projects/:id
      return pathname === full;
    }
    return pathname.startsWith(full);
  };

  const initials = user?.displayName
    ? user.displayName.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? "?";

  return (
    <aside
      className="flex flex-col h-full flex-none"
      style={{
        width: 248,
        background: "var(--bg-rail)",
        color: "var(--ink)",
        borderRight: "1px solid var(--line-strong)",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-[18px] pt-[18px] pb-3.5">
        <div
          className="w-[30px] h-[30px] rounded-lg flex items-center justify-center font-bold text-white text-sm"
          style={{
            background: "linear-gradient(135deg, #6BBFAF 0%, #3D8C7F 100%)",
            boxShadow: "0 0 0 1px rgba(255,255,255,.4) inset, 0 4px 10px rgba(79,168,154,.28)",
          }}
        >
          H
        </div>
        <div>
          <div className="font-semibold text-[15px] tracking-tight" style={{ color: "var(--ink)" }}>
            Harness
          </div>
          <div className="text-[10.5px]" style={{ color: "var(--ink-3)" }}>
            透明 · 可观测 · 懂你的 Agent
          </div>
        </div>
      </div>

      {/* Project switcher */}
      <div className="relative mx-3 mb-3.5">
        <button
          onClick={() => setShowSwitcher(!showSwitcher)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] bg-white text-left"
          style={{
            border: "1px solid var(--line)",
            boxShadow: "0 1px 2px rgba(31,45,52,.03)",
          }}
        >
          <div
            className="w-7 h-7 rounded-[7px] flex items-center justify-center text-sm"
            style={{ background: "var(--brand-soft)" }}
          >
            {project?.emoji ?? "📂"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-semibold truncate" style={{ color: "var(--ink)" }}>
              {project?.name ?? "选择项目"}
            </div>
            <div className="text-[10.5px]" style={{ color: "var(--ink-3)" }}>
              {project ? `${project.docsCount} 文档` : "暂无项目"}
            </div>
          </div>
          <ChevronDown size={14} strokeWidth={1.8} style={{ color: "var(--ink-3)" }} />
        </button>

        {/* Dropdown */}
        {showSwitcher && (
          <div
            className="absolute left-0 top-full mt-1 w-full z-20 rounded-[10px] p-1.5"
            style={{
              background: "#fff",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <div
              className="px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--ink-4)" }}
            >
              切换项目
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSwitchProject(p.id)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[12.5px] text-left transition-colors"
                style={{
                  background: p.id === currentProjectId ? "var(--brand-soft)" : "transparent",
                  color: p.id === currentProjectId ? "var(--brand-ink)" : "var(--ink)",
                }}
              >
                <span className="w-[22px] h-[22px] rounded-[5px] flex items-center justify-center text-xs"
                  style={{ background: "var(--bg)" }}>
                  {p.emoji ?? "📂"}
                </span>
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === currentProjectId && <Check size={13} strokeWidth={2} style={{ color: "var(--brand)" }} />}
              </button>
            ))}
            <button
              onClick={() => { setShowSwitcher(false); router.push("/projects"); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs mt-1 transition-colors"
              style={{ color: "var(--ink-3)", borderTop: "1px solid var(--line-2)" }}
            >
              <Folder size={13} /> 管理所有项目
            </button>
          </div>
        )}
      </div>

      {/* Nav: current project */}
      <div className="px-[18px] pt-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--ink-4)" }}>
        当前项目
      </div>
      <div className="flex flex-col gap-0.5 px-2.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.path)}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors text-left"
              style={{
                fontWeight: active ? 600 : 500,
                color: active ? "var(--brand-ink)" : "var(--ink-2)",
                background: active ? "var(--brand-soft)" : "transparent",
                border: active ? "1px solid rgba(79,168,154,.22)" : "1px solid transparent",
              }}
            >
              <Icon size={16} className="opacity-85" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Nav: workspace */}
      <div className="px-[18px] pt-3.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--ink-4)" }}>
        工作区
      </div>
      <div className="px-2.5">
        <button
          onClick={() => router.push("/projects")}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors text-left"
          style={{
            fontWeight: pathname === "/projects" ? 600 : 500,
            color: pathname === "/projects" ? "var(--brand-ink)" : "var(--ink-2)",
            background: pathname === "/projects" ? "var(--brand-soft)" : "transparent",
            border: pathname === "/projects" ? "1px solid rgba(79,168,154,.22)" : "1px solid transparent",
          }}
        >
          <Folder size={16} className="opacity-85" />
          所有项目
          <span
            className="ml-auto text-[10.5px] font-semibold rounded-full px-1.5 h-[18px] flex items-center justify-center"
            style={{ background: "rgba(31,45,52,.06)", color: "var(--ink-3)" }}
          >
            {projects.length}
          </span>
        </button>
      </div>

      {/* Footer */}
      <div className="mt-auto px-3 pb-3.5 pt-2.5" style={{ borderTop: "1px solid var(--line)" }}>
        {/* Cost row */}
        {project && (
          <div
            className="flex items-center justify-between px-2.5 py-2 rounded-lg text-[11.5px] mb-2.5"
            style={{
              background: "var(--brand-soft)",
              border: "1px solid rgba(79,168,154,.2)",
              color: "var(--brand-ink)",
            }}
          >
            <span className="flex items-center gap-1.5">
              <DollarSign size={12} strokeWidth={2} /> 总成本
            </span>
            <span className="mono font-bold">${project.totalCostUsd.toFixed(2)}</span>
          </div>
        )}

        {/* User */}
        <div
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white"
          style={{ border: "1px solid var(--line)" }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-xs"
            style={{ background: "linear-gradient(135deg, #F0B86E, #DA8A4A)" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-semibold truncate" style={{ color: "var(--ink)" }}>
              {user?.displayName ?? user?.email ?? "—"}
            </div>
            <div className="text-[10.5px]" style={{ color: "var(--ink-3)" }}>
              {user?.email ?? ""}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="opacity-50 hover:opacity-100 transition-opacity"
            title="退出登录"
          >
            <LogOut size={14} style={{ color: "var(--ink-3)" }} />
          </button>
        </div>
      </div>
    </aside>
  );
}
