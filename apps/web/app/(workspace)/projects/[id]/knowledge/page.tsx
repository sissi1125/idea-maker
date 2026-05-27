/**
 * Knowledge 知识库页 — feat-200.6 Week 6
 *
 * 迁移自原型 Upload.jsx。对接 MVP 后端：
 *   - POST   /projects/:pid/documents（multipart + category）→ 自动触发 ingestion
 *   - GET    /projects/:pid/documents?category= 列表
 *   - DELETE /projects/:pid/documents/:docId
 *   - GET    /projects/:pid/ingestion/:jobId 轮询进度
 *
 * 流程：
 *   1. 用户选分类 → 拖拽/点击上传文件
 *   2. 后端返回 {document, ingestionJobId}
 *   3. 前端用 ingestionJobId 轮询进度（每 2s），更新进度条
 *   4. ingestion 完成 → 文件状态变为 ready
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Upload, Check, MoreHorizontal, ArrowRight,
} from "lucide-react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { documentsApi } from "@/lib/api";
import type { MvpDocument, DocumentCategory, IngestionJob } from "@/lib/api";

// ── 分类定义 ──────────────────────────────────────────────────────────────

const CATEGORIES: Array<{
  id: DocumentCategory;
  label: string;
  hint: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
}> = [
  { id: "product", label: "产品资料",     hint: "产品手册、规格书、卖点稿", icon: "📦",
    color: "var(--brand)", bg: "var(--brand-soft)", border: "rgba(79,168,154,.28)" },
  { id: "compete", label: "竞品资料",     hint: "对标竞品的产品页、评测",   icon: "🎯",
    color: "var(--tool)",  bg: "var(--tool-bg)",    border: "rgba(201,89,29,.22)" },
  { id: "history", label: "历史宣传物料", hint: "过往优秀文案、获奖案例",   icon: "🗂️",
    color: "var(--gen)",   bg: "var(--gen-bg)",     border: "rgba(214,180,80,.25)" },
];

// ── 工具函数 ──────────────────────────────────────────────────────────────

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

function stageLabel(stage: string | null): string {
  if (!stage) return "等待中";
  const map: Record<string, string> = {
    preprocess: "解析中", chunk: "Chunking", embedding: "Embedding",
    storage: "建索引", complete: "已索引",
  };
  return map[stage] ?? stage;
}

// ── 本地文件条目（合并 document + ingestion 状态） ──────────────────────────

interface FileEntry {
  id: string;
  name: string;
  size: string;
  category: DocumentCategory;
  status: "uploading" | "queued" | "processing" | "ready" | "error";
  progress: number;
  stage: string;
  ingestionJobId: string | null;
}

// ── 组件 ──────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const { currentProject: getCurrent, setCurrentProject } = useProjectsStore();
  const project = getCurrent();

  const [category, setCategory] = useState<DocumentCategory>("product");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 正在轮询的 jobId 集合
  const pollingRef = useRef<Set<string>>(new Set());

  // 同步 project
  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  // ── 加载文档列表 ─────────────────────────────────────────────────────────

  const loadDocuments = useCallback(async () => {
    if (!projectId) return;
    try {
      const { documents } = await documentsApi.listDocuments(projectId);
      setFiles(documents.map((d: MvpDocument) => ({
        id: d.id,
        name: d.fileName,
        size: formatSize(d.fileSize),
        category: d.category,
        status: d.processingStatus,
        progress: d.processingStatus === "ready" ? 100 : 0,
        stage: d.processingStatus === "ready" ? "已索引" : stageLabel(null),
        ingestionJobId: null,
      })));
    } catch {
      // 静默
    }
  }, [projectId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // ── Ingestion 轮询 ──────────────────────────────────────────────────────

  const pollIngestion = useCallback((jobId: string, docTempId: string) => {
    if (!projectId || pollingRef.current.has(jobId)) return;
    pollingRef.current.add(jobId);

    const timer = setInterval(async () => {
      try {
        const { job } = await documentsApi.getIngestionJob(projectId, jobId);
        // 更新对应文件条目
        setFiles(prev => prev.map(f => {
          if (f.id !== docTempId && f.ingestionJobId !== jobId) return f;
          return {
            ...f,
            status: job.status === "completed" ? "ready"
                  : job.status === "failed" ? "error"
                  : job.status as FileEntry["status"],
            progress: job.progress,
            stage: job.status === "completed" ? "已索引"
                 : job.status === "failed" ? (job.error ?? "处理失败")
                 : stageLabel(job.currentStage),
          };
        }));

        // 完成或失败 → 停止轮询
        if (job.status === "completed" || job.status === "failed") {
          clearInterval(timer);
          pollingRef.current.delete(jobId);
        }
      } catch {
        // 静默，下次重试
      }
    }, 2000);

    // 返回清理函数（组件卸载时用）
    return () => {
      clearInterval(timer);
      pollingRef.current.delete(jobId);
    };
  }, [projectId]);

  // ── 上传处理 ─────────────────────────────────────────────────────────────

  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !projectId) return;

    for (const file of Array.from(fileList)) {
      const tempId = `temp-${Date.now()}-${file.name}`;
      const entry: FileEntry = {
        id: tempId,
        name: file.name,
        size: formatSize(file.size),
        category,
        status: "uploading",
        progress: 0,
        stage: "上传中",
        ingestionJobId: null,
      };
      setFiles(prev => [entry, ...prev]);

      try {
        const { document: doc, ingestionJobId } = await documentsApi.uploadDocument(
          projectId, file, category,
        );
        // 更新为 queued/processing 并开始轮询
        setFiles(prev => prev.map(f =>
          f.id === tempId
            ? { ...f, id: doc.id, status: "queued", progress: 0, stage: "排队中", ingestionJobId }
            : f,
        ));
        pollIngestion(ingestionJobId, doc.id);
      } catch (err) {
        setFiles(prev => prev.map(f =>
          f.id === tempId
            ? { ...f, status: "error", stage: err instanceof Error ? err.message : "上传失败" }
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
    if (!projectId) return;
    if (fileId.startsWith("temp-")) {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      return;
    }
    try {
      await documentsApi.deleteDocument(projectId, fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch {
      // 静默
    }
  };

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  const active = CATEGORIES.find(c => c.id === category)!;
  const countByCat = (catId: DocumentCategory) => files.filter(f => f.category === catId).length;
  const processingCount = files.filter(f => f.status === "processing" || f.status === "queued").length;

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

        {/* Processing summary */}
        {processingCount > 0 && (
          <div className="card mt-3.5 flex items-center gap-3.5"
               style={{ padding: "14px 16px" }}>
            <div className="w-[22px] h-[22px] rounded-full flex-none"
                 style={{ border: "2.5px solid rgba(79,168,154,.22)", borderTopColor: "var(--brand)", animation: "spin .9s linear infinite" }} />
            <div className="flex-1">
              <div className="text-[13.5px] font-semibold">
                正在处理 {processingCount} 个文件
              </div>
              <div className="text-[11.5px] mt-0.5" style={{ color: "var(--ink-3)" }}>
                完成后将自动生成 <b>产品介绍</b> 与 <b>竞品分析</b> 卡片
              </div>
            </div>
          </div>
        )}

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
                    const isProcessing = f.status === "uploading" || f.status === "processing" || f.status === "queued";
                    return (
                      <div key={f.id} className="flex items-center gap-3 px-4 py-3"
                           style={{ borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
                        <span className="w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-none text-[11px] font-bold mono"
                              style={{ background: extStyle.bg, color: extStyle.color }}>
                          {ext}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <div className="text-[13.5px] font-semibold truncate">{f.name}</div>
                            <div className="text-[11px] mono" style={{ color: "var(--ink-4)" }}>{f.size}</div>
                          </div>
                          {isProcessing ? (
                            <div className="flex items-center gap-2.5 mt-1.5">
                              <div className="relative h-[6px] flex-1 rounded-full overflow-hidden"
                                   style={{ background: "rgba(11,17,32,.06)" }}>
                                <div className="absolute inset-0 rounded-full"
                                     style={{ width: `${f.progress}%`, background: c.color, transition: "width .35s" }} />
                              </div>
                              <span className="mono text-[11px] font-semibold min-w-[80px] text-right"
                                    style={{ color: c.color }}>
                                {f.progress}% · {f.stage}
                              </span>
                            </div>
                          ) : f.status === "error" ? (
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
                        {f.status === "ready" && (
                          <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center"
                                style={{ background: "var(--ok)", color: "#fff" }}>
                            <Check size={12} strokeWidth={2.5} />
                          </span>
                        )}
                        {isProcessing && (
                          <span className="w-[22px] h-[22px] rounded-full flex-none"
                                style={{ border: "2.5px solid rgba(79,168,154,.22)", borderTopColor: "var(--brand)", animation: "spin .9s linear infinite" }} />
                        )}

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
