# 会话交接

## 最后更新

2026-05-19（会话 7）

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
| feat-003.5 | Embedding Stage（openai-3-small / hf-tei / transformers.js / debug-deterministic）；API Key 和 TEI Endpoint 支持表单直接输入 | done |
| feat-003.6 | Storage Stage（pgvector upsert/new-version/replace-version；Dimension Guard；HNSW/IVFFlat） | done |
| feat-003.7 | Pipeline Step Orchestration 架构设计（`docs/ORCHESTRATION.md`，待 owner 确认后执行） | spec done / impl pending |

### 技术状态

- **主分支**：`main`，当前 HEAD：`cabb373`（Merge feat-003.7 feature registration）
- **工作树**：`gallant-dubinsky-b9bb6d`（`claude/gallant-dubinsky-b9bb6d` 分支）——正在开发中，每个 feature 合并后保留
- **Dev server**：`cd app && npm run dev`（端口 3000；若被占用自动升至 3001）
- **文档存储**：`app/data/documents.json`（本地 JSON，dev 阶段）
- **向量存储**：PostgreSQL + pgvector（API route 已实现，需 `DATABASE_URL` env）
- **面试题**：`.interview/` 目录，已覆盖 feat-002.5/003.1/003.2/003.3/003.4/003.5/003.6

### 已实现的 API routes

```
POST /api/documents           — 文档上传
GET  /api/documents           — 文档列表
DELETE /api/documents/:id     — 删除文档
POST /api/pipeline/idempotency  — 幂等性检查
POST /api/pipeline/preprocess   — 文档预处理
POST /api/pipeline/chunk        — 分块
POST /api/pipeline/transform    — Transform 增强
POST /api/pipeline/embedding    — 向量化（4 providers）
POST /api/pipeline/storage      — pgvector 存储
```

## 待决策项

1. **feat-003.7 4 个设计问题**（见 `docs/ORCHESTRATION.md` Section 7）：
   - fallback 的触发时机（retrievalQualityLow 写入时机）
   - context-management 成为新入口是否可接受
   - 条件步骤是否支持强制覆盖
   - 未实现步骤的 UI 展示方式

## 下一步

1. **等 owner 确认 feat-003.7 设计问题后**，执行 feat-003.7 实现（7 个文件改动）。
2. feat-003.7 完成后依次实现 feat-004.x：
   - feat-004.1 Query Rewrite Stage（rule + LLM 两种方法）
   - feat-004.2 Retrieval Stage（dense-vector / fulltext / hybrid-rrf）
   - feat-004.3 Filter Stage
   - feat-004.4 Rerank Stage
   - feat-004.5 Citation Stage
3. 新增步骤（来自 feat-003.7 设计）：intent-recognition / context-management / multi-recall-merge / fallback / prompt-build / output-validation

## 重要边界

- 阶段 1 是 Playground，不是 SaaS；无登录、计费、多租户。
- Embedding、rewrite、rerank 必须走显式 provider 选择；缺少配置时返回明确错误码，不静默 fallback。
- 每个生成的 selling point 和 idea 都必须包含 evidence references。
- Playground 搭建后，每个 stage 交付不能只交付 API；必须同时验证 UI 可打开、可切换、可运行、可查看 output/trace。
- 任何 git/lifecycle 状态变化后，最终回复前必须先同步 `progress.md` 和本文件。

## 验证

```bash
./init.sh           # harness 文件检查 + JSON 校验 + typecheck + lint
cd app && npm run dev   # 启动 dev server（localhost:3000）
```

快速验证 embedding（debug-deterministic，无需任何 env）：

```bash
# 先运行 dev server，然后
curl -s -X POST http://localhost:3000/api/pipeline/embedding \
  -H "Content-Type: application/json" \
  -d '{"methodId":"debug-deterministic","params":{"dimension":4},"upstreamOutput":{"chunks":[{"index":0,"text":"test","enhancedText":"test","charCount":4,"tokenEstimate":1,"enhancedTokenEstimate":1,"sourceRef":"","injectedPrefix":"","keywords":[],"summary":""}],"chunkCount":1,"warnings":[]}}' \
  | python3 -m json.tool
```
