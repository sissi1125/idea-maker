/**
 * AddToLibraryButton — feat-200.7 Week 7
 *
 * 把当前 generation 结果（或修改后的版本）保存到笔记库。
 *
 * 弹一个轻量内联表单：title（默认从 query 截前 30 字符）+ tags（逗号分隔）。
 * content 直接用传入的 content prop，用户不在这里编辑（在 Chat / History 的反馈面板编辑过）。
 *
 * 状态机：idle → editing → saving → saved（3s 后回 idle）
 *                       ↘ error
 */

"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { BookmarkPlus, X, Check, AlertCircle } from "lucide-react";
import { notesApi } from "@/lib/api";

interface Props {
  /** 关联的 generation id（可选，独立创建笔记时为 null） */
  generationId: string | null;
  /** 笔记正文 */
  content: string;
  /** 默认标题种子（如 query），保存时 fallback */
  titleSeed?: string;
  /** 紧凑模式：button 只显示图标 */
  compact?: boolean;
}

export function AddToLibraryButton({ generationId, content, titleSeed, compact }: Props) {
  const { id: projectId } = useParams<{ id: string }>();
  const [phase, setPhase] = useState<"idle" | "editing" | "saving" | "saved" | "error">("idle");
  const [title, setTitle] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setTitle((titleSeed ?? "未命名笔记").slice(0, 30));
    setTagsRaw("");
    setError(null);
    setPhase("editing");
  };
  const close = () => { setPhase("idle"); setError(null); };

  const save = async () => {
    if (!projectId || !title.trim()) return;
    setPhase("saving");
    setError(null);
    try {
      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);
      await notesApi.createNote(projectId, {
        generationId, title: title.trim(), content, tags,
      });
      setPhase("saved");
      setTimeout(() => setPhase("idle"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setPhase("error");
    }
  };

  if (phase === "idle" || phase === "saved") {
    const label = phase === "saved" ? "已保存到笔记库" : "保存到笔记库";
    const Icon = phase === "saved" ? Check : BookmarkPlus;
    return (
      <button
        type="button"
        onClick={open}
        disabled={phase === "saved"}
        className="btn btn-sm btn-ghost"
        style={{
          color: phase === "saved" ? "var(--ok)" : "var(--ink-3)",
          opacity: phase === "saved" ? 1 : undefined,
        }}
        title={label}
      >
        <Icon size={12} strokeWidth={2} />
        {!compact && label}
      </button>
    );
  }

  // editing / saving / error 共享表单 UI
  return (
    <div className="rounded-md p-3 mt-2 flex flex-col gap-2"
         style={{ background: "rgba(79,168,154,.05)", border: "1px solid rgba(79,168,154,.2)" }}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium" style={{ color: "var(--brand)" }}>
          保存到笔记库
        </div>
        <button type="button" onClick={close} className="btn btn-sm btn-ghost"
                style={{ color: "var(--ink-4)" }} title="取消">
          <X size={12} />
        </button>
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="笔记标题"
        maxLength={200}
        disabled={phase === "saving"}
        className="rounded-md px-2 py-1.5 text-[13px]"
        style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
      />
      <input
        type="text"
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="标签（逗号分隔，可选）"
        disabled={phase === "saving"}
        className="rounded-md px-2 py-1.5 text-[12px]"
        style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink-2)" }}
      />
      {error && (
        <div className="flex items-center gap-1 text-[11.5px]" style={{ color: "var(--err)" }}>
          <AlertCircle size={11} /> {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={close} className="btn btn-sm btn-ghost"
                style={{ color: "var(--ink-3)" }}>
          取消
        </button>
        <button type="button" onClick={save}
                disabled={!title.trim() || phase === "saving"}
                className="btn btn-sm btn-primary"
                style={{ opacity: !title.trim() || phase === "saving" ? 0.5 : 1 }}>
          {phase === "saving" ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
