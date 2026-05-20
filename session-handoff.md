# 会话交接

## 最后更新

2026-05-20（会话 14）

## 项目

Marketing RAG Playground：一个可调试的 RAG 驱动产品运营 idea 生成系统。

## 当前状态

### 已完成 features

| Feature | 描述 | 状态 |
|---------|------|------|
| feat-001 | Harness 基座 | done |
| feat-002.1～002.6 | Playground Shell + 三栏布局 + 表单渲染 + Stage 执行 + Document Upload + Pipeline 上下文 | done |
| feat-003.1 | Document Idempotency Stage | done |
| feat-003.2 | Preprocess Stage | done |
| feat-003.3 | Chunk Stage（fixed-size / recursive / markdown-heading） | done |
| feat-003.4 | Transform Stage（none / heading-context / summary-keywords） | done |
| feat-003.5 | Embedding Stage（openai / hf-tei / transformers.js / debug-deterministic；API Key 表单直接输入） | done |
| feat-003.6 | Storage Stage（pgvector upsert/new-version/replace-version；Dimension Guard；HNSW/IVFFlat） | done |
| feat-003.7 | Pipeline Step Orchestration（19 步骤定义；toggle UI；resolveEffectiveUpstream；5 个可选步骤全实现） | done |
| feat-004.1 | Query Rewrite Stage（none / rule-keyword-expansion / llm-marketing-rewrite） | done |
| feat-004.2 | Retrieval Stage（dense-vector / postgres-fulltext / hybrid-rrf） | done |
| feat-004.3 | Filter Stage（score-threshold / metadata-filter / mmr-diversity） | done |
| feat-004.4 | Rerank Stage（score-only / metadata-boost / hf-tei-rerank / llm-relevance-rerank） | done |
| feat-004.5 | Citation Stage（chunk-citation / page-aware-citation / snippet-citation） | done |
| feat-005 | Marketing Generation（product-persona / selling-points / content-ideas；专属展示面板） | done |
| feat-007 | Stage 快照持久化与 Pipeline 全链路追踪（stage_snapshots + pipeline_run_history；4 API 路由；PipelineTraceDrawer 底部抽屉） | done |
| feat-007.1 | 页面加载自动恢复 pipeline 状态（GET /api/snapshots + useEffect mount restore） | done |
| feat-006 | RAG Quality Evaluation（hitRate/citationCoverage/confidenceScore + LLM Faithfulness judge；EvaluationOutputPanel 卡片展示） | done |

### 待做 features

| Feature | 描述 | 状态 |
|---------|------|------|
| feat-006 | RAG Quality Evaluation（hit rate、citation coverage、confidence） | todo |

### 技术状态

- **主分支**：`main`，当前 HEAD：`81915be`（fix: move citation stage before prompt-build in UI order and retrieval group）
- **工作树**：干净，无进行中的 worktree
- **Dev server**：`cd app && npm run dev`（端口 3000；若被占用自动升至 3001）
- **文档存储**：`app/data/documents.json`（本地 JSON，dev 阶段）
- **向量存储**：PostgreSQL + pgvector（`docker compose up postgres` 启动；需 `DATABASE_URL` env）
- **Provider 抽象**：`app/lib/providers.ts`（`createLLMClient` / `createEmbeddingClient`，读 `LLM_*` / `EMBEDDING_*` env，兼容 Qwen/DashScope）
- **面试题**：`.interview/` 目录，已覆盖 feat-002.5、feat-003.1～003.6、feat-004.1～004.5（各独立文件）

### 已实现的 API routes

```
POST /api/documents                       — 文档上传
GET  /api/documents                       — 文档列表
DELETE /api/documents/:id                 — 删除文档

POST /api/pipeline/idempotency            — 文档幂等性检查
POST /api/pipeline/preprocess             — 文档预处理
POST /api/pipeline/chunk                  — 分块
POST /api/pipeline/transform              — Transform 增强
POST /api/pipeline/embedding              — 向量化（4 providers）
POST /api/pipeline/storage                — pgvector 存储

POST /api/pipeline/context-management    — 对话上下文管理（可选步骤）
POST /api/pipeline/intent-recognition    — 意图识别（可选步骤）
POST /api/pipeline/query-rewrite         — Query 重写
POST /api/pipeline/retrieval             — 检索（dense-vector / fulltext / hybrid-rrf）
POST /api/pipeline/filter                — 过滤（score-threshold / metadata / mmr）
POST /api/pipeline/multi-recall-merge    — 多路召回合并（可选步骤）
POST /api/pipeline/rerank                — 重排序（4 methods）
POST /api/pipeline/citation              — 引用打包（3 methods）
POST /api/pipeline/fallback              — Fallback 兜底（可选步骤）
POST /api/pipeline/prompt-build          — Prompt 构建（可选步骤）
POST /api/pipeline/evaluation            — RAG 质量评估（2 方法：rag-metrics-only / rag-metrics-with-faithfulness）

POST /api/snapshots                      — 保存/更新 stage 快照
GET  /api/snapshots/:stageId             — 获取最新 stage 快照
POST /api/pipeline-runs                  — 保存完整 pipeline run 历史
GET  /api/pipeline-runs                  — 获取 pipeline run 列表
GET  /api/pipeline-runs/:id              — 获取单条 pipeline run 详情
```

### 已知 bugs（已修复）

| Bug | 描述 | 修复 commit |
|-----|------|------------|
| BUG-001 | TransformedChunk.enhancedText 为 undefined 时 Embedding crash | e873cc1 |
| BUG-002 | Dimension Guard 在切换 embedding 模型后误拦截 | e873cc1（truncateTable 参数） |
| BUG-003 | 仅支持 OpenAI，无法接入 Qwen/DashScope | e873cc1（lib/providers.ts） |
| BUG-004 | 可选步骤关闭后 Run 按钮未禁用 | 6114117 |
| BUG-005 | Qwen embedding 维度校验：debug-deterministic dim=4 被 API 拒绝 | 6114117（min=64，default=1024） |
| BUG-006 | Embedding 模型默认为 OpenAI，应改为 Qwen text-embedding-v4 | 6114117 |
| BUG-UI-1 | 切换 stage 后 params 被重置 | 6fca865（stageParamsMap lift） |
| BUG-UI-2 | Embedding output 含大向量导致浏览器崩溃 | 6fca865（VectorSummary 组件） |
| BUG-UI-3 | HNSW/IVFFlat DDL 需要 vector(N) 类型 | 6fca865 |

## 下一步

所有计划内 features（feat-001～feat-006）已全部完成。

潜在的后续方向（用户未明确要求）：
- 面试题补全：feat-006 的面试题文件（`.interview/feat-006_*.md`）
- 产品功能扩展：多文档对比、pipeline 配置导出/导入、评估结果历史对比

## 重要边界

- 阶段 1 是 Playground，不是 SaaS；无登录、计费、多租户。
- Embedding、rewrite、rerank 必须走显式 provider 选择；缺少配置时返回明确错误码，不静默 fallback。
- 每个生成的 selling point 和 idea 都必须包含 evidence references。
- Playground 搭建后，每个 stage 交付不能只交付 API；必须同时验证 UI 可打开、可切换、可运行、可查看 output/trace。
- 任何 git/lifecycle 状态变化后，最终回复前必须先同步 `progress.md` 和本文件。

## 验证

```bash
./init.sh                    # harness 文件检查 + JSON 校验 + typecheck + lint
docker compose up postgres   # 启动 pgvector（bitnami/postgresql + vector.so）
cd app && npm run dev        # 启动 dev server（localhost:3000）
```

快速冒烟测试（无需任何 env）：

```bash
curl -s -X POST http://localhost:3000/api/pipeline/embedding \
  -H "Content-Type: application/json" \
  -d '{
    "methodId": "debug-deterministic",
    "params": {"dimension": 64},
    "upstreamOutput": {
      "chunks": [{"index":0,"text":"test","charCount":4,"tokenEstimate":1,"sourceRef":""}],
      "chunkCount": 1,
      "warnings": []
    }
  }' | python3 -m json.tool
```
