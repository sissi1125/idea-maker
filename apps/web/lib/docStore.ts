/**
 * docStore.ts — feat-100.4 起仅保留 DocumentRecord 类型定义。
 *
 * 真正的读写实现已迁到 apps/api/src/documents/doc-store.service.ts
 * （NestJS DocStoreService），通过 HTTP 端点（/documents）暴露给前端。
 *
 * 本文件之所以保留：前端 components 仍需要 DocumentRecord 类型
 * （列表 / 选中状态 / 删除回调等）。后续可考虑把类型挪到 shared-types。
 */

export interface DocumentRecord {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  hash: string;
  version: number;
  /**
   * 文本文件：UTF-8 字符串原文。
   * 二进制文件（PDF/DOCX）：base64 编码字符串。
   *
   * 注：列表 API 已剥离此字段以减少传输体积，前端实际收到的对象通常没有 rawContent。
   * 保留在类型里是为了 backend 路径需要时的兼容。
   */
  rawContent: string;
  isBinary: boolean;
  createdAt: string;
  updatedAt: string;
  processingStatus: "ready" | "processing" | "error";
}
