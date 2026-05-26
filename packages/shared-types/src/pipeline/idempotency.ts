import { z } from "zod";

/**
 * 文档幂等性检查 - 共享类型定义
 *
 * 这些 zod schema 同时被前后端使用：
 *   - apps/web 路由层用 .parse() 校验请求体
 *   - packages/rag-core 用推导出的 TypeScript 类型作为函数签名
 *   - 未来 apps/api（NestJS）也复用同一份
 */

export const IdempotencyMethodId = z.enum([
  "sha256-content",
  "normalized-sha256",
  "file-signature",
]);
export type IdempotencyMethodId = z.infer<typeof IdempotencyMethodId>;

export const IdempotencyVersionPolicy = z.enum([
  "new-version",
  "skip-existing",
  "replace-existing",
]);
export type IdempotencyVersionPolicy = z.infer<typeof IdempotencyVersionPolicy>;

export const IdempotencyParamsSchema = z.object({
  normalizeWhitespace: z.boolean().optional().default(false),
  includeFileName: z.boolean().optional().default(false),
  versionPolicy: IdempotencyVersionPolicy.optional().default("new-version"),
});
export type IdempotencyParams = z.infer<typeof IdempotencyParamsSchema>;

/** rag-core checkIdempotency 输入：路由层负责把请求体翻译成这个形状（加载文档 + 加载文档库） */
export interface IdempotencyInput {
  methodId: IdempotencyMethodId;
  params: IdempotencyParams;
  targetDoc: {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    rawContent: string;
    version: number;
  };
  /** 文档库中除 targetDoc 之外的所有文档（路由层已过滤自身） */
  otherDocs: ReadonlyArray<{
    id: string;
    fileName: string;
    fileSize: number;
    rawContent: string;
    version: number;
  }>;
}

export interface IdempotencyDuplicate {
  id: string;
  fileName: string;
  version: number;
}

export interface IdempotencyOutput {
  fileName: string;
  fileSize: number;
  mimeType: string;
  hash: string;
  exists: boolean;
  documentId: string;
  version: number;
  recommendedAction: string;
  duplicateOf?: IdempotencyDuplicate;
}

export interface IdempotencyTrace {
  method: IdempotencyMethodId;
  hashDescription: string;
  normalizeWhitespace: boolean;
  includeFileName: boolean;
  versionPolicy: IdempotencyVersionPolicy;
  checkedAgainst: number;
  duplicatesFound: number;
}

export interface IdempotencyResult {
  output: IdempotencyOutput;
  trace: IdempotencyTrace;
  warnings: string[];
}
