// feat-100.2 起从 apps/web/app/api/pipeline/*/route.ts 抽核心逻辑到这里。
export const RAG_CORE_VERSION = "0.1.0";

export { PipelineError, isPipelineError } from "./errors";
export { checkIdempotency } from "./ingestion/idempotency";
export { runPreprocess } from "./ingestion/preprocess";
export { runChunk } from "./ingestion/chunk";
export { runTransform } from "./ingestion/transform";
export {
  jieba,
  tokenize,
  tokenizeToSet,
  tokenizeForBM25,
  extractKeywords,
} from "./util/nlp";
