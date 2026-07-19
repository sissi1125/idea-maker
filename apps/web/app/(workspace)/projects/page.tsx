/**
 * Projects 列表页 — feat-200.5 Week 5
 *
 * 从原型 Projects.jsx 迁移。对接 useProjectsStore CRUD。
 * 功能：
 *   - 项目卡片网格（responsive auto-fill）
 *   - 内联新建（展开表单卡 → 创建 → 自动跳转）
 *   - 点击卡片 → setCurrentProject + router.push 进入对话
 *   - 删除走 context menu（Week 7 做完整 dropdown，暂简化为按钮）
 */

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, FileText, Clock, DollarSign, Trash2, Folder,
} from "lucide-react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/toast/ToastProvider";
import { ConfirmDialog } from "@/components/ui/ProductUi";

export default function ProjectsPage() {
  const router = useRouter();
  const toast = useToast();
  const {
    projects, currentProjectId, loading,
    createProject, deleteProject, setCurrentProject,
  } = useProjectsStore();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // 表单内联错误保留——比 toast 更靠近输入框，用户视线不需要跳到右下角；
  // 系统级反馈统一使用产品内 toast，避免表单错误与全局错误混在一起。
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const project = await createProject({ name: name.trim(), description: description.trim() || undefined });
      setCreating(false);
      setName("");
      setDescription("");
      toast.success(`项目 "${project.name}" 已创建`);
      router.push(`/projects/${project.id}/overview`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建失败";
      setError(msg);
      toast.error(msg);
    }
  };

  const handleCardClick = (id: string) => {
    setCurrentProject(id);
    router.push(`/projects/${id}/overview`);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
  };

  /** 删除由统一确认弹窗触发，失败时保留项目并给出 toast。 */
  const confirmProjectDelete = async () => {
    if (!deletingId) return;
    setDeleteBusy(true);
    try {
      await deleteProject(deletingId);
      toast.info("项目已删除");
      setDeletingId(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setDeleteBusy(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  return (
    <div className="page-shell">
      <ConfirmDialog
        open={deletingId !== null}
        title="删除这个项目？"
        description="项目中的资料、产品档案和内容资产将一并删除，此操作无法撤销。"
        confirmLabel="删除项目"
        busy={deleteBusy}
        onConfirm={confirmProjectDelete}
        onClose={() => setDeletingId(null)}
      />
      {/* Header */}
      <div className="flex items-end mb-5">
        <div className="flex-1">
          <h1 className="page-title">所有项目</h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--ink-3)" }}>
            每个项目拥有独立的产品资料、已确认信息和内容资产 · 共 {projects.length} 个
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={13} strokeWidth={2.2} /> 新建项目
        </button>
      </div>

      {/* Empty state（无 loading + 无 projects + 无 creating）—— 首次进来引导 */}
      {!loading && projects.length === 0 && !creating && (
        <div className="bg-white border border-[var(--line)] grid gap-8 md:grid-cols-[1fr_320px] items-center mb-5 p-7 md:p-9 rounded-[8px]">
          <div>
            <span className="chip" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>开始第一个项目</span>
            <h2 className="text-2xl font-semibold mt-4 mb-2">让 AI 真正了解你的产品，再开始写内容。</h2>
            <p className="text-[13px] leading-6 max-w-[620px]" style={{ color: "var(--ink-3)" }}>创建项目后添加产品手册或官方网站，确认关键产品信息，再生成有来源、可核查的多平台营销内容。</p>
            <button className="btn btn-primary mt-5" onClick={() => setCreating(true)}><Plus size={14} />创建项目</button>
          </div>
          <ol className="grid gap-3 text-xs" style={{ color: "var(--ink-2)" }}>
            {["添加产品资料", "确认产品信息", "创建营销内容", "核查并保存"].map((label, index) => <li key={label} className="flex items-center gap-3"><span className="w-6 h-6 rounded-full grid place-items-center text-white text-[11px]" style={{ background: index === 0 ? "var(--brand)" : "var(--ink)" }}>{index + 1}</span>{label}</li>)}
          </ol>
        </div>
      )}

      {/* Grid */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {/* New project form card */}
        {creating && (
          <form
            onSubmit={handleCreate}
            className="bg-white border border-[var(--brand)] rounded-[8px] fade-in p-[18px]"
            style={{ border: "1px dashed var(--brand)", background: "var(--brand-soft)" }}
          >
            <div className="text-[13px] font-semibold mb-2" style={{ color: "var(--brand)" }}>
              新项目
            </div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目名称，如「夏季新品蓝牙音响」"
              className="w-full h-[34px] px-2.5 rounded-[7px] text-[13px] bg-white outline-none"
              style={{ border: "1px solid var(--line-strong)" }}
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述（可选）"
              className="w-full h-[34px] px-2.5 rounded-[7px] text-[13px] bg-white outline-none mt-2"
              style={{ border: "1px solid var(--line-strong)" }}
            />
            {error && (
              <div className="text-[12px] mt-2" style={{ color: "var(--err)" }}>{error}</div>
            )}
            <div className="flex gap-1.5 mt-2.5">
              <button type="submit" className="btn btn-sm btn-primary" disabled={!name.trim()}>
                创建
              </button>
              <button type="button" className="btn btn-sm" onClick={() => { setCreating(false); setName(""); setDescription(""); }}>
                取消
              </button>
            </div>
          </form>
        )}

        {/* Project cards */}
        {projects.map((p) => {
          const active = p.id === currentProjectId;
          return (
            <div
              key={p.id}
              className="bg-white border relative p-[18px] cursor-pointer transition-colors rounded-[8px] hover:border-[var(--ink)]"
              style={{
                border: active ? "1px solid var(--brand)" : undefined,
                boxShadow: "none",
              }}
              onClick={() => handleCardClick(p.id)}
            >
              <div className="flex items-start gap-3 mb-2.5">
                <div className="w-[42px] h-[42px] rounded-[6px] flex items-center justify-center" style={{ background: "var(--line-2)", border: "1px solid var(--line)" }}><Folder size={18} /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] font-semibold tracking-tight truncate">
                    {p.name}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-4)" }}>
                    创建于 {formatDate(p.createdAt)}
                  </div>
                </div>
                {active && (
                  <span className="chip" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
                    当前项目
                  </span>
                )}
              </div>

              <div
                className="text-[12.5px] leading-relaxed mb-3.5 min-h-[34px]"
                style={{
                  color: "var(--ink-3)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {p.description ?? "暂无描述"}
              </div>

              <div
                className="flex gap-3.5 pt-2.5 text-[11.5px]"
                style={{ borderTop: "1px solid var(--line-2)", color: "var(--ink-3)" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={11} strokeWidth={1.6} /> {p.docsCount} 文档
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={11} strokeWidth={1.6} /> {formatDate(p.updatedAt)}
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5 font-semibold mono"
                  style={{ color: "var(--ok)" }}>
                  <DollarSign size={10} strokeWidth={2} /> {p.totalCostUsd.toFixed(2)}
                </span>
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(p.id, e)}
                className="btn btn-sm btn-ghost absolute top-2.5 right-2.5 px-1.5 h-6"
                title="删除项目"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}

        {/* Empty state / new project trigger */}
        {!creating && (
          <div
            className="flex items-center justify-center cursor-pointer text-[13.5px] font-medium gap-2 rounded-[8px] hover:bg-white transition-colors"
            style={{
              padding: "18px",
              border: "1px dashed var(--line-strong)",
              background: "transparent",
              color: "var(--ink-3)",
              minHeight: 162,
            }}
            onClick={() => setCreating(true)}
          >
            <Plus size={14} strokeWidth={2} /> 新建项目
          </div>
        )}
      </div>

      {/* Loading skeleton——比"加载中..."视觉一致性更好 */}
      {loading && projects.length === 0 && (
        <div className="grid gap-3.5 mt-2"
             style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-[18px]"
                 style={{ minHeight: 162, opacity: 0.4 }}>
              <div className="flex items-start gap-3 mb-2.5">
                <div className="w-[42px] h-[42px] rounded-[10px]"
                     style={{ background: "rgba(11,17,32,.08)",
                              animation: "shimmer 1.4s linear infinite" }} />
                <div className="flex-1">
                  <div className="h-[14px] w-[60%] rounded mb-2"
                       style={{ background: "rgba(11,17,32,.08)" }} />
                  <div className="h-[10px] w-[40%] rounded"
                       style={{ background: "rgba(11,17,32,.05)" }} />
                </div>
              </div>
              <div className="h-[10px] w-[90%] rounded mb-1"
                   style={{ background: "rgba(11,17,32,.05)" }} />
              <div className="h-[10px] w-[70%] rounded"
                   style={{ background: "rgba(11,17,32,.05)" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
