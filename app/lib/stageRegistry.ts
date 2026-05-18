export type ParamType = "text" | "number" | "boolean" | "select" | "textarea" | "json";

export interface ParamOption { value: string; label: string }

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  default: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  options?: ParamOption[];
  placeholder?: string;
  hint?: string;
}

export interface MethodDef {
  id: string;
  label: string;
  params: ParamDef[];
}

export interface StageDef {
  id: string;
  methods: MethodDef[];
}

function defaults(method: MethodDef): Record<string, unknown> {
  return Object.fromEntries(method.params.map((p) => [p.key, p.default]));
}
export { defaults };

const registry: StageDef[] = [
  {
    id: "document-upload",
    methods: [
      {
        id: "upload",
        label: "上传 / 粘贴文本",
        params: [],
      },
    ],
  },
  {
    id: "idempotency",
    methods: [
      {
        id: "sha256-content",
        label: "SHA-256 内容哈希",
        params: [
          {
            key: "versionPolicy",
            label: "版本策略",
            type: "select",
            default: "new-version",
            options: [
              { value: "skip-existing", label: "跳过已存在" },
              { value: "new-version", label: "新建版本" },
              { value: "replace-existing", label: "替换现有" },
            ],
          },
          { key: "normalizeWhitespace", label: "归一化空白", type: "boolean", default: false },
          { key: "includeFileName", label: "纳入文件名", type: "boolean", default: false },
        ],
      },
      {
        id: "normalized-sha256",
        label: "归一化 SHA-256",
        params: [
          {
            key: "versionPolicy",
            label: "版本策略",
            type: "select",
            default: "new-version",
            options: [
              { value: "skip-existing", label: "跳过已存在" },
              { value: "new-version", label: "新建版本" },
              { value: "replace-existing", label: "替换现有" },
            ],
          },
          { key: "normalizeWhitespace", label: "归一化空白", type: "boolean", default: true },
          { key: "includeFileName", label: "纳入文件名", type: "boolean", default: false },
        ],
      },
      {
        id: "file-signature",
        label: "文件签名 (name+size+hash)",
        params: [
          {
            key: "versionPolicy",
            label: "版本策略",
            type: "select",
            default: "new-version",
            options: [
              { value: "skip-existing", label: "跳过已存在" },
              { value: "new-version", label: "新建版本" },
              { value: "replace-existing", label: "替换现有" },
            ],
          },
          { key: "normalizeWhitespace", label: "归一化空白", type: "boolean", default: false },
          { key: "includeFileName", label: "纳入文件名", type: "boolean", default: true },
        ],
      },
    ],
  },
  {
    id: "preprocess",
    methods: [
      {
        id: "markdown-structure",
        label: "Markdown 结构保留",
        params: [
          { key: "preserveHeadings", label: "保留标题路径", type: "boolean", default: true },
          { key: "removeBoilerplate", label: "移除样板内容", type: "boolean", default: false },
          { key: "maxChars", label: "最大字符数", type: "number", default: 0, min: 0, hint: "0 = 不限制" },
        ],
      },
      {
        id: "plain-text",
        label: "纯文本",
        params: [
          { key: "removeBoilerplate", label: "移除样板内容", type: "boolean", default: false },
          { key: "maxChars", label: "最大字符数", type: "number", default: 0, min: 0, hint: "0 = 不限制" },
        ],
      },
      {
        id: "pdf-pages",
        label: "PDF 按页解析",
        params: [
          { key: "pdfPageRange", label: "页码范围", type: "text", default: "", placeholder: "例: 1-10，留空全部" },
          { key: "preserveHeadings", label: "保留标题", type: "boolean", default: true },
          { key: "maxChars", label: "最大字符数", type: "number", default: 0, min: 0, hint: "0 = 不限制" },
        ],
      },
    ],
  },
  {
    id: "chunk",
    methods: [
      {
        id: "recursive",
        label: "递归切分 (Recursive)",
        params: [
          { key: "chunkSize", label: "Chunk 大小", type: "number", default: 512, min: 64, max: 4096 },
          { key: "overlap", label: "重叠字符数", type: "number", default: 64, min: 0, max: 512 },
          { key: "separators", label: "分隔符 (JSON 数组)", type: "json", default: ["\\n\\n", "\\n", " ", ""], hint: "按优先级排列" },
          { key: "minChunkSize", label: "最小 Chunk 大小", type: "number", default: 64, min: 0 },
        ],
      },
      {
        id: "fixed-size",
        label: "固定大小 (Fixed-size)",
        params: [
          { key: "chunkSize", label: "Chunk 大小", type: "number", default: 512, min: 64, max: 4096 },
          { key: "overlap", label: "重叠字符数", type: "number", default: 64, min: 0, max: 512 },
        ],
      },
      {
        id: "markdown-heading",
        label: "Markdown 标题切分",
        params: [
          { key: "headingDepth", label: "标题深度 (1-6)", type: "number", default: 2, min: 1, max: 6 },
          { key: "chunkSize", label: "最大 Chunk 大小", type: "number", default: 1024, min: 64, max: 8192 },
          { key: "overlap", label: "重叠字符数", type: "number", default: 0, min: 0, max: 256 },
        ],
      },
    ],
  },
  {
    id: "transform",
    methods: [
      {
        id: "none",
        label: "无增强 (None)",
        params: [],
      },
      {
        id: "heading-context",
        label: "注入标题上下文",
        params: [
          { key: "includeTitle", label: "包含文档标题", type: "boolean", default: true },
          { key: "includeHeadingPath", label: "包含标题路径", type: "boolean", default: true },
        ],
      },
      {
        id: "summary-keywords",
        label: "生成摘要与关键词",
        params: [
          { key: "keywordCount", label: "关键词数量", type: "number", default: 5, min: 1, max: 20 },
          { key: "summaryMaxTokens", label: "摘要最大 Token", type: "number", default: 100, min: 20, max: 500 },
        ],
      },
    ],
  },
  {
    id: "embedding",
    methods: [
      {
        id: "openai-3-small",
        label: "OpenAI text-embedding-3-small",
        params: [
          { key: "model", label: "模型", type: "text", default: "text-embedding-3-small" },
          { key: "dimension", label: "向量维度", type: "number", default: 1536, min: 256, max: 3072 },
          { key: "batchSize", label: "批大小", type: "number", default: 100, min: 1, max: 2048 },
        ],
      },
      {
        id: "hf-tei-embedding",
        label: "HuggingFace TEI Embedding",
        params: [
          { key: "model", label: "模型 ID", type: "text", default: "BAAI/bge-small-en-v1.5", placeholder: "HF model ID" },
          { key: "dimension", label: "向量维度", type: "number", default: 384, min: 64, max: 4096 },
          { key: "batchSize", label: "批大小", type: "number", default: 32, min: 1, max: 512 },
        ],
      },
      {
        id: "hf-transformers-js-embedding",
        label: "HF Transformers.js (本地)",
        params: [
          { key: "model", label: "模型 ID", type: "text", default: "Xenova/all-MiniLM-L6-v2" },
          { key: "dimension", label: "向量维度", type: "number", default: 384, min: 64, max: 4096 },
          { key: "batchSize", label: "批大小", type: "number", default: 16, min: 1, max: 128 },
        ],
      },
      {
        id: "debug-deterministic",
        label: "Debug 确定性向量",
        params: [
          { key: "dimension", label: "向量维度", type: "number", default: 4, min: 1, max: 64 },
        ],
      },
    ],
  },
  {
    id: "storage",
    methods: [
      {
        id: "pgvector-upsert-version",
        label: "pgvector upsert 版本",
        params: [
          {
            key: "conflictPolicy",
            label: "冲突策略",
            type: "select",
            default: "upsert",
            options: [
              { value: "upsert", label: "Upsert" },
              { value: "error", label: "报错" },
            ],
          },
          { key: "indexMode", label: "索引模式", type: "select", default: "ivfflat", options: [{ value: "ivfflat", label: "IVFFlat" }, { value: "hnsw", label: "HNSW" }] },
        ],
      },
      {
        id: "pgvector-new-version",
        label: "pgvector 新建版本",
        params: [
          { key: "indexMode", label: "索引模式", type: "select", default: "ivfflat", options: [{ value: "ivfflat", label: "IVFFlat" }, { value: "hnsw", label: "HNSW" }] },
        ],
      },
      {
        id: "pgvector-replace-version",
        label: "pgvector 替换版本",
        params: [
          { key: "indexMode", label: "索引模式", type: "select", default: "ivfflat", options: [{ value: "ivfflat", label: "IVFFlat" }, { value: "hnsw", label: "HNSW" }] },
        ],
      },
    ],
  },
  {
    id: "query-rewrite",
    methods: [
      { id: "none", label: "不改写", params: [] },
      {
        id: "rule-keyword-expansion",
        label: "规则关键词扩展",
        params: [
          { key: "maxQueries", label: "最大 Query 数", type: "number", default: 3, min: 1, max: 10 },
        ],
      },
      {
        id: "llm-marketing-rewrite",
        label: "LLM 营销改写",
        params: [
          { key: "provider", label: "Provider", type: "text", default: "openai", placeholder: "openai / anthropic" },
          { key: "model", label: "模型", type: "text", default: "gpt-4o-mini" },
          { key: "temperature", label: "Temperature", type: "number", default: 0.7, min: 0, max: 2 },
          { key: "maxQueries", label: "最大 Query 数", type: "number", default: 3, min: 1, max: 10 },
          { key: "rewriteGoal", label: "改写目标", type: "textarea", default: "", placeholder: "例: 突出产品差异化优势" },
          { key: "targetAudience", label: "目标受众", type: "text", default: "", placeholder: "例: B2B SaaS 决策者" },
        ],
      },
    ],
  },
  {
    id: "retrieval",
    methods: [
      {
        id: "dense-vector",
        label: "Dense Vector",
        params: [
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
          { key: "threshold", label: "相似度阈值", type: "number", default: 0.7, min: 0, max: 1 },
        ],
      },
      {
        id: "postgres-fulltext",
        label: "PostgreSQL 全文检索",
        params: [
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
        ],
      },
      {
        id: "hybrid-rrf",
        label: "混合检索 (RRF)",
        params: [
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
          { key: "vectorWeight", label: "向量权重", type: "number", default: 0.6, min: 0, max: 1 },
          { key: "textWeight", label: "文本权重", type: "number", default: 0.4, min: 0, max: 1 },
          { key: "threshold", label: "相似度阈值", type: "number", default: 0.5, min: 0, max: 1 },
        ],
      },
    ],
  },
  {
    id: "filter",
    methods: [
      {
        id: "score-threshold",
        label: "分数阈值过滤",
        params: [
          { key: "minScore", label: "最低分数", type: "number", default: 0.6, min: 0, max: 1 },
          { key: "maxPerDocument", label: "每文档最多", type: "number", default: 3, min: 1, max: 20 },
        ],
      },
      {
        id: "metadata-filter",
        label: "Metadata 过滤",
        params: [
          { key: "requiredSourceTypes", label: "必须 source 类型 (JSON)", type: "json", default: [] },
          { key: "maxPerDocument", label: "每文档最多", type: "number", default: 3, min: 1, max: 20 },
        ],
      },
      {
        id: "mmr-diversity",
        label: "MMR 多样性过滤",
        params: [
          { key: "mmrLambda", label: "MMR λ (相关性 vs 多样性)", type: "number", default: 0.5, min: 0, max: 1 },
          { key: "maxPerDocument", label: "每文档最多", type: "number", default: 3, min: 1, max: 20 },
        ],
      },
    ],
  },
  {
    id: "rerank",
    methods: [
      { id: "score-only", label: "仅按分数排序", params: [] },
      {
        id: "metadata-boost",
        label: "Metadata 权重提升",
        params: [
          { key: "rerankTopN", label: "重排取 Top N", type: "number", default: 5, min: 1, max: 50 },
        ],
      },
      {
        id: "hf-tei-rerank",
        label: "HF TEI Rerank",
        params: [
          { key: "model", label: "模型 ID", type: "text", default: "BAAI/bge-reranker-base" },
          { key: "rerankTopN", label: "重排取 Top N", type: "number", default: 5, min: 1, max: 50 },
        ],
      },
      {
        id: "llm-relevance-rerank",
        label: "LLM 相关性重排",
        params: [
          { key: "provider", label: "Provider", type: "text", default: "openai" },
          { key: "model", label: "模型", type: "text", default: "gpt-4o-mini" },
          { key: "rerankTopN", label: "重排取 Top N", type: "number", default: 5, min: 1, max: 50 },
          { key: "criteria", label: "评判标准", type: "textarea", default: "", placeholder: "例: 优先返回包含价格信息的 chunk" },
        ],
      },
    ],
  },
  {
    id: "citation",
    methods: [
      {
        id: "chunk-citation",
        label: "Chunk 引用",
        params: [
          { key: "maxEvidencePerClaim", label: "每 claim 最多证据", type: "number", default: 3, min: 1, max: 10 },
        ],
      },
      {
        id: "page-aware-citation",
        label: "页码感知引用",
        params: [
          { key: "includePage", label: "包含页码", type: "boolean", default: true },
          { key: "maxEvidencePerClaim", label: "每 claim 最多证据", type: "number", default: 3, min: 1, max: 10 },
        ],
      },
      {
        id: "snippet-citation",
        label: "片段引用",
        params: [
          { key: "snippetLength", label: "片段长度", type: "number", default: 200, min: 50, max: 500 },
          { key: "includePage", label: "包含页码", type: "boolean", default: false },
          { key: "maxEvidencePerClaim", label: "每 claim 最多证据", type: "number", default: 3, min: 1, max: 10 },
        ],
      },
    ],
  },
  {
    id: "generation",
    methods: [
      {
        id: "marketing-ideas",
        label: "营销 Idea 生成",
        params: [
          { key: "provider", label: "Provider", type: "text", default: "openai" },
          { key: "model", label: "模型", type: "text", default: "gpt-4o" },
          { key: "targetAudience", label: "目标受众", type: "text", default: "" },
          { key: "ideaCount", label: "生成 Idea 数量", type: "number", default: 5, min: 1, max: 20 },
          { key: "includeEvidence", label: "包含 evidence 引用", type: "boolean", default: true },
        ],
      },
    ],
  },
];

export default registry;

export function getStage(stageId: string): StageDef | undefined {
  return registry.find((s) => s.id === stageId);
}
