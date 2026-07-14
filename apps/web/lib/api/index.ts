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
export * as feedbacksApi from "./feedbacks";
export type { FeedbackInput, FeedbackRow, FeedbackDimension } from "./feedbacks";
export { FEEDBACK_DIMENSIONS } from "./feedbacks";
export * as notesApi from "./notes";
export type { Note, CreateNoteInput, UpdateNoteInput } from "./notes";
export * as platformRulesApi from "./platform-rules";
export type {
  PlatformRule, PlatformRuleConfig,
  CreatePlatformRuleInput, UpdatePlatformRuleInput,
  RuleViolation, ViolationType,
} from "./platform-rules";
export { PLATFORM_PRESETS } from "./platform-rules";
export { ApiError, setTokenGetter } from "./client";
export type { User } from "./auth";
export type { Project, ProjectSettings } from "./projects";
export type {
  MvpDocument, DocumentCategory, IngestionJob,
  IngestionStage, IngestionStageOutput, IngestionStageOutputs,
} from "./documents";
export type {
  GenerationRow, GenerateResponse, PipelineTrace, StageResult, CostBreakdown,
  ViolationItem,
} from "./generations";
// feat-300.6
export * as agentApi from "./agent";
export type {
  AgentRunStartOpts, AgentRunStartResponse, AgentRunRow, AgentStepRow,
  AgentFinishReason, AgentRunStatus, AgentStepType, ChatMessage,
  StepFramePayload, CostFramePayload, FinishFramePayload, ErrorFramePayload,
} from "./agent";
export * as memoryApi from "./memory";
export type {
  MemoryRow, MemoryKind, MemorySource,
  CreateMemoryInput, UpdateMemoryInput, DistillResult,
} from "./memory";
export { MEMORY_KINDS } from "./memory";
export * as evalApi from "./eval";
export type {
  EvalRunSummary, EvalRunRowLite, EvalRunStatus,
  RunEvalBody, PromoteFeedbackResponse,
} from "./eval";
// feat-400.1 slice 3
export * as productBriefApi from "./product-brief";
export type {
  BriefField, BriefContainer, BriefIssues, BriefSnapshot,
  BriefFieldGroup, BriefFieldSource, BriefFieldStatus,
  ExtractResult, UpsertFieldInput,
} from "./product-brief";
export { BRIEF_FIELD_GROUPS, FACTUAL_GROUPS } from "./product-brief";
// feat-400.2
export * as claimsApi from "./claims";
export type { Claim, ClaimType, ClaimStatus } from "./claims";
export { CLAIM_TYPES, EVIDENCE_REQUIRED_CLAIM_TYPES } from "./claims";
export * as contentEvalApi from "./content-evaluation";
export type {
  Decision, GateFailure, ContentScores, EvaluateResult, EvaluateInput, QueueItem,
} from "./content-evaluation";
// feat-400.3
export * as feedbackLearningApi from "./feedback-learning";
export type { UpdateSuggestion } from "./feedback-learning";
// feat-400.4
export * as campaignsApi from "./campaigns";
export type { CampaignGoal, CampaignListItem, CampaignVariant, CampaignDetail } from "./campaigns";
export { CAMPAIGN_GOALS } from "./campaigns";
// feat-400.5
export * as assetsApi from "./assets";
export type { VisualAsset, AssetKind } from "./assets";
export { ASSET_KINDS } from "./assets";
export * as postersApi from "./posters";
export type { PosterTemplate, RenderResult, RenderInput, PosterFailure } from "./posters";
export * as sourcesApi from "./sources";
export type { SourceRecord, SourcePage } from "./sources";
