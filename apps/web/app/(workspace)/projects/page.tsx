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
  Plus, FileText, Clock, DollarSign, Trash2,
} from "lucide-react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/toast/ToastProvider";

const EMOJI_POOL = ["🔊", "🕯️", "🥗", "🎒", "📱", "🎨", "🚀", "💡", "📊", "🌟"];

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
  // 但 alert() 一类的"系统对话框"统一改成 toast 失败提示。
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
      const project = await createProject({ name: name.trim(), emoji, description: description.trim() || undefined });
      setCreating(false);
      setName("");
      setDescription("");
      toast.success(`项目 "${project.name}" 已创建`);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建失败";
      setError(msg);
      toast.error(msg);
    }
  };

  const handleCardClick = (id: string) => {
    setCurrentProject(id);
    router.push(`/projects/${id}`);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定删除该项目？此操作不可撤销。")) return;
    try {
      await deleteProject(id);
      toast.info("项目已删除");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-7 pb-20">
      {/* Header */}
      <div className="flex items-end mb-5">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold tracking-tight">所有项目</h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--ink-3)" }}>
            每个项目拥有独立的知识库、偏好和 Agent 记忆 · 共 {projects.length} 个
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={13} strokeWidth={2.2} /> 新建项目
        </button>
      </div>

      {/* Empty state（无 loading + 无 projects + 无 creating）—— 首次进来引导 */}
      {!loading && projects.length === 0 && !creating && (
        <div className="card flex flex-col items-center text-center gap-2 mb-4"
             style={{ padding: "40px 24px", border: "1px dashed var(--line-strong)",
                      background: "transparent" }}>
          <div className="text-[28px]">🗂️</div>
          <div className="text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>
            还没有项目
          </div>
          <div className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            点击下方 &ldquo;新建项目&rdquo; 开始你的第一次 RAG 实验
          </div>
          <button className="btn btn-primary mt-2" onClick={() => setCreating(true)}>
            <Plus size={13} strokeWidth={2.2} /> 新建项目
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {/* New project form card */}
        {creating && (
          <form
            onSubmit={handleCreate}
            className="card fade-in p-[18px]"
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
              className="card relative p-[18px] cursor-pointer transition-all hover:-translate-y-0.5"
              style={{
                border: active ? "1px solid var(--brand)" : undefined,
                boxShadow: active ? "0 0 0 4px rgba(79,168,154,.1)" : undefined,
              }}
              onClick={() => handleCardClick(p.id)}
            >
              <div className="flex items-start gap-3 mb-2.5">
                <div
                  className="w-[42px] h-[42px] rounded-[10px] flex items-center justify-center text-[22px]"
                  style={{
                    background: "linear-gradient(180deg, #FBF9F2, #F2EFE5)",
                    border: "1px solid var(--line-2)",
                  }}
                >
                  {p.emoji ?? "📂"}
                </div>
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
                    当前
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
            className="card flex items-center justify-center cursor-pointer text-[13.5px] font-medium gap-2"
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
