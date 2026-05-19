"use client";

import { useState } from "react";

/** 单个字符串字段超过此长度时折叠展示，防止大文件撑爆 DOM */
export const STRING_TRUNCATE = 500;
/** number[] 长度超过此阈值时视为向量，替换为摘要对象（避免展开时卡死浏览器） */
export const VECTOR_THRESHOLD = 16;

/**
 * 递归遍历 output/trace 对象，对两类大型数据做懒加载替换：
 * 1. 超长字符串 → { __truncated, preview, full, totalChars }
 * 2. 大型纯数字数组（embedding 向量）→ { __vector, dimension, preview, full }
 * 返回新对象，原始数据不被修改。
 */
export function truncateStrings(value: unknown, maxLen = STRING_TRUNCATE): unknown {
  if (typeof value === "string") {
    return value.length > maxLen
      ? { __truncated: true, preview: value.slice(0, maxLen), full: value, totalChars: value.length }
      : value;
  }
  // 大型纯数字数组 → 向量摘要（不递归展开，避免 JSON.stringify 拖慢页面）
  if (
    Array.isArray(value) &&
    value.length > VECTOR_THRESHOLD &&
    (value as unknown[]).every((v) => typeof v === "number")
  ) {
    return {
      __vector: true,
      dimension: value.length,
      preview: (value as number[]).slice(0, 6),
      full: value,
    };
  }
  if (Array.isArray(value)) return value.map((v) => truncateStrings(v, maxLen));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, truncateStrings(v, maxLen)])
    );
  }
  return value;
}

/**
 * JSON.stringify replacer：将 __vector 标记对象里的 full 字段替换为占位符。
 * 防止展开嵌套数组时把完整 embedding 数组（千维 number[]）序列化成巨型字符串导致浏览器崩溃。
 * VectorSummary 组件自身持有 full 引用，不受此影响。
 */
export function vectorReplacer(_key: string, val: unknown): unknown {
  if (
    val !== null &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    (val as Record<string, unknown>).__vector === true
  ) {
    const { full: _full, ...summary } = val as Record<string, unknown>;
    return { ...summary, full: `[…${summary.dimension} 维，点击上方 VectorSummary 展开]` };
  }
  return val;
}

/**
 * 自定义 JSON 渲染器。
 * 识别 __truncated / __vector 标记，分别做懒展开处理。
 * 其他值直接用 JSON.stringify 渲染。
 */
export function JsonView({ value }: { value: unknown }) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // 被 truncateStrings 标记为截断的字符串
    if (obj.__truncated === true) {
      return <TruncatedString preview={obj.preview as string} full={obj.full as string} totalChars={obj.totalChars as number} />;
    }

    // 向量摘要（大型 number[]）
    if (obj.__vector === true) {
      return <VectorSummary dimension={obj.dimension as number} preview={obj.preview as number[]} full={obj.full as number[]} />;
    }

    // 普通对象：递归渲染每个 key
    return (
      <div className="px-4 py-3 text-[10px] font-mono text-zinc-700 space-y-1 overflow-x-auto">
        {"{"}
        {Object.entries(obj).map(([k, v]) => (
          <div key={k} className="pl-3">
            <span className="text-purple-600">&quot;{k}&quot;</span>
            <span className="text-zinc-400">: </span>
            <JsonValue value={v} />
          </div>
        ))}
        {"}"}
      </div>
    );
  }

  // 数组或原始值
  return (
    <pre className="px-4 py-3 text-[10px] font-mono text-zinc-700 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** 递归渲染单个值（用于对象字段值） */
export function JsonValue({ value }: { value: unknown }): React.ReactNode {
  if (value === null) return <span className="text-zinc-400">null</span>;
  if (typeof value === "boolean") return <span className="text-blue-600">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-amber-600">{value}</span>;
  if (typeof value === "string") return <span className="text-green-700">&quot;{value}&quot;</span>;

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.__truncated === true) {
      return <TruncatedString preview={obj.preview as string} full={obj.full as string} totalChars={obj.totalChars as number} />;
    }
    if (obj.__vector === true) {
      return <VectorSummary dimension={obj.dimension as number} preview={obj.preview as number[]} full={obj.full as number[]} />;
    }
    // 嵌套对象：用折叠的 JSON.stringify
    return <CollapsibleJson value={value} />;
  }

  if (Array.isArray(value)) {
    return <CollapsibleJson value={value} />;
  }

  return <span>{JSON.stringify(value)}</span>;
}

/** 可折叠的 JSON 块，用于嵌套对象/数组 */
function CollapsibleJson({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const preview = Array.isArray(value) ? `[…${(value as unknown[]).length} items]` : "{…}";
  return (
    <span>
      <button onClick={() => setOpen((v) => !v)} className="text-zinc-400 hover:text-zinc-600 underline underline-offset-2">
        {open ? "▾" : "▸"} {preview}
      </button>
      {open && (
        <pre className="mt-1 ml-2 text-[10px] font-mono text-zinc-600 whitespace-pre-wrap break-all">
          {JSON.stringify(value, vectorReplacer, 2)}
        </pre>
      )}
    </span>
  );
}

/**
 * 向量摘要组件：默认显示维度 + 前几个分量，点击展开后懒加载渲染完整向量。
 * 避免直接 JSON.stringify 大数组导致浏览器卡死。
 */
export function VectorSummary({ dimension, preview, full }: { dimension: number; preview: number[]; full: number[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="inline-block w-full">
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[9px] font-medium text-violet-600">
          向量 [{dimension} 维]
        </span>
        <span className="text-amber-600 text-[10px]">
          [{preview.map((v) => v.toFixed(4)).join(", ")}{dimension > preview.length ? ", …" : ""}]
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[9px] text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded px-1 py-0.5"
        >
          {expanded ? "折叠" : "展开全部"}
        </button>
      </span>
      {expanded && (
        <pre className="mt-1 ml-2 text-[10px] font-mono text-zinc-500 whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto">
          [{full.map((v) => v.toFixed(6)).join(", ")}]
        </pre>
      )}
    </span>
  );
}

/** 截断字符串展示组件：默认显示前 N 字符 + 展开按钮 */
export function TruncatedString({ preview, full, totalChars }: { preview: string; full: string; totalChars: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="inline-block w-full">
      <span className="text-green-700 whitespace-pre-wrap break-all">
        &quot;{expanded ? full : preview}&quot;
      </span>
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="ml-1 text-[9px] text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded px-1 py-0.5"
        >
          …展开（共 {totalChars.toLocaleString()} 字符）
        </button>
      )}
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="ml-1 text-[9px] text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded px-1 py-0.5"
        >
          折叠
        </button>
      )}
    </span>
  );
}
