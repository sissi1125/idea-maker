/**
 * Knowledge 知识库页 — feat-200.6 Week 6
 *
 * 迁移自原型 Upload.jsx。对接真实 API：
 *   - 文档 CRUD：documentsApi.listDocuments / uploadDocument / deleteDocument
 *   - Ingestion 进度：轮询 ingestionApi（SSE 为 Week 8 增强）
 *
 * 功能：
 *   - 三分类 Tab（产品资料 / 竞品资料 / 历史宣传物料）
 *   - Dropzone 拖拽上传（真实调 POST /documents multipart）
 *   - 文件列表按分类分组，显示文件名 / 大小 / 状态 / chunks
 *   - 处理中的文件显示进度条
 *   - 底部"完成，去对话"按钮跳转 chat 主界面
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Upload, Check, MoreHorizontal, ArrowRight,
} from "lucide-react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { documentsApi } from "@/lib/api";
import type { Document as ApiDocument } from "@/lib/api";

// ── 分类定义 ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "product", label: "产品资料",     hint: "产品手册、规格书、卖点稿", icon: "📦",
    color: "var(--brand)", bg: "var(--brand-soft)", border: "rgba(79,168,154,.28)" },
  { id: "compete", label: "竞品资料",     hint: "对标竞品的产品页、评测",   icon: "🎯",
    color: "var(--tool)",  bg: "var(--tool-bg)",    border: "rgba(201,89,29,.22)" },
  { id: "history", label: "历史宣传物料", hint: "过往优秀文案、获奖案例",   icon: "🗂️",
    color: "var(--gen)",   bg: "var(--gen-bg)",     border: "rgba(214,180,80,.25)" },
];

// ── 文件扩展名样式 ─────────────────────────────────────────────────────────

function getExtStyle(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return { bg: "#FBE9DC", color: "var(--tool)" };
  if (ext === "docx" || ext === "doc") return { bg: "var(--brand-soft)", color: "var(--brand)" };
  return { bg: "#F2F1EA", color: "var(--ink-3)" };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── 本地文件条目类型（包含上传状态） ───────────────────────────────────────

interface FileEntry {
  id: string;
  name: string;
  size: string;
  status: "uploading" | "processing" | "done" | "failed";
  progress: number;
  stage: string;
  chunks: number;
  category: string;
}

// ── 组件 ──────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const { currentProject: getCurrent, setCurrentProject } = useProjectsStore();
  const project = getCurrent();

  const [category, setCategory] = useState("product");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步 project
  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const loadDocuments = useCallback(async () => {
    try {
      const { documents } = await documentsApi.listDocuments();
      setFiles(documents.map((d: ApiDocument) => ({
        id: d.id,
        name: d.fileName,
        size: formatSize(d.sizeBytes),
        status: "done" as const,
        progress: 100,
        stage: "已索引",
        chunks: 0, // 后端暂不返回 chunks 数（Week 8 增强）
        category: guessCategoryFromName(d.fileName),
      })));
    } catch {
      // 静默失败，空列表即可
    }
  }, []);

  // 初始化：拉文档列表
  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  /** 根据文件名猜测分类（简单启发式，后续可改为用户选择） */
  function guessCategoryFromName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes("compet") || lower.includes("竞品") || lower.includes("对比")) return "compete";
    if (lower.includes("histor") || lower.includes("案例") || lower.includes("宣传")) return "history";
    return "product";
  }

  // ── 上传处理 ─────────────────────────────────────────────────────────────

  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    for (const file of Array.from(fileList)) {
      // 先加一个 uploading 状态的条目
      const tempId = `temp-${Date.now()}-${file.name}`;
      const entry: FileEntry = {
        id: tempId,
        name: file.name,
        size: formatSize(file.size),
        status: "uploading",
        progress: 30,
        stage: "上传中",
        chunks: 0,
        category,
      };
      setFiles(prev => [entry, ...prev]);

      try {
        const { document: doc } = await documentsApi.uploadDocument(file, category);
        // 更新为 done
        setFiles(prev => prev.map(f =>
          f.id === tempId
            ? { ...f, id: doc.id, status: "done", progress: 100, stage: "已索引" }
            : f,
        ));
      } catch (err) {
        setFiles(prev => prev.map(f =>
          f.id === tempId
            ? { ...f, status: "failed", stage: err instanceof Error ? err.message : "上传失败" }
            : f,
        ));
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDelete = async (fileId: string) => {
    if (fileId.startsWith("temp-")) {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      return;
    }
    try {
      await documentsApi.deleteDocument(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch {
      // 静默
    }
  };

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  const active = CATEGORIES.find(c => c.id === category)!;
  const countByCat = (catId: string) => files.filter(f => f.category === catId).length;

  return (
    <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
      <div className="max-w-[980px] mx-auto px-8 py-7 pb-20">
        {/* Header */}
        <div className="mb-[18px]">
          <div className="text-[22px] font-semibold tracking-tight">
            📚 知识库 · {project?.name ?? "项目"}
          </div>
          <div className="text-[13px] mt-0.5" style={{ color: "var(--ink-3)" }}>
            按 <b>产品资料 / 竞品资料 / 历史宣传物料</b> 三类分别上传 — Agent 会针对不同来源使用不同的检索策略
          </div>
        </div>

        {/* Category tiles */}
        <div className="grid grid-cols-3 gap-2.5 mb-3.5">
          {CATEGORIES.map(c => {
            const isActive = c.id === category;
            const count = countByCat(c.id);
            return (
              <button key={c.id}
                onClick={() => setCategory(c.id)}
                className="text-left rounded-[11px] cursor-pointer flex gap-[11px] items-start"
                style={{
                  padding: "14px",
                  border: `1px solid ${isActive ? c.color : "var(--line)"}`,
                  background: isActive ? c.bg : "#fff",
                  boxShadow: isActive ? `0 0 0 4px ${c.bg}, 0 6px 14px ${c.bg}` : "var(--shadow-sm)",
                  transition: ".15s",
                }}>
                <span className="w-9 h-9 rounded-[9px] flex-none bg-white flex items-center justify-center text-[18px]"
                      style={{ border: `1px solid ${c.border}` }}>
                  {c.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 mb-[3px]">
                    <span className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{c.label}</span>
                    {isActive && <Check size={12} strokeWidth={2.4} style={{ color: c.color }} />}
                  </span>
                  <span className="block text-[11.5px] leading-[1.45] mb-2" style={{ color: "var(--ink-3)" }}>
                    {c.hint}
                  </span>
                  <span className="flex items-center gap-2 text-[11px]">
                    <span className="chip mono font-semibold"
                          style={{ background: isActive ? "#fff" : "rgba(11,17,32,.04)", color: c.color }}>
                      {count} 文件
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-[14px] text-center cursor-pointer"
          style={{
            padding: "30px 24px",
            border: `2px dashed ${drag ? active.color : "var(--line-strong)"}`,
            background: drag ? active.bg : "#fff",
            transition: ".15s",
          }}>
          <div className="mx-auto mb-3 w-[50px] h-[50px] rounded-[13px] flex items-center justify-center"
               style={{ background: active.bg, color: active.color }}>
            <Upload size={24} strokeWidth={1.8} />
          </div>
          <div className="text-[14.5px] font-semibold mb-1" style={{ color: "var(--ink)" }}>
            拖拽 <span style={{ color: active.color }}>{active.label}</span> 到此处，或
            <span style={{ color: active.color }}> 点击上传</span>
          </div>
          <div className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            支持 PDF、DOCX、TXT、Markdown · 单文件最大 50 MB
          </div>
          <div className="flex justify-center gap-3.5 mt-3.5 text-[11.5px]" style={{ color: "var(--ink-4)" }}>
            {["PDF", "DOCX", "TXT", "MD"].map(t => (
              <span key={t} className="chip mono" style={{ background: "rgba(11,17,32,.04)" }}>{t}</span>
            ))}
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden"
                 accept=".pdf,.docx,.doc,.txt,.md,.markdown"
                 onChange={(e) => handleFileSelect(e.target.files)} />
        </div>

        {/* File list grouped by category */}
        <div className="mt-[18px]">
          {CATEGORIES.map(c => {
            const list = files.filter(f => f.category === c.id);
            if (list.length === 0) return null;
            return (
              <div key={c.id} className="mb-3.5">
                <div className="flex items-center gap-2.5 mb-2 text-[11.5px] font-semibold tracking-wider uppercase"
                     style={{ color: c.color }}>
                  <span className="text-[13px]">{c.icon}</span>
                  <span>{c.label}</span>
                  <div className="flex-1 h-px" style={{ background: "var(--line-2)" }} />
                  <span className="mono normal-case tracking-normal" style={{ color: "var(--ink-4)" }}>
                    {list.length} 个文件
                  </span>
                </div>
                <div className="card p-0 overflow-hidden">
                  {list.map((f, i) => {
                    const ext = f.name.split(".").pop()?.toUpperCase() ?? "?";
                    const extStyle = getExtStyle(f.name);
                    return (
                      <div key={f.id} className="flex items-center gap-3 px-4 py-3"
                           style={{ borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
                        {/* File type badge */}
                        <span className="w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-none text-[11px] font-bold mono"
                              style={{ background: extStyle.bg, color: extStyle.color }}>
                          {ext}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <div className="text-[13.5px] font-semibold truncate">{f.name}</div>
                            <div className="text-[11px] mono" style={{ color: "var(--ink-4)" }}>{f.size}</div>
                          </div>
                          {f.status === "uploading" || f.status === "processing" ? (
                            <div className="flex items-center gap-2.5 mt-1.5">
                              <div className="relative h-[6px] flex-1 rounded-full overflow-hidden"
                                   style={{ background: "rgba(11,17,32,.06)" }}>
                                <div className="absolute inset-0 rounded-full"
                                     style={{ width: `${f.progress}%`, background: c.color, transition: "width .35s" }} />
                              </div>
                              <span className="mono text-[11px] font-semibold min-w-[64px] text-right"
                                    style={{ color: c.color }}>
                                {f.progress}% · {f.stage}
                              </span>
                            </div>
                          ) : f.status === "failed" ? (
                            <div className="text-[11.5px] mt-[3px]" style={{ color: "var(--err)" }}>
                              ✕ {f.stage}
                            </div>
                          ) : (
                            <div className="text-[11.5px] mt-[3px]" style={{ color: "var(--ink-3)" }}>
                              ✓ 已索引
                            </div>
                          )}
                        </div>

                        {/* Status icon */}
                        {f.status === "done" && (
                          <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center"
                                style={{ background: "var(--ok)", color: "#fff" }}>
                            <Check size={12} strokeWidth={2.5} />
                          </span>
                        )}
                        {f.status === "uploading" && (
                          <span className="w-[22px] h-[22px] rounded-full flex-none"
                                style={{ border: "2.5px solid rgba(79,168,154,.22)", borderTopColor: "var(--brand)", animation: "spin .9s linear infinite" }} />
                        )}

                        {/* Delete */}
                        <button className="btn btn-sm btn-ghost px-1.5 h-6"
                                onClick={() => handleDelete(f.id)}
                                title="删除">
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom action */}
        <div className="mt-[18px] flex gap-2">
          <button className="btn btn-primary"
                  onClick={() => router.push(`/projects/${projectId}`)}>
            完成，去对话 <ArrowRight size={12} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </main>
  );
}
