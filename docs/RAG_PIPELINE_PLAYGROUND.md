# RAG Pipeline Playground 细化说明

## 目标

Playground 不一次性执行整条 RAG pipeline，而是让用户逐个 stage 配置、运行、观察产物和 trace。每个 stage 都有独立 API、method selector、参数表单、run button、output preview 和 trace 面板。

## 执行模型

- Playground 打开时先加载已上传 documents，用户选择一个 document version 作为当前 pipeline 输入。
- 前端维护当前 `pipelineRun` 的上下文。
- 每个 stage 只能在必需 inputRef 存在时运行；ingestion 的第一个 inputRef 来自已选择的 document version。
- 每次点击 run 都创建一次 `stepRun`，记录 method、params、inputRef、outputRef、status、durationMs、warnings、error。
- 下一阶段默认使用上一阶段最新成功 output，也允许用户从历史成功 output 中选择。
- 不自动 fallback 到其他 provider 或 method；用户选择什么，就执行什么，失败时明确显示错误码。

## Stage 交付规则

`feat-002.1` 完成后，任何 RAG stage 都不能只交付后端逻辑或独立 API。每个 stage 交付时必须同时保证 Playground 可用：

- 该 stage 出现在左侧 pipeline steps 中，并能被选中。
- 中间配置区能展示该 stage 的 method selector、params、默认值和校验状态。
- run button 能触发对应 API 或本地 action，并显示 running、success、error 状态。
- 右侧 output/trace 区能展示该 stage 的产物、durationMs、warnings、error 和 trace。
- 已完成 stages 的既有交互不能回归。
- 如果该 stage 依赖上游 output，缺失 inputRef 时必须在 UI 中展示阻塞原因。

每次 stage 交付前，必须按 `docs/VERIFICATION.md` 的 Stage 交付门禁完成验证，并把证据写入 `progress.md` 和 `feature_list.json`。

## Playground 基础能力

### feat-002.1 Playground Shell Scaffold

创建 Next.js + TypeScript + Tailwind/shadcn 应用。首页直接进入 Playground，不做营销 landing page。

验收：

- `localhost:3000` 打开后是工作台页面。
- 页面具备应用标题、当前 pipeline run 状态和基础空状态。

### feat-002.2 三栏工作台布局

左侧显示 pipeline stages，中间显示当前 stage 配置，右侧显示 output/trace。

验收：

- 左侧 stages 可点击切换。
- 中间区域随 stage 切换展示不同 method 和参数。
- 右侧区域展示当前 stage 的 output、trace、warnings、error。

### feat-002.3 Stage 配置表单渲染器

基于 stage registry 的 params schema 动态渲染参数控件。

验收：

- 支持 text、number、boolean、select、textarea、json 等基础控件。
- 每个 method 有 default params。
- 参数非法时，run button 禁用或显示校验错误。

### feat-002.4 Stage 执行与状态面板

每个 stage 都有 run button 和运行状态。

验收：

- 支持 idle、running、success、error 状态。
- 展示 durationMs、warnings、error code、trace JSON。
- 同一 stage 可以重复运行并保留历史 step runs。

### feat-002.5 Document Upload & Library

提供文档上传、入库保存、历史文档自动加载和选择能力。它是 RAG pipeline 的输入入口，必须在第一个 ingestion stage 前完成。

保存策略：

- 保存原始文件或原始文本，便于复查和重新 preprocess。
- 保存 fileName、fileSize、mimeType、hash、version、createdAt、updatedAt、lastSelectedAt。
- 保存解析前的 rawText/rawObjectRef；PDF 需保留可追踪 source metadata。
- 每次上传同 hash 文档时，根据 idempotency policy 标记 duplicated、新版本或替换版本。

验收：

- 用户可以上传 MD/TXT/PDF 或粘贴文本创建文档。
- 上传成功后文档立即出现在文档库列表中。
- 刷新或重新进入页面时，Playground 自动加载已上传文档列表。
- 用户可以选择一个已上传 document version 作为当前 pipeline input。
- 文档库展示 fileName、version、fileSize、mimeType、hash、createdAt、processing status。
- 未选择文档时，后续 ingestion stages 展示缺少 document input 的阻塞原因。

### feat-002.6 Pipeline 上下文与产物传递

管理 stage 之间的 input/output 依赖。

验收：

- 当前 pipeline context 必须包含 selectedDocumentId 和 selectedDocumentVersionId。
- 缺少上游 output 时，下游 stage 展示阻塞原因。
- 上游重新运行成功后，下游提示 input 已变化，需要重新运行。
- 用户可以查看每个 outputRef 对应的产物摘要。

## RAG Ingestion Stages

### feat-003.1 Document Idempotency Stage

作用：判断同一文档是否已经处理过，避免重复入库。

Methods：

- `sha256-content`：对原始内容计算 SHA-256。
- `normalized-sha256`：清洗空白后计算 SHA-256。
- `file-signature`：基于 fileName、fileSize、lastModified 和 content hash 生成签名。

参数：

- `versionPolicy`：`skip-existing`、`new-version`、`replace-existing`。
- `normalizeWhitespace`：是否归一化空白。
- `includeFileName`：是否把文件名纳入 signature。

Playground 输出：

- fileName、fileSize、hash、exists、documentId、version、recommendedAction。
- trace 中记录 hash method、耗时和重复判断依据。

### feat-003.2 Preprocess Stage

作用：把 MD/TXT/PDF 统一成 clean text，并保留 source metadata。

Methods：

- `markdown-structure`：保留 Markdown heading path。
- `plain-text`：处理 TXT 或纯文本。
- `pdf-pages`：按页解析 PDF，保留 page number。

参数：

- `preserveHeadings`、`removeBoilerplate`、`pdfPageRange`、`maxChars`。

Playground 输出：

- rawText、cleanText、metadata、sourceRefs、warnings。
- PDF 输出需要展示 page-level sourceRef。

### feat-003.3 Chunk Stage

作用：把 clean text 拆成可检索 chunks。

Methods：

- `recursive`：按 separators 递归切分。
- `fixed-size`：固定字符/token 长度切分。
- `markdown-heading`：按 Markdown heading path 切分。

参数：

- `chunkSize`、`overlap`、`separators`、`minChunkSize`、`headingDepth`。

Playground 输出：

- chunk list、chunk count、token estimate、每个 chunk 的 sourceRef 和 metadata。
- 支持点击 chunk 查看完整内容。

### feat-003.4 Transform Stage

作用：增强 chunk，使其更适合 retrieval。

Methods：

- `none`：不增强。
- `heading-context`：给 chunk 注入标题和 heading path。
- `summary-keywords`：生成 summary 和 keywords。

参数：

- `includeTitle`、`includeHeadingPath`、`keywordCount`、`summaryMaxTokens`。

Playground 输出：

- original chunk、enhanced chunk、diff、metadata、warnings。

### feat-003.5 Embedding Stage

作用：为 chunks 生成向量。

Methods：

- `openai-3-small`
- `hf-tei-embedding`
- `hf-transformers-js-embedding`
- `debug-deterministic`

参数：

- `provider`、`model`、`dimension`、`batchSize`。

错误码：

- `provider_missing_api_key`
- `provider_unavailable`
- `provider_model_not_found`
- `provider_not_configured`

Playground 输出：

- embedding dimension、provider、model、modelSource、latencyMs、costEstimate、batch summary。
- 不展示完整高维向量，默认只展示 preview。

### feat-003.6 Storage Stage

作用：将 document、chunks、embeddings 和 metadata 写入 PostgreSQL + pgvector。

Methods：

- `pgvector-upsert-version`
- `pgvector-new-version`
- `pgvector-replace-version`

参数：

- `conflictPolicy`、`documentVersion`、`indexMode`。

Playground 输出：

- stored document、storedChunkCount、storedEmbeddingCount、embedding index config、dimension guard 结果。

## Retrieval Stages

### feat-004.1 Query Rewrite Stage

Methods：

- `none`
- `rule-keyword-expansion`
- `llm-marketing-rewrite`

参数：

- `provider`、`model`、`temperature`、`maxQueries`、`rewriteGoal`、`targetAudience`。

输出：

- rewritten queries、rewrite reason、provider trace。

### feat-004.2 Retrieval Stage

Methods：

- `dense-vector`
- `postgres-fulltext`
- `hybrid-rrf`

参数：

- `topK`、`threshold`、`vectorWeight`、`textWeight`、`filters`。

输出：

- matched chunks、score、sourceRef、retrieval trace。

### feat-004.3 Filter Stage

Methods：

- `score-threshold`
- `metadata-filter`
- `mmr-diversity`

参数：

- `minScore`、`maxPerDocument`、`requiredSourceTypes`、`mmrLambda`。

输出：

- filtered matches、removed matches、过滤原因。

### feat-004.4 Rerank Stage

Methods：

- `score-only`
- `metadata-boost`
- `hf-tei-rerank`
- `llm-relevance-rerank`

参数：

- `provider`、`model`、`rerankTopN`、`criteria`、`temperature`。

输出：

- 排序前后对比、rerank score、provider trace、warnings。

### feat-004.5 Citation Stage

Methods：

- `chunk-citation`
- `page-aware-citation`
- `snippet-citation`

参数：

- `snippetLength`、`includePage`、`maxEvidencePerClaim`。

输出：

- evidence pack、citations、source refs、citation trace。
