/**
 * API 模块统一导出 — feat-200.5 Week 5
 *
 * 使用方式：
 *   import { authApi, projectsApi } from "@/lib/api";
 *   const { token } = await authApi.login(email, pw);
 */

export * as authApi from "./auth";
export * as projectsApi from "./projects";
export * as documentsApi from "./documents";
export * as generationsApi from "./generations";
export * as autoGenerationsApi from "./auto-generations";
export type {
  AutoGenCardType,
  ProjectAutoGenLatest,
  ProjectAutoGenInFlight,
} from "./auto-generations";
export { ApiError, setTokenGetter } from "./client";
export type { User } from "./auth";
export type { Project, ProjectSettings } from "./projects";
export type {
  MvpDocument, DocumentCategory, IngestionJob,
  IngestionStage, IngestionStageOutput, IngestionStageOutputs,
} from "./documents";
export type { GenerationRow, GenerateResponse, PipelineTrace, StageResult, CostBreakdown } from "./generations";
