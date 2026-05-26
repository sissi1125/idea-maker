/**
 * api-base — feat-100.3 Wave 3 双跑期 URL 切换层
 *
 * 通过 NEXT_PUBLIC_USE_NEST_API + NEXT_PUBLIC_API_URL 决定前端 fetch 走 Next.js 还是 NestJS。
 *
 * Wave 3 已迁到 NestJS 的端点（仅 5 个）：
 *   - /pipeline/chunk
 *   - /pipeline/embedding
 *   - /pipeline/retrieval
 *   - /pipeline/generation
 *   - /documents (含 POST / GET / DELETE)
 *
 * 未迁的端点（snapshots、pipeline-runs、其他 14 个 stage）继续走 Next.js routes。
 *
 * 切换方式：
 *   NEXT_PUBLIC_USE_NEST_API=true
 *   NEXT_PUBLIC_API_URL=http://localhost:3001
 *
 * 不设或设为 "false" → 沿用 Next.js routes（默认安全行为）。
 */

const USE_NEST =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_NEST_API === "true";

const NEST_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "http://localhost:3001";

/** Wave 3 已迁到 NestJS 的 pipeline stage id 白名单。 */
const NEST_MIGRATED_PIPELINE = new Set<string>([
  "chunk",
  "embedding",
  "retrieval",
  "generation",
]);

/**
 * 返回 pipeline stage 端点 URL。
 * - 启用 flag 且 stage 在白名单 → NestJS 绝对 URL
 * - 否则 → Next.js 相对路径
 */
export function pipelineUrl(stageId: string): string {
  if (USE_NEST && NEST_MIGRATED_PIPELINE.has(stageId)) {
    return `${NEST_BASE}/pipeline/${stageId}`;
  }
  return `/api/pipeline/${stageId}`;
}

/**
 * 返回 documents 端点 URL。
 * suffix 形如 "" / "/123"，会拼到 /documents 后面。
 */
export function documentsUrl(suffix = ""): string {
  if (USE_NEST) {
    return `${NEST_BASE}/documents${suffix}`;
  }
  return `/api/documents${suffix}`;
}

/** 当前是否启用了 NestJS 后端（前端可用来在 UI 上显示一个角标）。 */
export const usingNestApi = USE_NEST;
