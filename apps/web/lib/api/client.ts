/**
 * API Client 基础层 — feat-200.5 Week 5
 *
 * 统一封装 fetch：
 *   - 自动注入 Authorization: Bearer <token>（从 zustand store 读）
 *   - JSON 序列化 / 反序列化
 *   - 统一错误处理（status >= 400 → throw ApiError）
 *   - 基地址从 NEXT_PUBLIC_API_URL 读，默认 http://localhost:3001
 *
 * 为什么不用 axios：
 *   - fetch 已是 Node 18+ / 浏览器原生 API，零依赖
 *   - MVP 阶段不需要 interceptor 链 / 取消 token 等高级功能
 *   - 后续如需加 retry / timeout，加一层 wrapper 即可
 */

// 获取 token 的回调——在 store 初始化后注入，避免循环依赖
let tokenGetter: (() => string | null) | null = null;

export function setTokenGetter(fn: () => string | null) {
  tokenGetter = fn;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 跳过自动注入 token（登录 / 注册用） */
  noAuth?: boolean;
  headers?: Record<string, string>;
}

/**
 * 核心 fetch 封装。
 * 所有业务 API 函数（auth.ts / projects.ts 等）调此函数。
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, noAuth = false, headers: extraHeaders } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (!noAuth) {
    const token = tokenGetter?.();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const errBody = json?.error ?? json ?? {};
    throw new ApiError(
      res.status,
      errBody.code ?? "unknown",
      errBody.message ?? `HTTP ${res.status}`,
    );
  }

  return json as T;
}
