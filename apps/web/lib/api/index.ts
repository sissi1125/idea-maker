/**
 * API 模块统一导出 — feat-200.5 Week 5
 *
 * 使用方式：
 *   import { authApi, projectsApi } from "@/lib/api";
 *   const { token } = await authApi.login(email, pw);
 */

export * as authApi from "./auth";
export * as projectsApi from "./projects";
export { ApiError, setTokenGetter } from "./client";
export type { User } from "./auth";
export type { Project, ProjectSettings } from "./projects";
