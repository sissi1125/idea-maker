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
  MessageSquare, Library, Settings, LayoutDashboard,
  Folder, ChevronDown, Check, DollarSign, LogOut, BadgeCheck, PenLine, Menu, X,
} from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useProjectsStore } from "@/lib/stores/projects-store";

const NAV_ITEMS = [
  // feat-402：一级导航按用户任务组织，技术能力收进业务页面的二级入口。
  { id: "overview", label: "项目总览", icon: LayoutDashboard, path: "/overview" },
  { id: "knowledge",label: "资料库",   icon: Library,         path: "/knowledge" },
  { id: "brief",    label: "产品档案", icon: BadgeCheck,      path: "/brief" },
  { id: "campaign", label: "内容创作", icon: PenLine,         path: "/campaign" },
  { id: "chat",     label: "AI 对话",  icon: MessageSquare,  path: "" },
  { id: "assets",   label: "内容资产", icon: Folder,          path: "/assets" },
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
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const handleNavClick = (path: string) => {
    if (!currentProjectId) return;
    setShowMobileMenu(false);
    router.push(`/projects/${currentProjectId}${path}`);
  };

  const handleSwitchProject = (id: string) => {
    setCurrentProject(id);
    setShowSwitcher(false);
    router.push(`/projects/${id}/overview`);
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
    <>
    <aside
      className="hidden md:flex flex-col h-full flex-none"
      style={{
        width: 232,
        background: "var(--bg-rail)",
        color: "var(--ink)",
        borderRight: "1px solid var(--line)",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-[18px] pt-[18px] pb-3.5">
        <div
          className="w-[30px] h-[30px] rounded-[6px] flex items-center justify-center font-semibold text-white text-sm"
          style={{
            background: "var(--ink)",
          }}
        >
          I
        </div>
        <div>
          <div className="font-semibold text-[15px] tracking-tight" style={{ color: "var(--ink)" }}>
            IDEA-MAKER
          </div>
          <div className="text-[10.5px]" style={{ color: "var(--ink-3)" }}>
            可信营销内容伙伴
          </div>
        </div>
      </div>

      {/* Project switcher */}
      <div className="relative mx-3 mb-3.5">
        <button
          onClick={() => setShowSwitcher(!showSwitcher)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-[6px] bg-white text-left"
          style={{
            border: "1px solid var(--line)",
            boxShadow: "none",
          }}
        >
          <div className="w-7 h-7 rounded-[6px] flex items-center justify-center" style={{ background: "var(--brand-soft)" }}><Folder size={14} /></div>
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
            className="absolute left-0 top-full mt-1 w-full z-20 rounded-[6px] p-1.5"
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
                color: "var(--ink)",
                }}
              >
                <span className="w-[22px] h-[22px] rounded-[5px] flex items-center justify-center" style={{ background: "var(--bg)" }}><Folder size={12} /></span>
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
        工作区
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
                color: active ? "var(--ink)" : "var(--ink-2)",
                background: active ? "var(--brand-soft)" : "transparent",
                border: "1px solid transparent",
              }}
            >
              <Icon size={16} className="opacity-85" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* 项目管理与当前项目任务分开，避免“所有项目”与业务入口混在一起。 */}
      <div className="px-[18px] pt-3.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--ink-4)" }}>
        项目
      </div>
      <div className="px-2.5">
        <button
          onClick={() => router.push("/projects")}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors text-left"
          style={{
            fontWeight: pathname === "/projects" ? 600 : 500,
            color: pathname === "/projects" ? "var(--ink)" : "var(--ink-2)",
            background: pathname === "/projects" ? "var(--brand-soft)" : "transparent",
            border: "1px solid transparent",
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
              background: "transparent",
              border: "1px solid var(--line-strong)",
              color: "var(--ink-2)",
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
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px]"
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-xs"
            style={{ background: "var(--ink)" }}
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

    {/* 移动端使用顶部项目栏和可展开导航，避免固定侧栏挤压主内容。 */}
    <header className="md:hidden relative flex-none h-14 px-3 flex items-center gap-3 bg-[var(--bg-rail)] border-b border-[var(--line)] z-30">
      <div className="w-8 h-8 rounded-[6px] grid place-items-center bg-[var(--ink)] text-white font-semibold">I</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold truncate">{project?.name ?? "IDEA-MAKER"}</div>
        <div className="text-[10px]" style={{ color: "var(--ink-3)" }}>可信营销内容伙伴</div>
      </div>
      <button
        type="button"
        className="btn btn-icon bg-white"
        aria-label={showMobileMenu ? "关闭导航" : "打开导航"}
        aria-expanded={showMobileMenu}
        onClick={() => setShowMobileMenu((open) => !open)}
      >
        {showMobileMenu ? <X size={17} /> : <Menu size={17} />}
      </button>

      {showMobileMenu ? (
        <div className="absolute left-0 right-0 top-full bg-white border-b border-[var(--line)] p-3 shadow-[var(--shadow-lg)]">
          <nav className="grid grid-cols-2 gap-1" aria-label="移动端项目导航">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.path);
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.path)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-[6px] text-left text-[13px]"
                  style={{ background: active ? "var(--brand-soft)" : "transparent", color: "var(--ink)" }}
                >
                  <Icon size={15} />{item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => { setShowMobileMenu(false); router.push("/projects"); }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-[6px] text-left text-[13px]"
            >
              <Folder size={15} />所有项目
            </button>
          </nav>
        </div>
      ) : null}
    </header>
    </>
  );
}
