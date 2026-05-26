// feat-100.2 起从 apps/web/app/api/pipeline/*/route.ts 抽核心逻辑到这里。
export const RAG_CORE_VERSION = "0.1.0";

export { PipelineError, isPipelineError } from "./errors";
export { checkIdempotency } from "./ingestion/idempotency";
export { runPreprocess } from "./ingestion/preprocess";
export { runChunk } from "./ingestion/chunk";
export { runTransform } from "./ingestion/transform";
export { runEmbedding } from "./ingestion/embedding";
export { runStorage } from "./ingestion/storage";
export { runQueryRewrite } from "./retrieval/query-rewrite";
export { runIntentRecognition } from "./retrieval/intent-recognition";
export { runMultiRecallMerge } from "./retrieval/multi-recall-merge";
export { runFilter } from "./retrieval/filter";
export { runCitation } from "./retrieval/citation";
export { runFallback } from "./retrieval/fallback";
export { runRerank } from "./retrieval/rerank";
export { runRetrieval } from "./retrieval/retrieval";
export { runContextManagement } from "./generation/context-management";
export { runPromptBuild } from "./generation/prompt-build";
export { runGeneration } from "./generation/generation";
export { runEvaluation } from "./generation/evaluation";
export {
  jieba,
  tokenize,
  tokenizeToSet,
  tokenizeForBM25,
  extractKeywords,
} from "./util/nlp";
export { embedSingleText, embedBatch } from "./util/openai-embed";
