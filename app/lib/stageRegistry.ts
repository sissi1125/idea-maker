export type ParamType = "text" | "number" | "boolean" | "select" | "textarea" | "json" | "password";

export interface ParamOption { value: string; label: string }

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  default: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
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
  /**
   * API route 是否已实现。
   * 默认 true（现有步骤）；设为 false 的步骤展示参数配置但 Run 按钮 disabled。
   */
  implemented?: boolean;
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
        id: "markitdown",
        label: "Markitdown（万能格式转 MD）",
        params: [
          { key: "preserveHeadings", label: "保留标题结构", type: "boolean", default: true },
          { key: "preserveTables", label: "保留表格", type: "boolean", default: true },
          { key: "removeBoilerplate", label: "移除样板内容", type: "boolean", default: true },
          { key: "maxChars", label: "最大字符数", type: "number", default: 0, min: 0, hint: "0 = 不限制" },
        ],
      },
      {
        id: "pymupdf",
        label: "PyMuPDF（PDF 精确提取）",
        params: [
          { key: "pdfPageRange", label: "页码范围", type: "text", default: "", placeholder: "例: 1-10，留空全部" },
          { key: "extractImages", label: "提取图片描述（占位）", type: "boolean", default: false },
          { key: "preserveLayout", label: "保留排版结构", type: "boolean", default: true },
          { key: "maxChars", label: "最大字符数", type: "number", default: 0, min: 0, hint: "0 = 不限制" },
        ],
      },
      {
        id: "pdf-pages",
        label: "PDF 按页解析（基础）",
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
          { key: "documentTitle", label: "文档标题（可选）", type: "text", default: "", placeholder: "例: 产品介绍文档", hint: "留空则不注入文档级标题" },
          { key: "includeTitle", label: "包含文档标题", type: "boolean", default: true },
          { key: "includeHeadingPath", label: "包含 sourceRef 路径", type: "boolean", default: true },
        ],
      },
      {
        id: "summary-keywords",
        label: "生成摘要与关键词",
        params: [
          { key: "keywordCount", label: "关键词数量", type: "number", default: 5, min: 1, max: 20 },
          { key: "summaryMaxTokens", label: "摘要最大 Token", type: "number", default: 100, min: 20, max: 500 },
          { key: "appendToChunk", label: "拼接到 chunk 末尾", type: "boolean", default: true, hint: "关闭则只在 output 记录，不修改 enhancedText" },
        ],
      },
    ],
  },
  {
    id: "embedding",
    methods: [
      {
        id: "openai-3-small",
        label: "OpenAI-compatible Embedding（Qwen / OpenAI / 其他）",
        params: [
          { key: "model", label: "模型", type: "text", default: "text-embedding-v4", hint: "Qwen: text-embedding-v4（推荐）｜OpenAI: text-embedding-3-small" },
          { key: "dimension", label: "向量维度", type: "number", default: 1024, min: 64, max: 4096, hint: "Qwen 合法值: 64/128/256/512/768/1024/1536/2048/3072｜OpenAI 3-small 最大 1536" },
          { key: "batchSize", label: "批大小", type: "number", default: 10, min: 1, max: 2048 },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 EMBEDDING_API_KEY / LLM_API_KEY / OPENAI_API_KEY" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "https://dashscope.aliyuncs.com/compatible-mode/v1", placeholder: "Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1｜留空=OpenAI" },
        ],
      },
      {
        id: "hf-tei-embedding",
        label: "HuggingFace TEI Embedding",
        params: [
          { key: "model", label: "模型 ID", type: "text", default: "BAAI/bge-small-en-v1.5", placeholder: "HF model ID" },
          { key: "dimension", label: "向量维度", type: "number", default: 384, min: 64, max: 4096 },
          { key: "batchSize", label: "批大小", type: "number", default: 32, min: 1, max: 512 },
          {
            key: "endpoint",
            label: "TEI Endpoint（可选）",
            type: "text",
            default: "",
            placeholder: "留空则读取 HF_TEI_ENDPOINT 环境变量，例：http://localhost:8080",
          },
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
            key: "connectionString",
            label: "数据库连接串",
            type: "text",
            default: "",
            placeholder: "留空则读取 DATABASE_URL 环境变量，例：postgresql://user:pass@localhost:5432/rag",
          },
          {
            key: "conflictPolicy",
            label: "冲突策略",
            type: "select",
            default: "upsert",
            options: [
              { value: "upsert", label: "Upsert（覆盖旧向量）" },
              { value: "error", label: "报错（不允许重复）" },
            ],
          },
          { key: "indexMode", label: "索引模式", type: "select", default: "hnsw", options: [{ value: "hnsw", label: "HNSW（推荐）" }, { value: "ivfflat", label: "IVFFlat" }, { value: "none", label: "不建索引" }] },
          { key: "truncateTable", label: "清空历史向量（维度切换时使用）", type: "boolean", default: false, hint: "true = 写入前 TRUNCATE rag_chunks，解决 Dimension Guard 冲突" },
        ],
      },
      {
        id: "pgvector-new-version",
        label: "pgvector 新建版本",
        params: [
          {
            key: "connectionString",
            label: "数据库连接串",
            type: "text",
            default: "",
            placeholder: "留空则读取 DATABASE_URL 环境变量",
          },
          { key: "indexMode", label: "索引模式", type: "select", default: "hnsw", options: [{ value: "hnsw", label: "HNSW（推荐）" }, { value: "ivfflat", label: "IVFFlat" }, { value: "none", label: "不建索引" }] },
          { key: "truncateTable", label: "清空历史向量（维度切换时使用）", type: "boolean", default: false, hint: "true = 写入前 TRUNCATE rag_chunks，解决 Dimension Guard 冲突" },
        ],
      },
      {
        id: "pgvector-replace-version",
        label: "pgvector 替换版本",
        params: [
          {
            key: "connectionString",
            label: "数据库连接串",
            type: "text",
            default: "",
            placeholder: "留空则读取 DATABASE_URL 环境变量",
          },
          { key: "indexMode", label: "索引模式", type: "select", default: "hnsw", options: [{ value: "hnsw", label: "HNSW（推荐）" }, { value: "ivfflat", label: "IVFFlat" }, { value: "none", label: "不建索引" }] },
          { key: "truncateTable", label: "清空历史向量（维度切换时使用）", type: "boolean", default: false, hint: "true = 写入前 TRUNCATE rag_chunks，解决 Dimension Guard 冲突" },
        ],
      },
    ],
  },
  {
    id: "query-rewrite",
    methods: [
      {
        id: "none",
        label: "不改写",
        params: [
          { key: "query", label: "用户查询", type: "textarea", default: "", required: true, placeholder: "输入你想检索的问题，例如：产品核心功能有哪些？" },
        ],
      },
      {
        id: "rule-keyword-expansion",
        label: "规则关键词扩展",
        params: [
          { key: "query", label: "用户查询", type: "textarea", default: "", required: true, placeholder: "输入你想检索的问题，例如：产品核心功能有哪些？" },
          { key: "maxQueries", label: "最大 Query 数", type: "number", default: 3, min: 1, max: 10 },
          { key: "targetAudience", label: "目标受众（可选）", type: "text", default: "", placeholder: "例: SaaS 产品运营" },
        ],
      },
      {
        id: "llm-marketing-rewrite",
        label: "LLM 营销改写",
        params: [
          { key: "query", label: "用户查询", type: "textarea", default: "", required: true, placeholder: "输入你想检索的问题，例如：产品核心功能有哪些？" },
          { key: "model", label: "模型", type: "text", default: "gpt-4o-mini" },
          { key: "temperature", label: "Temperature", type: "number", default: 0.7, min: 0, max: 2 },
          { key: "maxQueries", label: "最大 Query 数", type: "number", default: 3, min: 1, max: 10 },
          { key: "rewriteGoal", label: "改写目标", type: "textarea", default: "", placeholder: "例: 突出产品差异化优势，生成适合检索产品介绍的多种表达" },
          { key: "targetAudience", label: "目标受众", type: "text", default: "", placeholder: "例: B2B SaaS 决策者" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
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
          { key: "connectionString", label: "数据库连接串（可选）", type: "text", default: "", placeholder: "留空则读取 DATABASE_URL 环境变量" },
          { key: "embeddingProvider", label: "Embedding Provider", type: "select", default: "openai", options: [{ value: "openai", label: "OpenAI-compatible（Qwen / OpenAI）" }, { value: "hf-tei", label: "HF TEI" }, { value: "debug-deterministic", label: "Debug 确定性" }] },
          { key: "embeddingModel", label: "Embedding 模型", type: "text", default: "text-embedding-v4", hint: "必须与 ingestion embedding 阶段使用的模型一致" },
          { key: "embeddingDimension", label: "向量维度", type: "number", default: 1024, min: 64, max: 4096, hint: "必须与 ingestion embedding 阶段使用的维度一致｜Qwen 合法值: 64/128/256/512/768/1024/1536/2048/3072" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 EMBEDDING_API_KEY / LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "https://dashscope.aliyuncs.com/compatible-mode/v1", placeholder: "Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1｜留空=OpenAI" },
          { key: "teiEndpoint", label: "TEI Endpoint（可选）", type: "text", default: "", placeholder: "http://localhost:8080" },
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
          { key: "threshold", label: "相似度阈值", type: "number", default: 0.5, min: 0, max: 1 },
        ],
      },
      {
        id: "postgres-fulltext",
        label: "PostgreSQL 全文检索",
        params: [
          { key: "connectionString", label: "数据库连接串（可选）", type: "text", default: "", placeholder: "留空则读取 DATABASE_URL 环境变量" },
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
        ],
      },
      {
        id: "hybrid-rrf",
        label: "混合检索 (RRF)",
        params: [
          { key: "connectionString", label: "数据库连接串（可选）", type: "text", default: "", placeholder: "留空则读取 DATABASE_URL 环境变量" },
          { key: "embeddingProvider", label: "Embedding Provider", type: "select", default: "openai", options: [{ value: "openai", label: "OpenAI-compatible（Qwen / OpenAI）" }, { value: "hf-tei", label: "HF TEI" }, { value: "debug-deterministic", label: "Debug 确定性" }] },
          { key: "embeddingModel", label: "Embedding 模型", type: "text", default: "text-embedding-v4", hint: "必须与 ingestion embedding 阶段使用的模型一致" },
          { key: "embeddingDimension", label: "向量维度", type: "number", default: 1024, min: 64, max: 4096, hint: "必须与 ingestion embedding 阶段使用的维度一致｜Qwen 合法值: 64/128/256/512/768/1024/1536/2048/3072" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 EMBEDDING_API_KEY / LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "https://dashscope.aliyuncs.com/compatible-mode/v1", placeholder: "Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1｜留空=OpenAI" },
          { key: "teiEndpoint", label: "TEI Endpoint（可选）", type: "text", default: "", placeholder: "http://localhost:8080" },
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
          { key: "vectorWeight", label: "向量权重", type: "number", default: 0.6, min: 0, max: 1 },
          { key: "textWeight", label: "文本权重", type: "number", default: 0.4, min: 0, max: 1 },
          { key: "threshold", label: "相似度阈值", type: "number", default: 0.5, min: 0, max: 1 },
        ],
      },
      {
        id: "bm25-chinese",
        label: "BM25 中文分词",
        params: [
          { key: "connectionString", label: "数据库连接串（可选）", type: "text", default: "", placeholder: "留空则读取 DATABASE_URL 环境变量" },
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
          { key: "k1", label: "k1（词频饱和）", type: "number", default: 1.5, min: 0.5, max: 3, hint: "控制词频饱和速度，1.2–2.0 为常用范围" },
          { key: "b", label: "b（长度归一化）", type: "number", default: 0.75, min: 0, max: 1, hint: "0=不归一化，1=完全归一化，0.75 为标准默认值" },
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
          { key: "endpoint", label: "TEI Endpoint（可选）", type: "text", default: "", placeholder: "留空则读取 HF_TEI_ENDPOINT 环境变量" },
        ],
      },
      {
        id: "llm-relevance-rerank",
        label: "LLM 相关性重排",
        params: [
          { key: "model", label: "模型", type: "text", default: "gpt-4o-mini" },
          { key: "rerankTopN", label: "重排取 Top N", type: "number", default: 5, min: 1, max: 50 },
          { key: "criteria", label: "评判标准", type: "textarea", default: "", placeholder: "例: 优先返回包含价格信息的 chunk" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
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
          { key: "model", label: "模型", type: "text", default: "qwen-plus", placeholder: "qwen-plus / gpt-4o / deepseek-chat" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { key: "targetAudience", label: "目标受众", type: "text", default: "" },
          { key: "ideaCount", label: "生成 Idea 数量", type: "number", default: 5, min: 1, max: 20 },
          { key: "includeEvidence", label: "包含 evidence 引用", type: "boolean", default: true },
        ],
      },
      {
        id: "product-persona",
        label: "产品画像",
        params: [
          { key: "model", label: "模型", type: "text", default: "qwen-plus", placeholder: "qwen-plus / gpt-4o / deepseek-chat" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { key: "targetAudience", label: "目标受众（可选提示）", type: "text", default: "", placeholder: "如：独立开发者、中小企业运营" },
        ],
      },
      {
        id: "selling-points",
        label: "卖点地图",
        params: [
          { key: "model", label: "模型", type: "text", default: "qwen-plus", placeholder: "qwen-plus / gpt-4o / deepseek-chat" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { key: "targetAudience", label: "目标受众（可选提示）", type: "text", default: "", placeholder: "如：独立开发者、中小企业运营" },
        ],
      },
      {
        id: "content-ideas",
        label: "内容 Idea",
        params: [
          { key: "model", label: "模型", type: "text", default: "qwen-plus", placeholder: "qwen-plus / gpt-4o / deepseek-chat" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { key: "targetAudience", label: "目标受众（可选提示）", type: "text", default: "", placeholder: "如：独立开发者、中小企业运营" },
          { key: "ideaCount", label: "生成 Idea 数量", type: "number", default: 5, min: 1, max: 20 },
        ],
      },
    ],
  },

  {
    id: "context-management",
    methods: [
      {
        id: "session-history",
        label: "规则消解",
        params: [
          { key: "currentMessage", label: "当前消息", type: "textarea", default: "", required: true, placeholder: "输入当前轮用户消息，例如：它的定价是多少？" },
          { key: "history", label: "历史记录 (JSON)", type: "json", default: [], hint: "格式：[{\"role\":\"user\",\"content\":\"...\"},{\"role\":\"assistant\",\"content\":\"...\"}]" },
        ],
      },
      {
        id: "llm-disambiguate",
        label: "LLM 消解",
        params: [
          { key: "currentMessage", label: "当前消息", type: "textarea", default: "", required: true, placeholder: "输入当前轮用户消息" },
          { key: "history", label: "历史记录 (JSON)", type: "json", default: [] },
          { key: "model", label: "模型", type: "text", default: "gpt-4o-mini" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
        ],
      },
    ],
  },
  {
    id: "intent-recognition",
    methods: [
      {
        id: "rule-based",
        label: "规则分类",
        params: [
          { key: "query", label: "查询（可选）", type: "textarea", default: "", placeholder: "留空则读取上游 context-management 输出的 query" },
        ],
      },
      {
        id: "llm-router",
        label: "LLM 路由",
        params: [
          { key: "query", label: "查询（可选）", type: "textarea", default: "", placeholder: "留空则读取上游 context-management 输出的 query" },
          { key: "model", label: "模型", type: "text", default: "gpt-4o-mini" },
          { key: "intents", label: "意图列表 (JSON)", type: "json", default: ["knowledge-qa", "marketing-strategy", "chitchat", "out-of-scope"] },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
        ],
      },
    ],
  },
  {
    id: "multi-recall-merge",
    methods: [
      {
        id: "rrf-merge",
        label: "RRF 合并",
        params: [
          { key: "k", label: "RRF 常数 k", type: "number", default: 60, min: 1, max: 200 },
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
          { key: "additionalMatches", label: "附加检索结果 (JSON)", type: "json", default: [], hint: "可选：粘贴第二路检索结果数组，与主路结果合并融合" },
        ],
      },
      {
        id: "score-merge",
        label: "分数归一化合并",
        params: [
          { key: "topK", label: "Top K", type: "number", default: 10, min: 1, max: 100 },
          { key: "additionalMatches", label: "附加检索结果 (JSON)", type: "json", default: [] },
        ],
      },
    ],
  },
  {
    id: "fallback",
    methods: [
      {
        id: "reject-answer",
        label: "拒答（无法回答）",
        params: [
          { key: "minMatchCount", label: "最少命中数", type: "number", default: 1, min: 0, max: 10, hint: "低于此数量时触发降级" },
          { key: "minScore", label: "最低分数", type: "number", default: 0.3, min: 0, max: 1 },
          { key: "message", label: "拒答消息", type: "textarea", default: "抱歉，我目前没有足够的信息来回答这个问题。" },
        ],
      },
      {
        id: "generic-response",
        label: "通用兜底回复",
        params: [
          { key: "minMatchCount", label: "最少命中数", type: "number", default: 1, min: 0, max: 10 },
          { key: "minScore", label: "最低分数", type: "number", default: 0.3, min: 0, max: 1 },
          { key: "model", label: "模型", type: "text", default: "gpt-4o-mini" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
        ],
      },
    ],
  },
  {
    id: "prompt-build",
    methods: [
      {
        id: "rag-template",
        label: "RAG 标准模板",
        params: [
          { key: "systemPrompt", label: "System Prompt（可选）", type: "textarea", default: "", placeholder: "留空使用默认 RAG 角色设定" },
          { key: "maxContextTokens", label: "最大 context tokens", type: "number", default: 2000, min: 100, max: 8000 },
          { key: "includeSourceRefs", label: "要求 LLM 标注 evidence 引用", type: "boolean", default: true },
        ],
      },
      {
        id: "marketing-template",
        label: "营销场景模板",
        params: [
          { key: "targetAudience", label: "目标受众", type: "text", default: "", placeholder: "例: B2B SaaS 决策者" },
          { key: "tone", label: "语气", type: "select", default: "professional", options: [{ value: "professional", label: "专业" }, { value: "casual", label: "轻松" }, { value: "persuasive", label: "说服性" }] },
          { key: "maxContextTokens", label: "最大 context tokens", type: "number", default: 2000, min: 100, max: 8000 },
        ],
      },
    ],
  },
  {
    id: "output-validation",
    implemented: false,
    methods: [
      {
        id: "format-check",
        label: "格式校验",
        params: [
          { key: "checkHallucination", label: "幻觉检测", type: "boolean", default: true },
          { key: "checkCitations", label: "引用有效性验证", type: "boolean", default: true },
          { key: "filterSensitive", label: "敏感词过滤", type: "boolean", default: false },
        ],
      },
    ],
  },
  {
    id: "evaluation",
    methods: [
      {
        id: "rag-metrics-only",
        label: "算法指标（无 LLM）",
        params: [
          {
            key: "scoreThreshold",
            label: "命中率阈值",
            type: "number",
            default: 0.5,
            min: 0,
            max: 1,
            step: 0.05,
            hint: "evidence score 超过此值才计为命中；dense-vector 结果通常在 0.3-0.9，RRF 结果通常在 0.01-0.03",
          },
        ],
      },
      {
        id: "rag-metrics-with-faithfulness",
        label: "算法指标 + LLM Faithfulness",
        params: [
          {
            key: "scoreThreshold",
            label: "命中率阈值",
            type: "number",
            default: 0.5,
            min: 0,
            max: 1,
            step: 0.05,
            hint: "同上",
          },
          {
            key: "model",
            label: "模型",
            type: "text",
            default: "",
            placeholder: "留空则读取 LLM_MODEL 环境变量",
          },
          {
            key: "apiKey",
            label: "API Key（可选）",
            type: "password",
            default: "",
            placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量",
          },
          {
            key: "baseUrl",
            label: "API Base URL（可选）",
            type: "text",
            default: "",
            placeholder: "留空则读取 LLM_BASE_URL",
          },
        ],
      },
    ],
  },
];

export default registry;

export function getStage(stageId: string): StageDef | undefined {
  return registry.find((s) => s.id === stageId);
}
