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
