/**
 * 笔记库页面 — feat-200.7 Week 7
 *
 * 路由：/projects/[id]/notes
 * 数据：notesApi.listNotes（limit+offset）
 *
 * UI 设计：
 *   - 列表卡片：title + 1-2 行内容预览 + tags + 编辑/删除按钮
 *   - 点击卡片展开：完整 content（whitespace-pre-wrap）+ 可编辑模式
 *   - 不在范围内：tag 过滤、全文搜索、批量操作（Phase 4 再做）
 *
 * 与 history 页的区别：
 *   history 是事实记录（所有 generations），notes 是用户筛选过的"精品库"。
 *   保存到笔记库的动作发生在 chat / history 的生成卡里（AddToLibraryButton）。
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  BookOpen, Trash2, Edit3, Check, X, Tag, ExternalLink, AlertCircle,
} from "lucide-react";
import { notesApi } from "@/lib/api";
import type { Note, UpdateNoteInput } from "@/lib/api";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { Markdown } from "@/components/markdown/Markdown";
import { useToast } from "@/components/toast/ToastProvider";

function NoteCard({
  note,
  onUpdate,
  onDelete,
}: {
  note: Note;
  onUpdate: (id: string, input: UpdateNoteInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tagsRaw, setTagsRaw] = useState(note.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setEditing(false);
    setTitle(note.title);
    setContent(note.content);
    setTagsRaw(note.tags.join(", "));
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);
      // 只提交真正变了的字段——也避免空字符串覆盖
      const patch: UpdateNoteInput = {};
      if (title !== note.title) patch.title = title;
      if (content !== note.content) patch.content = content;
      if (JSON.stringify(tags) !== JSON.stringify(note.tags)) patch.tags = tags;
      if (Object.keys(patch).length === 0) {
        setEditing(false);
        return;
      }
      await onUpdate(note.id, patch);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const created = new Date(note.createdAt).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  if (editing) {
    return (
      <div className="card p-4 mb-3" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex flex-col gap-2.5">
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="标题" disabled={saving} maxLength={200}
            className="rounded-md px-2.5 py-1.5 text-[14px] font-semibold"
            style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
          />
          <textarea
            value={content} onChange={(e) => setContent(e.target.value)}
            disabled={saving} rows={6}
            className="rounded-md px-2.5 py-2 text-[13px] leading-[1.65] resize-y"
            style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)",
                     fontFamily: "inherit", minHeight: "120px" }}
          />
          <input
            type="text" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="标签（逗号分隔）" disabled={saving}
            className="rounded-md px-2.5 py-1.5 text-[12px]"
            style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink-2)" }}
          />
          {error && (
            <div className="flex items-center gap-1 text-[12px]" style={{ color: "var(--err)" }}>
              <AlertCircle size={11} /> {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={cancel} className="btn btn-sm btn-ghost"
                    style={{ color: "var(--ink-3)" }}>
              <X size={12} /> 取消
            </button>
            <button type="button" onClick={save} disabled={saving || !title.trim()}
                    className="btn btn-sm btn-primary"
                    style={{ opacity: !title.trim() || saving ? 0.5 : 1 }}>
              <Check size={12} /> {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 mb-3" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>
            {note.title}
          </div>
          <div className="text-[10.5px] mt-0.5 mono flex items-center gap-2"
               style={{ color: "var(--ink-4)" }}>
            <span>{created}</span>
            {note.generationId && (
              <span className="inline-flex items-center gap-0.5">
                <ExternalLink size={9} strokeWidth={2} />
                来自 generation {note.generationId.slice(0, 8)}
              </span>
            )}
          </div>
        </div>
        <div className="flex-none flex items-center gap-1">
          <button type="button" onClick={() => setEditing(true)}
                  className="btn btn-sm btn-ghost" title="编辑"
                  style={{ color: "var(--ink-3)" }}>
            <Edit3 size={12} strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)}
                  className="btn btn-sm btn-ghost" title="删除"
                  style={{ color: "var(--err)", opacity: 0.7 }}>
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div style={{ maxHeight: "22em", overflowY: "auto", paddingRight: 4 }}>
        <Markdown content={note.content} />
      </div>
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3"
             style={{ borderTop: "1px solid var(--line-2)" }}>
          {note.tags.map(tag => (
            <span key={tag} className="chip text-[11px] inline-flex items-center gap-0.5"
                  style={{ background: "rgba(11,17,32,.04)", color: "var(--ink-3)" }}>
              <Tag size={9} strokeWidth={2} /> {tag}
            </span>
          ))}
        </div>
      )}

      {/* 删除确认行内提示——避免 modal 打断浏览节奏 */}
      {confirmDelete && (
        <div className="mt-3 rounded-md px-3 py-2 flex items-center justify-between"
             style={{ background: "rgba(179,38,30,.05)", border: "1px solid rgba(179,38,30,.18)" }}>
          <span className="text-[12px]" style={{ color: "var(--err)" }}>
            确认删除 &ldquo;{note.title}&rdquo; ？此操作不可恢复
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setConfirmDelete(false)}
                    className="btn btn-sm btn-ghost" style={{ color: "var(--ink-3)" }}>
              取消
            </button>
            <button type="button" onClick={async () => {
              await onDelete(note.id);
              setConfirmDelete(false);
            }} className="btn btn-sm"
                    style={{ background: "var(--err)", color: "#fff", border: "1px solid var(--err)" }}>
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NotesPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const toast = useToast();
  const { currentProject: getCurrent, setCurrentProject } = useProjectsStore();
  const project = getCurrent();

  const [notes, setNotes] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  // 初次加载
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await notesApi.listNotes(projectId, { limit: 100 });
        if (cancelled) return;
        setNotes(res.notes);
        setTotal(res.total);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const handleUpdate = useCallback(
    async (id: string, input: UpdateNoteInput) => {
      if (!projectId) return;
      try {
        const { note } = await notesApi.updateNote(projectId, id, input);
        setNotes((prev) => prev.map((n) => (n.id === id ? note : n)));
        toast.success("笔记已更新");
      } catch (err) {
        toast.error(err instanceof Error ? `更新失败：${err.message}` : "更新失败");
        throw err;
      }
    },
    [projectId, toast],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!projectId) return;
      try {
        await notesApi.deleteNote(projectId, id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setTotal((t) => Math.max(0, t - 1));
        toast.info("笔记已删除");
      } catch (err) {
        toast.error(err instanceof Error ? `删除失败：${err.message}` : "删除失败");
        throw err;
      }
    },
    [projectId, toast],
  );

  return (
    <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
      <div className="page-shell max-w-[920px]">
        <div className="mb-4">
          <div className="flex items-center gap-2 page-title"
               style={{ color: "var(--ink)" }}>
            <BookOpen size={20} strokeWidth={1.8} />
            笔记库
          </div>
          <div className="text-[13px] mt-0.5" style={{ color: "var(--ink-3)" }}>
            {project?.name ?? "项目"} · 共 {total} 条笔记 · 从对话或历史页 &ldquo;保存到笔记库&rdquo;
          </div>
        </div>

        {error && (
          <div className="rounded-md p-3 mb-3 text-[12.5px] flex items-center gap-1.5"
               style={{ background: "rgba(179,38,30,.06)", color: "var(--err)" }}>
            <AlertCircle size={12} /> {error}
          </div>
        )}

        {loading ? (
          <div className="text-[13px] text-center py-12" style={{ color: "var(--ink-4)" }}>
            加载中…
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen size={40} strokeWidth={1.4} style={{ color: "var(--ink-4)", margin: "0 auto 12px" }} />
            <div className="text-[14px] mb-1" style={{ color: "var(--ink-2)" }}>
              笔记库还是空的
            </div>
            <div className="text-[12px]" style={{ color: "var(--ink-4)" }}>
              在 Chat 主页或历史页生成一段内容后，点击 &ldquo;保存到笔记库&rdquo; 即可建立你的内容资产
            </div>
          </div>
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </main>
  );
}
