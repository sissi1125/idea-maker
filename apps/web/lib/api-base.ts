/**
 * api-base — 前端 fetch URL 工厂
 *
 * Wave 4 起所有端点都在 NestJS（apps/api）：18 个 pipeline stage
 * + documents (CRUD) + snapshots + pipeline-runs。
 *
 * 切换：
 *   NEXT_PUBLIC_USE_NEST_API=true  → 全部走 NestJS（推荐）
 *   不设 / 其他值                 → 沿用 /api/... 相对路径
 *
 * 注意：Wave 4 已删除 apps/web/app/api/* 路由。如果 NEXT_PUBLIC_USE_NEST_API
 * 未设置且 NestJS 没在跑，所有 fetch 都会 404。生产部署必须显式开启 flag。
 *
 * NEXT_PUBLIC_API_URL 默认 http://localhost:3001（dev）；
 * 部署时设成实际后端域名（例如 https://api.example.com）。
 */

const USE_NEST =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_NEST_API === "true";

const NEST_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "http://localhost:3001";

function nest(path: string): string {
  return USE_NEST ? `${NEST_BASE}${path}` : `/api${path}`;
}

/** Pipeline stage 端点（18 个 stage 全在 NestJS）。 */
export function pipelineUrl(stageId: string): string {
  return nest(`/pipeline/${stageId}`);
}

/** Documents CRUD（GET 列表 / POST 上传 / DELETE :id）。 */
export function documentsUrl(suffix = ""): string {
  return nest(`/documents${suffix}`);
}

/** Snapshots（GET 列表 / POST upsert / GET :stageId）。 */
export function snapshotsUrl(suffix = ""): string {
  return nest(`/snapshots${suffix}`);
}

/** Pipeline runs（POST 保存 / GET 列表 / GET :id）。 */
export function pipelineRunsUrl(suffix = ""): string {
  return nest(`/pipeline-runs${suffix}`);
}

/** 是否走 NestJS（前端 UI 可显示角标）。 */
export const usingNestApi = USE_NEST;
