/**
 * GenerationEditor — feat-200.7 Week 7
 *
 * 用户编辑生成结果，保存进 feedback.edit_diff。
 *
 * 实现说明：
 *   - 不做行级 diff 渲染（react-diff-viewer 是 50KB+ 依赖，MVP 不引入）；
 *   - 只展示"原始 / 编辑后"两份并列文本——肉眼对比就够；
 *   - 提交时父组件把 textarea 当前内容传给 submitFeedback({ editDiff })。
 *
 * 为什么字段叫 editDiff 而不是 editedContent：
 *   产品语义上"用户的修改"才是反馈信号；运营拿这个去对比 LLM 原文做训练数据。
 *   字段名跟数据库列保持一致，避免一层重命名映射。
 */

"use client";

import { useState } from "react";
import { Edit3, Check, X } from "lucide-react";

interface Props {
  original: string;
  /** 当前编辑内容；null 表示用户尚未启动编辑（仍显示原文） */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

export function GenerationEditor({ original, value, onChange, disabled }: Props) {
  const [expanded, setExpanded] = useState(false);

  const handleStart = () => {
    setExpanded(true);
    if (value == null) onChange(original);
  };

  const handleCancel = () => {
    setExpanded(false);
    onChange(null);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={handleStart}
        className="btn btn-sm btn-ghost"
        style={{ color: "var(--ink-3)", opacity: disabled ? 0.5 : 1 }}
      >
        <Edit3 size={12} strokeWidth={1.8} />
        {value != null ? "已修改，继续编辑" : "修改生成结果"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium" style={{ color: "var(--ink)" }}>
          修改生成结果
        </div>
        <button
          type="button"
          onClick={handleCancel}
          className="btn btn-sm btn-ghost"
          style={{ color: "var(--ink-4)" }}
          title="放弃修改"
        >
          <X size={12} strokeWidth={1.8} /> 放弃
        </button>
      </div>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={8}
        className="w-full rounded-lg p-3 text-[13px] leading-[1.7] resize-y"
        style={{
          border: "1px solid var(--line)",
          background: "#fff",
          color: "var(--ink)",
          fontFamily: "inherit",
          minHeight: "100px",
        }}
        placeholder="在原文基础上做你的修改…保存后将作为反馈数据保留"
      />
      {value != null && value !== original && (
        <div className="text-[11px] flex items-center gap-1.5"
             style={{ color: "var(--brand)" }}>
          <Check size={11} strokeWidth={2} />
          已修改 ({value.length} 字符 vs 原 {original.length} 字符)
        </div>
      )}
    </div>
  );
}
