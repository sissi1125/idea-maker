/**
 * Markdown — feat-200.7 UX 改进
 *
 * 把 LLM 输出的 markdown 文本渲染成富文本，而不是显示 `**` `-` 等原始符号。
 *
 * 选 react-markdown + remark-gfm：
 *   - 标准、活跃维护、安全（不执行 HTML）
 *   - 体积 ~30KB gzip，可接受
 *   - GFM 支持表格 / 任务列表 / 删除线，LLM 输出常用
 *
 * 自定义渲染器只覆盖少数节点的 className——保持项目设计语言一致，
 * 不引入 prose 默认样式（避免覆盖项目色板）。
 *
 * 安全：react-markdown 默认禁用 raw HTML，纯文本入参不需要额外 sanitize。
 */

"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface EvidenceItem {
  text: string;
  sourceRef?: string;
}

interface Props {
  content: string;
  /** 可选 className，作用在外层包装 div 上 */
  className?: string;
  /**
   * 按 1-based 顺序的 evidence 池。若提供，内容里的 [evidence-NNN] 占位符会被
   * 渲染成可点小按钮，hover/click 弹层显示对应原文；未提供则保留占位符原样。
   */
  evidence?: EvidenceItem[];
}

/**
 * 预处理：把 [evidence-NNN] 替换成 markdown 链接 [N](evidence://N)，
 * 走 react-markdown 标准链接节点，自定义 a 渲染器认 evidence:// scheme 即可
 * 渲染成按钮——避免自己写完整的 remark 插件。
 */
function preprocessEvidence(content: string, evidenceCount: number): string {
  if (evidenceCount === 0) return content;
  return content.replace(/\[evidence-(\d+)\]/gi, (_, numStr: string) => {
    const idx = parseInt(numStr, 10);
    if (idx < 1 || idx > evidenceCount) return ""; // 越界标号直接抹掉
    return `[${idx}](evidence://${idx})`;
  });
}

export function Markdown({ content, className, evidence }: Props) {
  const evidenceList = evidence ?? [];
  const processed = preprocessEvidence(content, evidenceList.length);

  return (
    <div className={`md ${className ?? ""}`}
         style={{ color: "var(--ink)", lineHeight: 1.7, fontSize: "13.5px" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 段落：保留行距，不要 Tailwind preflight margin 太大
          p: ({ children }) => (
            <p style={{ margin: "0.6em 0" }}>{children}</p>
          ),
          // h1-h3：层级 + 行内分隔
          h1: ({ children }) => (
            <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "1em 0 0.4em",
                         color: "var(--ink)" }}>{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0.9em 0 0.35em",
                         color: "var(--ink)" }}>{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 style={{ fontSize: "14px", fontWeight: 600, margin: "0.8em 0 0.3em",
                         color: "var(--ink)" }}>{children}</h4>
          ),
          // 无序列表
          ul: ({ children }) => (
            <ul style={{ paddingLeft: "1.4em", margin: "0.4em 0",
                         listStyleType: "disc" }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ paddingLeft: "1.4em", margin: "0.4em 0",
                         listStyleType: "decimal" }}>{children}</ol>
          ),
          li: ({ children }) => <li style={{ margin: "0.2em 0" }}>{children}</li>,
          // 加粗 / 斜体
          strong: ({ children }) => (
            <strong style={{ fontWeight: 600, color: "var(--ink)" }}>{children}</strong>
          ),
          em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
          // 行内代码 + 引用块
          code: ({ children }) => (
            <code style={{
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: "12.5px",
              background: "rgba(11,17,32,.05)",
              padding: "1px 5px",
              borderRadius: "4px",
              color: "var(--ink)",
            }}>{children}</code>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: "3px solid var(--line-strong)",
              paddingLeft: "12px",
              margin: "0.6em 0",
              color: "var(--ink-2)",
              fontStyle: "italic",
            }}>{children}</blockquote>
          ),
          // 链接：识别 evidence:// scheme，渲染成可点小按钮（hover 弹原文）；
          // 普通链接照常新标签打开
          a: ({ children, href }) => {
            if (href && href.startsWith("evidence://")) {
              const idx = parseInt(href.slice("evidence://".length), 10);
              const item = evidenceList[idx - 1];
              if (!item) return null;
              return <EvidenceButton index={idx} item={item} />;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                 style={{ color: "var(--brand)", textDecoration: "underline" }}>
                {children}
              </a>
            );
          },
          // 表格基础样式（GFM）
          table: ({ children }) => (
            <table style={{
              borderCollapse: "collapse",
              margin: "0.8em 0",
              fontSize: "12.5px",
            }}>{children}</table>
          ),
          th: ({ children }) => (
            <th style={{
              border: "1px solid var(--line-2)",
              padding: "5px 9px",
              background: "rgba(11,17,32,.03)",
              textAlign: "left",
              fontWeight: 600,
            }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ border: "1px solid var(--line-2)", padding: "5px 9px" }}>{children}</td>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Evidence 小按钮 — hover 或 click 弹出原文 popover。
 *
 * 设计选择：
 *   - hover 触发 = 桌面端友好，移动端 click 触发也支持（onClick 切换 sticky 状态）
 *   - popover 用绝对定位 + transform 居中，不引入 floating-ui 等依赖
 *   - 文本最多展示 600 字（超长截断 + …），太长的 chunk 自然要去原文档看
 *   - z-index 30 高于卡片内滚动条但低于全局 modal（AgentContextPanel 等用 50）
 */
function EvidenceButton({ index, item }: { index: number; item: EvidenceItem }) {
  const [open, setOpen] = useState(false);
  const MAX_CHARS = 600;
  const display =
    item.text.length > MAX_CHARS ? item.text.slice(0, MAX_CHARS) + "…" : item.text;

  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "18px",
          height: "16px",
          padding: "0 5px",
          margin: "0 2px",
          fontSize: "10.5px",
          fontWeight: 600,
          lineHeight: 1,
          color: "var(--brand)",
          background: "var(--brand-soft)",
          border: "1px solid color-mix(in srgb, var(--brand) 28%, transparent)",
          borderRadius: "9px",
          cursor: "pointer",
          verticalAlign: "middle",
        }}
        title="点击查看原文依据"
      >
        {index}
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            width: "320px",
            maxWidth: "92vw",
            padding: "10px 12px",
            fontSize: "12px",
            lineHeight: 1.55,
            color: "var(--ink)",
            background: "#fff",
            border: "1px solid var(--line-strong)",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(11,17,32,.18)",
            whiteSpace: "normal",
            textAlign: "left",
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: "10.5px",
              fontWeight: 600,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              marginBottom: "4px",
            }}
          >
            evidence-{String(index).padStart(3, "0")}
            {item.sourceRef && (
              <span style={{ marginLeft: "6px", color: "var(--ink-3)", textTransform: "none", letterSpacing: 0 }}>
                · {item.sourceRef}
              </span>
            )}
          </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{display}</span>
        </span>
      )}
    </span>
  );
}
