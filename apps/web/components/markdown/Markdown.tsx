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

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
  /** 可选 className，作用在外层包装 div 上 */
  className?: string;
}

export function Markdown({ content, className }: Props) {
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
          // 链接：新标签打开，避免离开应用
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
               style={{ color: "var(--brand)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
