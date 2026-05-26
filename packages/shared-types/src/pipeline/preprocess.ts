import { z } from "zod";

/**
 * 文档预处理 - 共享类型定义
 *
 * 5 种 method 各自的依赖：
 *   markdown-structure  纯 JS（rag-core 内）
 *   plain-text          纯 JS
 *   markitdown          mammoth + turndown + pdf-parse 路由分派
 *   pdf-pages           pdf-parse 按页拆分
 *   pymupdf             ⚠ 调外部 Python 微服务，URL 通过 Input 注入
 */

export const PreprocessMethodId = z.enum([
  "markdown-structure",
  "plain-text",
  "markitdown",
  "pdf-pages",
  "pymupdf",
]);
export type PreprocessMethodId = z.infer<typeof PreprocessMethodId>;

export const PreprocessParamsSchema = z.object({
  preserveHeadings: z.boolean().optional().default(true),
  preserveTables: z.boolean().optional().default(true),
  removeBoilerplate: z.boolean().optional().default(false),
  maxChars: z.number().int().min(0).optional().default(0),
  pdfPageRange: z.string().optional().default(""),
  preserveLayout: z.boolean().optional().default(true),
  extractImages: z.boolean().optional().default(false),
});
export type PreprocessParams = z.infer<typeof PreprocessParamsSchema>;

export interface PreprocessSourceRef {
  type: "heading" | "paragraph" | "page";
  value: string;
  charStart: number;
  charEnd: number;
}

export interface PreprocessOutput {
  rawText: string;
  cleanText: string;
  charCount: number;
  wordCount: number;
  metadata: {
    fileName: string;
    mimeType: string;
    headings?: string[];
    pageCount?: number;
  };
  sourceRefs: PreprocessSourceRef[];
  warnings: string[];
}

export interface PreprocessTrace {
  method: PreprocessMethodId;
  isBinary: boolean;
  rawCharCount: number;
  cleanCharCount: number;
  compressionRatio: string;
  headingCount: number;
  sourceRefCount: number;
}

/** runPreprocess 输入：路由层负责加载 doc + buffer + 读 pymupdfServiceUrl env */
export interface PreprocessInput {
  methodId: PreprocessMethodId;
  params: PreprocessParams;
  doc: {
    rawContent: string;
    buffer: Buffer;
    mimeType: string;
    isBinary: boolean;
    fileName: string;
  };
  /** pymupdf 微服务地址，仅当 methodId="pymupdf" 时需要。默认 http://localhost:8001 */
  pymupdfServiceUrl?: string;
}

export interface PreprocessResult {
  output: PreprocessOutput;
  trace: PreprocessTrace;
  warnings: string[];
}
