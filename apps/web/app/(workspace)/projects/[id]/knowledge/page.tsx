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
 *   3. 前端用 ingestionJobId 轮询进度（首次 200ms，之后每 2s），更新进度条
 *   4. ingestion 完成 → 文件状态变为 ready，展示 ingestion 详情
 *
 * 修复记录：
 *   - 删除按钮改为 X icon + 二次确认弹窗
 *   - 轮询首次延迟从 2s 改为 200ms（ingestion 小文件<200ms 就完成）
 *   - 显示 ingestion 各阶段详情（chunks 数量、耗时、阶段列表）
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Upload, Check, X, ArrowRight, AlertCircle, ChevronDown, ChevronRight,
} from "lucide-react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { documentsApi } from "@/lib/api";
import type {
  MvpDocument, DocumentCategory, IngestionJob,
  IngestionStage, IngestionStageOutputs,
} from "@/lib/api";
import { useToast } from "@/components/toast/ToastProvider";

// ── Stage 显示顺序 + 中文标签 ────────────────────────────────────────────────

const STAGE_ORDER: IngestionStage[] = ["idempotency", "preprocess", "chunk", "embedding", "storage"];
const STAGE_LABELS: Record<IngestionStage, string> = {
  idempotency: "去重校验",
  preprocess:  "文档解析",
  chunk:       "文本分块",
  embedding:   "向量化",
  storage:     "写入索引",
};

/**
 * 单 stage 的展示行——method/durationMs + 关键 metrics chips。
 * processing 中未完成的 stage 渲染为灰色占位 "—"。
 */
function StageOutputRow({
  stage,
  output,
}: {
  stage: IngestionStage;
  output: IngestionStageOutputs[IngestionStage];
}) {
  const label = STAGE_LABELS[stage];
  if (!output) {
    return (
      <div className="flex items-center gap-2 py-1.5 text-[11.5px]" style={{ color: "var(--ink-4)" }}>
        <span className="w-[60px] flex-none">{label}</span>
        <span className="mono">—</span>
      </div>
    );
  }
  const chips: Array<[string, string]> = [];
  if (output.metrics) {
    for (const [k, v] of Object.entries(output.metrics)) {
      chips.push([k, String(v)]);
    }
  }
  return (
    <div className="py-1.5 text-[11.5px]" style={{ color: "var(--ink-2)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-[60px] flex-none font-semibold" style={{ color: "var(--ink)" }}>
          {label}
        </span>
        <span className="chip mono" style={{ background: "rgba(11,17,32,.04)", color: "var(--ink-2)" }}>
          {output.method}
        </span>
        <span className="mono" style={{ color: "var(--ink-4)" }}>
          {output.durationMs}ms
        </span>
        {chips.map(([k, v]) => (
          <span key={k} className="chip mono text-[10.5px]"
                style={{ background: "rgba(79,168,154,.07)", color: "var(--brand)" }}>
            {k}={v}
          </span>
        ))}
      </div>
      {output.note && (
        <div className="mt-0.5 text-[11px] pl-[68px]" style={{ color: "var(--tool)" }}>
          ⚠ {output.note}
        </div>
      )}
    </div>
  );
}

function StageOutputsPanel({ outputs }: { outputs: IngestionStageOutputs }) {
  return (
    <div className="mt-2 px-3 py-2 rounded-md"
         style={{ background: "rgba(11,17,32,.025)", border: "1px solid var(--line-2)" }}>
      <div className="text-[10.5px] font-semibold tracking-wider uppercase mb-1"
           style={{ color: "var(--ink-4)" }}>
        Ingestion 阶段输出
      </div>
      {STAGE_ORDER.map((s) => (
        <StageOutputRow key={s} stage={s} output={outputs[s]} />
      ))}
    </div>
  );
}

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

/** 将 ingestion stage 名映射为中文，含 ingestion 5 阶段 */
function stageLabel(stage: string | null): string {
  if (!stage) return "等待中";
  const map: Record<string, string> = {
    idempotency: "去重校验",
    preprocess: "文档解析",
    chunk: "文本分块",
    embedding: "向量化",
    storage: "写入索引",
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
  /** ingestion 完成后的详情 */
  ingestionDetail: {
    chunksTotal: number;
    durationMs: number;
    error: string | null;
  } | null;
  /** 每个 stage 的输出摘要——边跑边累加 */
  stageOutputs: IngestionStageOutputs;
}

// ── 删除确认弹窗组件 ────────────────────────────────────────────────────────

function ConfirmDeleteDialog({
  fileName,
  onConfirm,
  onCancel,
}: {
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.35)" }}
      onClick={onCancel}
    >
      <div
        className="card p-5 w-[380px] fade-in"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(179,38,30,.08)", color: "var(--err)" }}
          >
            <AlertCircle size={16} strokeWidth={1.8} />
          </div>
          <div className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
            确认删除
          </div>
        </div>
        <div className="text-[13px] leading-relaxed mb-4" style={{ color: "var(--ink-2)" }}>
          确定要删除 <b>{fileName}</b> 吗？删除后对应的向量数据也会清除，此操作不可恢复。
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button
            className="btn btn-sm"
            style={{
              background: "var(--err)",
              color: "#fff",
              border: "1px solid var(--err)",
            }}
            onClick={onConfirm}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { currentProject: getCurrent, setCurrentProject } = useProjectsStore();
  const project = getCurrent();

  const [category, setCategory] = useState<DocumentCategory>("product");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<Set<string>>(new Set());

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  /**
   * 哪些 file 的 stage outputs 面板展开。
   * - 处理中默认自动展开（看流程跑）；
   * - 完成后默认折叠（结果以"X chunks · Yms"行展示），用户可手动展开看细节。
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (fileId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  };

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  // ── Ingestion 轮询（必须在 loadDocuments 之前定义，loadDocuments 依赖它） ──

  /** 根据 ingestion job 更新文件条目 */
  const updateFileFromJob = useCallback((docId: string, jobId: string, job: IngestionJob) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== docId && f.ingestionJobId !== jobId) return f;

      const isDone = job.status === "completed";
      const isFailed = job.status === "failed";

      return {
        ...f,
        status: isDone ? "ready" : isFailed ? "error" : job.status as FileEntry["status"],
        progress: job.progress,
        stage: isDone
          ? "已索引"
          : isFailed
            ? (job.error ?? "处理失败")
            : stageLabel(job.currentStage),
        ingestionDetail: (isDone || isFailed) ? {
          chunksTotal: job.chunksTotal,
          durationMs: job.startedAt && job.finishedAt
            ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()
            : 0,
          error: job.error,
        } : f.ingestionDetail,
        // 即便还在处理中也持续合并 stageOutputs（已完成的 stage 提前可见）
        stageOutputs: job.stageOutputs ?? f.stageOutputs ?? {},
      };
    }));
  }, []);

  const pollIngestion = useCallback((jobId: string, docId: string) => {
    if (!projectId || pollingRef.current.has(jobId)) return;
    pollingRef.current.add(jobId);

    const doCheck = async () => {
      try {
        const { job } = await documentsApi.getIngestionJob(projectId, jobId);
        updateFileFromJob(docId, jobId, job);
        return job.status === "completed" || job.status === "failed";
      } catch {
        return false;
      }
    };

    // 首次 200ms 后立刻检查（ingestion 小文件可能<200ms 就完成）
    const firstTimeout = setTimeout(async () => {
      const done = await doCheck();
      if (done) {
        pollingRef.current.delete(jobId);
        return;
      }
      // 未完成 → 每 2s 继续轮询
      const timer = setInterval(async () => {
        const finished = await doCheck();
        if (finished) {
          clearInterval(timer);
          pollingRef.current.delete(jobId);
        }
      }, 2000);
    }, 200);

    return () => {
      clearTimeout(firstTimeout);
      pollingRef.current.delete(jobId);
    };
  }, [projectId, updateFileFromJob]);

  // ── 加载文档列表 + ingestion jobs（获取 chunks / 耗时） ───────────────────

  /**
   * 初始加载：并行拉文档列表 + ingestion jobs 索引，组合成 FileEntry 数组。
   * 修复 lint react-hooks/set-state-in-effect：把 useCallback 内联进 useEffect，
   * 配合 cancelled 标记防止 strict-mode 双调用 / 切项目时写过期数据。
   */
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const [docsRes, jobsRes] = await Promise.all([
          documentsApi.listDocuments(projectId),
          documentsApi.listIngestionJobs(projectId).catch(() => ({ jobs: [] as IngestionJob[] })),
        ]);
        if (cancelled) return;

        // 按 documentId 建立 job 索引（取每个 document 最新的 job）
        const jobByDocId = new Map<string, IngestionJob>();
        for (const job of jobsRes.jobs) {
          const existing = jobByDocId.get(job.documentId);
          if (!existing || new Date(job.createdAt) > new Date(existing.createdAt)) {
            jobByDocId.set(job.documentId, job);
          }
        }

        setFiles(docsRes.documents.map((d: MvpDocument) => {
          const job = jobByDocId.get(d.id);
          const isDone = job?.status === "completed";
          const isFailed = job?.status === "failed";

          return {
            id: d.id,
            name: d.fileName,
            size: formatSize(d.fileSize),
            category: d.category,
            status: d.processingStatus,
            progress: d.processingStatus === "ready" ? 100 : (job?.progress ?? 0),
            stage: d.processingStatus === "ready"
              ? "已索引"
              : d.processingStatus === "error"
                ? (job?.error ?? "处理失败")
                : stageLabel(job?.currentStage ?? null),
            ingestionJobId: job?.id ?? null,
            ingestionDetail: (isDone || isFailed) ? {
              chunksTotal: job!.chunksTotal,
              durationMs: job!.startedAt && job!.finishedAt
                ? new Date(job!.finishedAt).getTime() - new Date(job!.startedAt).getTime()
                : 0,
              error: job!.error,
            } : null,
            stageOutputs: job?.stageOutputs ?? {},
          };
        }));

        // 如果有还在处理中的 job，启动轮询
        for (const [docId, job] of jobByDocId) {
          if (job.status === "processing" || job.status === "queued") {
            pollIngestion(job.id, docId);
          }
        }
      } catch {
        // 静默——文档列表拉失败不阻塞上传流程
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, pollIngestion]);

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
        ingestionDetail: null,
        stageOutputs: {},
      };
      setFiles(prev => [entry, ...prev]);

      try {
        const { document: doc, ingestionJobId } = await documentsApi.uploadDocument(
          projectId, file, category,
        );
        setFiles(prev => prev.map(f =>
          f.id === tempId
            ? { ...f, id: doc.id, status: "queued", progress: 0, stage: "排队中", ingestionJobId }
            : f,
        ));
        pollIngestion(ingestionJobId, doc.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "上传失败";
        setFiles(prev => prev.map(f =>
          f.id === tempId
            ? { ...f, status: "error", stage: msg }
            : f,
        ));
        toast.error(`${file.name} 上传失败：${msg}`);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    handleFileSelect(e.dataTransfer.files);
  };

  // ── 删除处理（带二次确认） ────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!projectId || !deleteTarget) return;
    const fileId = deleteTarget.id;
    setDeleteTarget(null);

    if (fileId.startsWith("temp-")) {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      return;
    }
    try {
      await documentsApi.deleteDocument(projectId, fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      toast.info("文档已删除");
    } catch (err) {
      toast.error(err instanceof Error ? `删除失败：${err.message}` : "删除失败");
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
                Ingestion: 去重校验 → 文档解析 → 文本分块 → 向量化 → 写入索引
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
                    // 处理中自动展开看流程；done/error 时按用户手动 toggle
                    const hasOutputs = Object.keys(f.stageOutputs).length > 0;
                    const showPanel = hasOutputs && (isProcessing || expanded.has(f.id));
                    return (
                      <div key={f.id} className="px-4 py-3"
                           style={{ borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}>
                        <div className="flex items-center gap-3">
                        {/* 文件图标 */}
                        <span className="w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-none text-[11px] font-bold mono"
                              style={{ background: extStyle.bg, color: extStyle.color }}>
                          {ext}
                        </span>

                        {/* 文件信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <div className="text-[13.5px] font-semibold truncate">{f.name}</div>
                            <div className="text-[11px] mono" style={{ color: "var(--ink-4)" }}>{f.size}</div>
                          </div>

                          {/* 进度条（处理中） */}
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
                            /* 错误状态 */
                            <div className="text-[11.5px] mt-[3px] flex items-center gap-1" style={{ color: "var(--err)" }}>
                              <X size={11} strokeWidth={2.5} />
                              <span>{f.stage}</span>
                              {f.ingestionDetail?.chunksTotal != null && (
                                <span className="ml-2 mono" style={{ color: "var(--ink-4)" }}>
                                  {f.ingestionDetail.chunksTotal} chunks · {f.ingestionDetail.durationMs}ms
                                </span>
                              )}
                            </div>
                          ) : (
                            /* 已完成 */
                            <div className="text-[11.5px] mt-[3px] flex items-center gap-1.5" style={{ color: "var(--ink-3)" }}>
                              <Check size={11} strokeWidth={2.5} style={{ color: "var(--ok)" }} />
                              <span>已索引</span>
                              {f.ingestionDetail && (
                                <span className="mono" style={{ color: "var(--ink-4)" }}>
                                  · {f.ingestionDetail.chunksTotal} chunks · {f.ingestionDetail.durationMs}ms
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* 右侧状态图标 */}
                        {f.status === "ready" && (
                          <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-none"
                                style={{ background: "var(--ok)", color: "#fff" }}>
                            <Check size={12} strokeWidth={2.5} />
                          </span>
                        )}
                        {isProcessing && (
                          <span className="w-[22px] h-[22px] rounded-full flex-none"
                                style={{ border: "2.5px solid rgba(79,168,154,.22)", borderTopColor: "var(--brand)", animation: "spin .9s linear infinite" }} />
                        )}

                        {/* 展开 stage 输出（仅 ready/error 且 hasOutputs 时显示按钮） */}
                        {hasOutputs && !isProcessing && (
                          <button
                            className="w-7 h-7 rounded-md flex items-center justify-center flex-none
                                       opacity-50 hover:opacity-100 hover:bg-[rgba(11,17,32,.04)] transition-all"
                            onClick={() => toggleExpanded(f.id)}
                            title={expanded.has(f.id) ? "收起阶段输出" : "查看阶段输出"}
                          >
                            {expanded.has(f.id)
                              ? <ChevronDown size={14} strokeWidth={1.8} style={{ color: "var(--ink-3)" }} />
                              : <ChevronRight size={14} strokeWidth={1.8} style={{ color: "var(--ink-3)" }} />}
                          </button>
                        )}

                        {/* 删除按钮 — X icon */}
                        <button
                          className="w-7 h-7 rounded-md flex items-center justify-center flex-none
                                     opacity-40 hover:opacity-100 hover:bg-[rgba(179,38,30,.06)] transition-all"
                          onClick={() => setDeleteTarget({ id: f.id, name: f.name })}
                          title="删除文件"
                        >
                          <X size={14} strokeWidth={1.8} style={{ color: "var(--err)" }} />
                        </button>
                        </div>
                        {showPanel && <StageOutputsPanel outputs={f.stageOutputs} />}
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

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <ConfirmDeleteDialog
          fileName={deleteTarget.name}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </main>
  );
}
