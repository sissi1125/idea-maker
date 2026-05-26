/**
 * Projects 模块共享类型 — feat-200.1 Week 1
 *
 * 设计：与 DB 列同名同形，camelCase 映射保留在 service 层；
 * 不暴露 owner_id 给前端（权限已在 service 内强制按 owner 过滤）。
 */

export interface ProjectRow {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  docsCount: number;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * ProjectSettingsRow — project_settings 表，全部字段可空。
 * encryptedApiKey 在 Week 1 仅作为透明 TEXT 字段；Week 5 接 AES-256 时
 * 由 ProjectsService 在写入前加密、读出时不解密（前端只看是否已设置）。
 */
export interface ProjectSettingsRow {
  projectId: string;
  provider: string | null;
  encryptedApiKey: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  thinkingDepth: string | null;
  retrievalMode: string | null;
  updatedAt: string;
}
