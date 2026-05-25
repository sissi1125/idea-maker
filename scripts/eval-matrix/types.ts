export interface StageConfig {
  methodId: string;
  params: Record<string, unknown>;
}

export interface TestCase {
  id: string;
  label: string;
  chunk: StageConfig;
  transform: StageConfig;
  queryRewrite: StageConfig;
  retrieval: StageConfig;
  filter: StageConfig;
  rerank?: StageConfig;                 // 不填则用 FIXED.rerank
  /** citation 阶段配置，不填则用 FIXED.citation（实验四专用） */
  citation?: StageConfig;
  /** evaluation scoreThreshold，不填则用 FIXED.evaluation 的默认值（0.2）*/
  scoreThreshold?: number;
}

export interface QueryMetrics {
  hitRate: number | null;
  citationCoverage: number | null;
  confidenceScore: number | null;
  retrievedCount: number;
  avgScore: number | null;
  ideaCount: number | null;
  /** citation 阶段拼出的 contextText 总字符数（衡量给 LLM 的上下文成本） */
  contextLength: number | null;
  /** 单条 evidence 平均字符数（contextLength / evidenceCount） */
  avgEvidenceLength: number | null;
  /** 最终送给 LLM 的 evidence 条数（section 模式按章节去重后会变少） */
  evidenceCount: number | null;
  durationMs: number;
}

export interface TestCaseMetrics {
  hitRate: number | null;
  citationCoverage: number | null;
  confidenceScore: number | null;
  retrievedCount: number;
  avgScore: number | null;
  ideaCount: number | null;
  contextLength: number | null;
  avgEvidenceLength: number | null;
  evidenceCount: number | null;
  totalDurationMs: number;
}

export interface QueryResult {
  queryId: string;
  query: string;
  status: "success" | "failed";
  error?: string;
  metrics?: QueryMetrics;
}

export interface TestCaseResult {
  testId: string;
  label: string;
  status: "success" | "failed" | "partial";
  error?: string;
  queryResults: QueryResult[];
  metrics: TestCaseMetrics | null;
}
