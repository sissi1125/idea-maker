export type StepRunStatus = "idle" | "running" | "success" | "error";

export interface StepRun {
  id: string;
  stageId: string;
  methodId: string;
  params: Record<string, unknown>;
  status: StepRunStatus;
  startedAt: number;
  durationMs?: number;
  output?: unknown;
  trace?: unknown;
  warnings?: string[];
  error?: { code: string; message: string };
}

export type StepRunMap = Record<string, StepRun[]>;

// ─── Pipeline Run ─────────────────────────────────────────────────────────────

export type PipelineRunStatus = "idle" | "running" | "success" | "error";

/**
 * 运行时上下文：影响条件步骤（conditional）的自动激活判断。
 * 由 PlaygroundShell 维护，部分字段在特定 stage 运行成功后更新。
 */
export interface PipelineRuntimeContext {
  /** 是否为多轮对话场景（触发 context-management 步骤） */
  isMultiTurn: boolean;
  /** 是否启用了多路召回（触发 multi-recall-merge 步骤） */
  multipleRetrievalSources: boolean;
}

export interface PipelineRun {
  status: PipelineRunStatus;
  selectedDocumentId: string | null;
  selectedDocumentVersionId: string | null;
  /**
   * 可选/条件步骤的启用状态。
   * - required 步骤不在此 map 中（始终启用）。
   * - optional/optimization：此 map 优先，不存在则用 stage.defaultEnabled。
   * - conditional：此 map 优先（用户强制覆盖），不存在则由 runtimeContext 自动判断。
   */
  enabledSteps: Record<string, boolean>;
  /** 运行时上下文，影响条件步骤的自动激活 */
  runtimeContext: PipelineRuntimeContext;
}

/** PipelineRun 的工厂函数，提供正确的初始值 */
export function createPipelineRun(): PipelineRun {
  return {
    status: "idle",
    selectedDocumentId: null,
    selectedDocumentVersionId: null,
    enabledSteps: {},
    runtimeContext: { isMultiTurn: false, multipleRetrievalSources: false },
  };
}
