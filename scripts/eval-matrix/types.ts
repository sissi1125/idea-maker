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
}

export interface QueryMetrics {
  hitRate: number | null;
  citationCoverage: number | null;
  confidenceScore: number | null;
  retrievedCount: number;
  avgScore: number | null;
  ideaCount: number | null;
  durationMs: number;
}

export interface TestCaseMetrics {
  hitRate: number | null;
  citationCoverage: number | null;
  confidenceScore: number | null;
  retrievedCount: number;
  avgScore: number | null;
  ideaCount: number | null;
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
