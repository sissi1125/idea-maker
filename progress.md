# 进度记录

## 2026-05-20（会话 10）

### 已完成

- 实现 `feat-007` Stage 快照持久化与 Pipeline 全链路追踪：
  - 新建 `app/components/playground/JsonView.tsx`：从 OutputTracePanel 提取 JsonView/truncateStrings/VectorSummary 为共享组件。
  - 新增 `StageSnapshot`、`PipelineRunRecord`、`PipelineRunStageEntry` 类型到 `lib/types.ts`。
  - 新建 `lib/snapshotDb.ts`：PostgreSQL DDL（stage_snapshots + pipeline_run_history）+ 全套 CRUD 工具函数。
  - 新建 4 个 API 路由：`/api/snapshots`（POST）、`/api/snapshots/[stageId]`（GET）、`/api/pipeline-runs`（POST+GET）、`/api/pipeline-runs/[id]`（GET）。
  - 扩展 `PlaygroundShell.tsx`：快照上游注入 state、save pipeline run、trace drawer toggle、Header 新增"🔗全链路"和"💾保存Run"按钮。
  - 扩展 `StageConfigPanel.tsx`：快照栏（显示上次快照、使用此快照作为上游输入、运行按钮文案变化）。
  - 新建 `PipelineTraceDrawer.tsx`：底部抽屉，Tab1=当前 pipeline 全 stage 状态（按 group 分组，内联展开 output/trace），Tab2=历史 pipeline run 列表。
  - typecheck + lint + init.sh 全部通过。

### 当前状态

- `feat-007` 完成。feat-005（Marketing Generation）待实现。
- 下一步：`feat-005`（产品画像、卖点地图、内容 idea 生成）。

---

## 2026-05-19（会话 9，harness 一致性修复）

### 已完成

- Harness 一致性审查：发现 session-handoff.md 滞后、progress.md 缺失多会话记录、面试题粒度不符规则。
- 重写 `session-handoff.md`（反映真实 HEAD `524c0e5`、feat-004.x 全部 done、worktree 已完成）。
- 补记 `progress.md` 会话 8～9，修正会话 7"当前状态"与 feature_list.json 的矛盾。
- 为 feat-004.1～004.5 各补独立面试题文件（`.interview/feat-004.x_*.md`）。

### 当前状态

- `feat-001`～`feat-004.5` 全部完成。Harness 五子系统一致。
- 下一步：`feat-005` Marketing Generation。

---

## 2026-05-19（会话 8）

### 已完成

- 实现 `feat-004.1` Query Rewrite Stage：
  - `app/api/pipeline/query-rewrite/route.ts`：三种方法（none / rule-keyword-expansion / llm-marketing-rewrite）。
  - rule 方法：TF 停用词过滤 + 营销模板扩展，生成最多 maxQueries 个变体。
  - llm 方法：OpenAI JSON mode，apiKey 表单字段；扩展后去重。
  - typecheck+lint 通过，curl 验证（三种方法均正确返回 rewrittenQueries 列表）。

- 实现 `feat-004.2` Retrieval Stage：
  - `app/api/pipeline/retrieval/route.ts`：三种方法（dense-vector / postgres-fulltext / hybrid-rrf）。
  - dense-vector：embed query + pgvector 余弦搜索，多 query 最高分合并。
  - postgres-fulltext：tsvector + plainto_tsquery，simple 字典。
  - hybrid-rrf：两路结果 RRF k=60 合并。
  - connectionString / embeddingConfig 支持表单直接配置；AggregateError unwrap。

- 实现 `feat-004.3` Filter Stage：
  - `app/api/pipeline/filter/route.ts`：三种方法（score-threshold / metadata-filter / mmr-diversity）。
  - score-threshold：分数下限 + 每文档上限。
  - metadata-filter：sourceRef 白名单过滤。
  - mmr-diversity：Jaccard 词集 MMR，lambda 参数控制多样性权重。
  - output 含 filteredMatches / removedMatches / removedReasons。

- 实现 `feat-004.4` Rerank Stage：
  - `app/api/pipeline/rerank/route.ts`：四种方法（score-only / metadata-boost / hf-tei-rerank / llm-relevance-rerank）。
  - llm-relevance-rerank：Promise.all 并行打分，OpenAI JSON mode。
  - output 含 rankChanges（排序前后 index 对比）。

- 实现 `feat-004.5` Citation Stage：
  - `app/api/pipeline/citation/route.ts`：三种方法（chunk-citation / page-aware-citation / snippet-citation）。
  - evidenceId = `{documentId}_v{version}_c{chunkIndex}`，全链路可溯源。
  - output 含 evidencePack + contextText（供 prompt-build 使用）。

- 实现 5 个可选步骤 API routes（feat-003.7 stub → 实现）：
  - `context-management`：对话历史注入、query 前追加上下文轮次。
  - `intent-recognition`：规则分类（informational / comparative / transactional）+ LLM 方法。
  - `multi-recall-merge`：合并多路召回结果，RRF 重打分。
  - `fallback`：retrieval 质量低于阈值时触发兜底策略（返回摘要/拒绝/默认回答）。
  - `prompt-build`：将 evidencePack + query 拼装为 LLM prompt，支持多模板。

- Docker 支持：`docker-compose.yml` 加入 bitnami/postgresql（含 vector.so）；`services/postgres/Dockerfile` 备用构建方案；`.env.local.example` 记录全部 env 变量。

- query propagation 修复：originalQuery 从 query-rewrite → retrieval → filter → rerank → citation 全链路透传。

- 补 `.interview/feat-004_retrieval-pipeline.md`（5 道综合面试题，覆盖 RRF、MMR、Bi/Cross-encoder、Citation evidenceId）。

### 当前状态

- `feat-004.1`～`feat-004.5` 全部完成，5 个可选步骤实现完毕。
- 下一步：修复若干 UI/后端 bug，然后实现 feat-005。

---

## 2026-05-19（会话 8 续，bug 修复）

### 已完成

- **BUG-001/002/003**（commit `e873cc1`）：
  - TransformedChunk.enhancedText 改为可选（`?`），embedding 方法全部改用 `c.enhancedText ?? c.text` fallback。
  - Storage route 新增 `truncateTable` 参数（TRUNCATE rag_chunks before insert），解决 Dimension Guard 误拦截。
  - 新建 `app/lib/providers.ts`：`createLLMClient` / `createEmbeddingClient` 工厂，读 `LLM_*` / `EMBEDDING_*` env，支持 Qwen/DashScope 和任意 OpenAI-compatible endpoint。

- **BUG-UI-1/2/3**（commit `6fca865`）：
  - 切换 stage 后 params 被重置：将 (methodId, params) state 提升到 PlaygroundShell 作为 `stageParamsMap`，导航回 stage 时恢复填入值。
  - Embedding output 含大向量导致浏览器崩溃：`truncateStrings()` 检测 length>16 的 number[] 并替换为 `__vector {dimension, preview}` 摘要；新增 `VectorSummary` 组件，full 向量懒展开。
  - HNSW/IVFFlat DDL：embedding 列需要显式 `vector(N)` 类型，修复 DDL 生成逻辑。

- **BUG-004/005/006**（commit `6114117`）：
  - 可选步骤关闭后 Run 按钮未禁用：`StageConfigPanel.runDisabled` 加入 `!stageActive` 检查，显示"步骤已关闭"提示。
  - Qwen embedding 维度校验：`embeddingDimension` min 从 1 改为 64（Qwen 最小允许值），default 改为 1024；提示有效维度列表。
  - Embedding/Retrieval 默认 provider 全部改为 Qwen text-embedding-v4（baseUrl 指向 DashScope）。

- **batchSize 默认值**（commit `ffe2fc8`）：
  - `app/api/pipeline/embedding/route.ts` batchSize 默认值手动修正。

### 当前状态

- 所有已知 bug 修复完毕，working tree 干净，已合并至 main（HEAD `524c0e5`）。
- 下一步：`feat-005` Marketing Generation。

---

## 2026-05-19（会话 7）

### 已完成

- feat-003.5 改进：为 `openai-3-small` 加 `apiKey` 表单字段（password 类型），为 `hf-tei-embedding` 加 `endpoint` 表单字段；`ParamType` 扩展 `"password"`；`ParamForm` 加 password 分支；表单值优先于环境变量。
- 实现 `feat-003.6` Storage Stage（详见会话 6 条目，本会话合并到 main）。
- 完成 `feat-003.7` 架构设计：`docs/ORCHESTRATION.md`（步骤分类、依赖解析、UI 设计、7 个变更文件、4 个待决策问题）；`feature_list.json` 注册 feat-003.7，更新 feat-004 依赖。
- 实现 `feat-003.7` Pipeline Step Orchestration Infrastructure：
  - 新建 `lib/pipelineStages.ts`：19 个步骤，含 category/module/conditionKey/defaultEnabled。
  - `lib/types.ts`：迁移 PipelineRun（原在 PlaygroundShell.tsx），加 enabledSteps/runtimeContext/createPipelineRun。
  - `lib/pipelineDeps.ts`：补全 STAGE_DEPS（18 条含新步骤），加 resolveEffectiveUpstream/isStageActive。
  - `lib/stageRegistry.ts`：加 `implemented?` 字段 + 6 个新步骤 stub（均含参数 schema）。
  - `PipelineStepList.tsx`：重构为 pipelineStages.ts 驱动，hover 显示 toggle 开关，★优化标记，图例。
  - `PlaygroundShell.tsx`：接入 resolveEffectiveUpstream，handleToggleStep 清空下游结果，createPipelineRun。
  - `StageConfigPanel.tsx`：修复 getBlockReason（区分 ingestion/query 链），CategoryBadge，implemented 检查。
  - 修 `storage/route.ts` 遗留 lint warning（dimension 参数未使用）。
- Harness 一致性审查 + 更新：
  - `session-handoff.md` 重写（Session 4 → Session 7，完整当前状态）
  - `AGENTS.md` 修正面试题规则（写入 `.interview/` 文件夹）+ 补充必需资产（ORCHESTRATION.md / .interview/）
  - `ARCHITECTURE.md` 删除错误的"待引入 pgvector/embedding"、更新存储模型描述、更新两条 pipeline 图
  - `init.sh` required_files 加入 `docs/ORCHESTRATION.md`

- `feat-003.7` 完整实现完成（7 个文件改动，见上方"已完成"列表），typecheck+lint 通过，dev server 正常。

### 当前状态

- `feat-001`～`feat-003.7` 全部完成。
- 下一步：`feat-004.1` Query Rewrite Stage。

---

## 2026-05-19（会话 6）

### 已完成

- 修复 UI：blocked stage 不再显示全屏 BlockedNotice，方法/参数始终可见；运行按钮 disabled + 右侧显示 `⚠ 原因` 提示。
- 实现 `feat-003.4` Transform Stage：
  - `app/api/pipeline/transform/route.ts`：三种方法。
    - `none`：透传，enhancedText = text，transformedCount = 0。
    - `heading-context`：前缀注入 `documentTitle\nsourceRef\n\n原文`，transformedCount 计入有效注入数。
    - `summary-keywords`：TF 词频关键词（停用词过滤）+ 规则句子摘要，`appendToChunk` 控制是否拼到 enhancedText 末尾。
  - `lib/stageRegistry.ts`：heading-context 补 `documentTitle` 参数；summary-keywords 补 `appendToChunk` 参数。
  - output 含 `enhancedText / injectedPrefix / keywords / summary / enhancedTokenEstimate`。
- curl 验证：三种方法均通过；typecheck 通过。

- 实现 `feat-003.5` Embedding Stage：
  - `app/api/pipeline/embedding/route.ts`：四种 provider。
    - `debug-deterministic`：FNV-1a 哈希确定性单位向量，无需外部服务，用于流程验证。
    - `openai-3-small`：调 OpenAI /v1/embeddings，需 OPENAI_API_KEY，支持 dimensions 降维。
    - `hf-tei-embedding`：HTTP fetch 调自托管 TEI 服务，需 HF_TEI_ENDPOINT。
    - `hf-transformers-js-embedding`：@huggingface/transformers 本地推理，mean_pooling + normalize。
  - 批处理支持 batchSize；动态 import openai/transformers 避免未用 provider 加载大包。
  - output 含 EmbeddedChunk（embedding/embeddingDimension）+ costEstimate（OpenAI 费用估算）。
- curl 验证：debug-deterministic dim=4 正确，确定性验证通过；missing_upstream 返回 400；typecheck 通过。
- 补 `.interview/feat-003.5_embedding-stage.md`（5 道面试题）。

- 实现 `feat-003.6` Storage Stage：
  - `app/api/pipeline/storage/route.ts`：三种写入策略。
    - `pgvector-upsert-version`：ON CONFLICT DO UPDATE，conflictPolicy=upsert/error。
    - `pgvector-new-version`：查最大 version，+1 后全量插入，保留历史版本。
    - `pgvector-replace-version`：先 DELETE 该 documentId 所有旧 chunk，再 INSERT。
  - 自动 DDL 初始化 rag_documents/rag_chunks 表和索引（含 UNIQUE 约束）。
  - Dimension Guard：写入前检查现有向量维度，不匹配返回 409。
  - HNSW/IVFFlat/none 三种索引模式，IVFFlat lists = sqrt(rowCount)。
  - connectionString 表单字段（优先于 DATABASE_URL env）；同样模式也用于 embedding stage。
  - AggregateError unwrap：修复 Node 18+ 连接拒绝时 message 为空的问题。
- 安装 pg + pgvector + @types/pg；stageRegistry 三个 storage 方法均补充 connectionString 参数。
- curl 验证：missing_upstream/missing_connection/db_connection_refused 错误码均正确；typecheck 通过。
- 补 `.interview/feat-003.6_storage-stage.md`（5 道面试题）。

### 当前状态

- `feat-003.3`～`feat-003.6` 全部完成。下一步：`feat-004.1` Query Rewrite Stage。

---

## 2026-05-19（会话 5）

### 已完成

- 实现 `feat-003.3` Chunk Stage：
  - `app/api/pipeline/chunk/route.ts`：三种方法全部实现。
    - `fixed-size`：固定字符滑动窗口，支持 overlap；overlap ≥ chunkSize 时自动截断并 warning。
    - `recursive`：递归语义切分，按分隔符优先级（段落→换行→空格→字符）找语义边界，对标 LangChain RecursiveCharacterTextSplitter；支持可自定义 separators 和 minChunkSize。
    - `markdown-heading`：按 Markdown 标题（#/##...）边界切分，保持章节完整；章节超过 maxChunkSize 时降级为 fixed-size。
  - 每个 chunk 含：`index / text / charStart / charEnd / charCount / tokenEstimate（chars/4 近似）/ sourceRef（继承预处理的 heading path）`。
  - output 统计：`chunkCount / totalChars / avgChunkSize / maxChunkSize / minChunkSize`。
  - `PlaygroundShell.tsx`：`handleRun` 扩展，通过 `STAGE_DEPS` 自动查找上游 stageId 并将其最新 output 作为 `upstreamOutput` 发给 API；所有下游 stage（chunk/transform/embedding 等）无需修改即可复用。
- `npm install` 补全 pdf-parse/turndown/mammoth 类型缺失依赖；typecheck 通过。

### 验证

- curl 直接测试（localhost:3001）：
  - `recursive`：输入 127 字符文本 → 1 chunk（chunkSize=200），sourceRef=产品介绍 ✓
  - `fixed-size`：chunkSize=50/overlap=10 → 2 chunks，avgSize=40 ✓
  - `markdown-heading`：headingDepth=2 → 3 chunks 按章节边界切分，sourceRef 正确 ✓
  - `upstreamOutput=null` → 400 missing_upstream 错误 ✓
- typecheck：`npx tsc --noEmit` 通过（无报错） ✓

### 当前状态

- `feat-003.3` 完成，下一步：`feat-003.4` Transform Stage。
- dev server：localhost:3001（端口 3000 已被另一 worktree 占用）。

---

## 2026-05-18（会话 4）

### 已完成

- 实现 `feat-002.5` Document Upload & Library：
  - `lib/docStore.ts`：本地 JSON 存储（`data/documents.json`），含 SHA-256 哈希、version 追踪。
  - `GET /api/documents`：列出所有文档（按 createdAt 降序）。
  - `POST /api/documents`：支持 multipart/form-data（文件）和 JSON（粘贴文本）两种入口。
  - `DocumentUploadPanel`：粘贴文本/上传文件 tab、实时上传、文档库卡片（含 hash 前缀/version/size/mimeType/createdAt）。
  - 选中文档后：Header 显示文件名+版本；`pipelineRun.selectedDocumentId` 更新；后续 stages 解锁。
  - 页面刷新后自动通过 `GET /api/documents` 加载已上传文档。
- 浏览器全程验证：上传 → 保存 → 刷新 → 自动加载 → 选中 → pipeline 解锁。

### 当前状态

- `feat-002.1` ~ `feat-002.5` 全部完成。
- 下一步：`feat-002.6` Pipeline 上下文与产物传递（上游 output 作为下游 inputRef，缺失时展示阻塞原因，上游重跑后提示下游需重跑）。

---

## 2026-05-18（会话 3）

### 已完成

- 实现 `feat-002.2` 三栏工作台布局：
  - 左侧 PipelineStepList 加入 stepRun 状态圆点（运行中蓝色动画 / 成功绿色 / 错误红色）。
  - 中间 StageConfigPanel 随 stage 切换自动更新内容和 method。
  - 右侧 OutputTracePanel 展示 durationMs、warnings、error、output、trace（可折叠）；多次 run 历史可通过 select 切换。

- 实现 `feat-002.3` Stage 配置表单渲染器：
  - `lib/stageRegistry.ts`：定义全部 13 个 stages 的 methods 和 params schema。
  - `ParamForm.tsx`：动态渲染 text/number/boolean/select/textarea/json 六种控件。
  - method 切换自动 reset params 到 default；required/min/max/json 格式校验；错误时 run button 禁用。

- 实现 `feat-002.4` Stage 执行与状态面板：
  - PlaygroundShell 维护 `stepRuns` map（按 stageId 分组，最新 run 在最前）。
  - 每次 run 调用 `/api/pipeline/{stageId}` POST；错误时捕获 JSON parse 失败（API 未实现时返回 HTML 404）。
  - `lib/types.ts`：定义 `StepRun`、`StepRunMap` 类型。

- TypeCheck 全部通过（无报错）。

### 当前状态

- `feat-002.2`、`feat-002.3`、`feat-002.4` 已完成，feature_list.json 状态已更新为 `done`。
- 浏览器验证：stage 切换正常；文档幂等性检查 method selector 和 params 渲染正常；run button 触发 API 调用并正确显示 network_error（API 尚未实现）。
- 下一步：实现 `feat-002.5` Document Upload & Library。

### 验证

- TypeCheck：`cd app && npx tsc --noEmit` → 通过。
- 浏览器：stage 切换（左侧点击）→ 中间 method selector + params 跟随更新 ✓；blocked 提示（无文档时）✓；run 按钮 → network_error 展示正确 ✓。

---

## 2026-05-18（会话 2）

### 已完成

- 实现 `feat-002.1` Playground Shell Scaffold：
  - 脚手架 Next.js 16 + React 19 + TypeScript + Tailwind v4，应用位于 `app/` 目录。
  - 首页直接进入 Playground 工作台，无 landing page。
  - Header：应用标题 + pipeline 状态徽章（idle/running/success/error）+ 未选文档提示。
  - 左侧：`PipelineStepList`，展示所有 pipeline stages（ingestion/retrieval/generation 分组），可点击切换。
  - 中间：`StageConfigPanel`，展示选中 stage 的配置空状态；未选文档时展示 BlockedNotice。
  - 右侧：`OutputTracePanel`，展示 output/trace 空状态。
  - TypeScript typecheck 通过（无报错）。
  - `init.sh` 更新：加入 `app/package.json` 检测，依次运行 typecheck 和 lint。
  - `app/package.json` 增加 `typecheck`（`tsc --noEmit`）和 `lint`（`next lint`）脚本。

### 当前状态

- `feat-002.1` 已完成，feature_list.json 状态已更新为 `done`。
- Next.js 应用代码在 `app/` 目录，待运行 `npm run dev` 可在 `localhost:3000` 访问。
- 下一步：实现 `feat-002.2` 三栏工作台布局（将空状态替换为实际交互逻辑和 stage 切换动画）；之后依序实现 feat-002.3（表单渲染器）、feat-002.4（执行状态面板）、feat-002.5（Document Upload & Library）、feat-002.6（pipeline context）。

### 验证

- TypeScript typecheck：`cd app && npx tsc --noEmit` → 通过（无输出）。
- 下次开发前运行 `./init.sh` 验证 harness 文件和 JSON 结构。
- Playground UI 功能验证需启动 dev server：`cd app && npm run dev`。

---

## 2026-05-18（会话 1）

### 已完成

- 建立 Marketing RAG Playground 的 harness 基座。
- 记录产品范围、架构、API contracts、验证门禁、feature 状态和 session handoff 机制。
- 将 harness 文档主体改为中文，并在 `AGENTS.md` 加入默认中文维护规则。
- 将 `docs/PRODUCT.md` 从单一阶段范围说明调整为项目整体多阶段规划。
- 按“每次执行一个 RAG pipeline stage + 对应 Playground 功能”的方式细化 `feat-002`、`feat-003` 和 retrieval 相关后续 feature。
- 增加 Playground 可用性门禁：`feat-002.1` 后，每个 stage 交付前必须验证 Playground 仍然可用。
- 补充 Document Upload & Library：上传文档后保存原文和解析前 metadata，页面再次进入时自动加载已上传文档并可选择 document version 作为 pipeline 输入。
- 已初始化 git repository，并提交 harness 基座：`44306a5 Initialize harness foundation`。
- 已在 `AGENTS.md` 增加 git/lifecycle 状态同步约束：状态变化后必须同步 `progress.md` 和 `session-handoff.md`，并在最终回复前完成验证。

### 当前状态

- 仓库已初始化为 git repository，当前分支为 `main`。
- 当前 working tree 干净。
- 暂无应用代码。
- Harness 文件已经定义目标 Next.js、TypeScript、RAG、retrieval 和 marketing generation 边界。

### 下一步建议

启动 `feat-002.1`：脚手架 Next.js Playground shell；随后完成 Document Upload & Library，再按 `docs/RAG_PIPELINE_PLAYGROUND.md` 的顺序逐个 stage 添加 UI 和 API。

### 验证

- 文件创建或修改后运行 `./init.sh`，验证必需 harness 文件和 JSON 结构。
- 当前 harness 基座提交前已运行 `./init.sh`，文件检查、JSON 校验和 feature status 校验均通过。
- 发生 git/lifecycle 状态变化后，必须检查 `progress.md` 和 `session-handoff.md` 是否与真实状态一致。
- Playground 搭建后，每个 stage 交付前按 `docs/VERIFICATION.md` 的 Stage 交付门禁记录验证证据。

### 风险 / 备注

- 阶段 1 必须保持 provider 选择显式；用户选择真实 provider 时，不做静默 fallback。
- Storage 主线采用 PostgreSQL + pgvector，adapter 边界仍需清晰，方便后续扩展。
