/**
 * SaveSegmentsList — feat-200.7 UX 改进
 *
 * 把 LLM 输出按"卖点 / 笔记 / 标题段"切片，让用户能**单独**保存其中一段为笔记，
 * 而不是只能一次性保存整段内容。
 *
 * UI 设计：
 *   - 默认折叠（一行摘要）："📌 共 N 段可单独保存｜展开"；
 *   - 展开后逐段列出：标题 + 1-2 行 preview + 行末"保存此段"按钮；
 *   - 与"保存全部"按钮（AddToLibraryButton）并列，二选其一即可。
 *
 * 不在范围内（Phase 4）：批量勾选保存、跨片段合并保存。
 */

"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { splitMarkdownSegments } from "@/lib/markdown-segments";
import { AddToLibraryButton } from "./AddToLibraryButton";

interface Props {
  generationId: string | null;
  content: string;
}

export function SaveSegmentsList({ generationId, content }: Props) {
  const segments = splitMarkdownSegments(content);
  const [open, setOpen] = useState(false);

  // 只有 1 段说明拆不开，按"保存全部"逻辑走即可，本组件不渲染
  if (segments.length <= 1) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] font-medium"
        style={{ color: "var(--brand)" }}
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        📌 共 {segments.length} 段可单独保存 · {open ? "点击收起" : "点击展开"}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {segments.map((seg, idx) => (
            <div
              key={idx}
              className="rounded-md p-2.5"
              style={{
                background: "rgba(11,17,32,.02)",
                border: "1px solid var(--line-2)",
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText size={11} strokeWidth={1.8}
                            style={{ color: "var(--ink-3)", flex: "none" }} />
                  <span className="text-[12px] font-semibold truncate"
                        style={{ color: "var(--ink)" }}>
                    {idx + 1}. {seg.title}
                  </span>
                </div>
                <AddToLibraryButton
                  generationId={generationId}
                  content={seg.body}
                  titleSeed={seg.title}
                  compact
                />
              </div>
              <div className="text-[11.5px] leading-[1.6] line-clamp-2"
                   style={{ color: "var(--ink-3)" }}>
                {/* preview 用纯文本不渲染 markdown，紧凑 */}
                {seg.body.replace(/^#+\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1")
                         .replace(/\n+/g, " ").slice(0, 200)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
