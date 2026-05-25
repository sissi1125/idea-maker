# 会话交接

## 最后更新

2026-05-25（会话 20 — feat-100.1 完成：pnpm monorepo 骨架）

## 本会话变更摘要

阶段 2.5 架构重构 Wave 1 落地。把 Next.js 单体（`app/`）转成 pnpm workspace：
- `app/` → `apps/web/`（git mv 保历史）
- 新建占位：`apps/api/`（NestJS + HealthController）、`packages/rag-core/`、`packages/shared-types/`
- 包管理由 npm 切到 pnpm（`pnpm-workspace.yaml`、根级 scripts、`.npmrc`）
- `init.sh` 改走 `pnpm -r typecheck/lint`
- 全量验收：4 包 typecheck/lint 全过；`pnpm dev` 起 web 后 API 烟测正常；`bash init.sh` 跑通
- feature_list.json：feat-100.1 status → done；tracks.A-main.current → feat-100.2

**下一步（feat-100.2 Wave 2）**：抽 `packages/rag-core` 纯库。该 wave **开启冻结窗口**，需提前通知轨道 B 实验流仅调参不动算法核心代码。

**worktree**：`.claude/worktrees/refactor-monorepo/` on `claude/refactor-monorepo`，需手动 fast-forward 合到 main。

## 技术状态变更

- `pnpm dev` 取代 `cd app && npm run dev`
- `apps/web/data/documents.json` 取代 `app/data/documents.json`
- 路径：`apps/web/lib/providers.ts` 取代 `app/lib/providers.ts`（其他 imports 通过 git mv 自动跟随）

---

## 历史交接记录（会话 19 — Feature 编号约定调整：100+ = 架构）

## 本会话变更摘要

将原 feat-100~103（平铺 4 项）调整为 **feat-100 epic + feat-100.1~100.4** 模式，并引入新约定写入 AGENTS.md：

- **001~099 段位**：业务功能 feature
- **100+ 段位**：架构 / 基础设施 / 跨阶段重构类 feature

解决「编号顺序 vs 执行顺序反差」问题。后续大型架构调整继续用 feat-101 / 102 ...

feat-010 dependencies 同步从 `feat-103` 改为 `feat-100.4`。一致性检查通过（51 features，0 issues）。

## 当前执行模式：双轨并行

| 轨道 | 范围 | Session / Worktree | 状态 |
|------|------|-------|------|
| **A 主流程** | feat-100~103 架构重构 → feat-010~013 业务功能 | 待启动新 worktree（建议命名 `claude/refactor-monorepo`） | 未开始 |
| **B RAG 实验** | feat-006/008 收尾 + 持续算法实验 | 用户在另一个 session 自行开 | 未开始 |

**同步约定**：
- 实验流默认只产 `scripts/eval-matrix/results/run-XXX/` 报告；有效优化单独 PR 合入 main
- 主流程每个 Wave 开始前 rebase main
- Wave 2 期间实验流冻结算法改动（仅调参）

详见 `docs/ROADMAP_PHASE2_PLUS.md#双轨并行执行模型`。

---

## 历史交接记录（会话 17）

## 项目

Marketing RAG Playground：一个可调试的 RAG 驱动产品运营 idea 生成系统。

## 本会话变更摘要

仍在工作树 `claude/plan-agent-roadmap`（从 main HEAD `14c8778` 切出）。在会话 16 的路线图基础上**新增阶段 2.5：架构重构**：

- **`docs/PRODUCT.md`**：在阶段 2 和阶段 3 之间插入阶段 2.5 章节。
- **`feature_list.json`**：新增 feat-100~103（架构重构 4 个 Wave）；更新 feat-010~013 系列描述与文件路径以引用新架构。feat-010 dependencies 增加 feat-103。
- **`docs/ROADMAP_PHASE2_PLUS.md`**：新增阶段 2.5 完整章节；修订阶段 3-5 所有关键文件路径为新 monorepo 结构（apps/api/src/, apps/web/, packages/rag-core/）。
- **架构关键决策**：
  - pnpm monorepo（apps/web + apps/api + packages/rag-core + packages/shared-types）
  - 后端：NestJS（Module/Controller/Service + DI + Swagger）
  - Playground 降级为调试 UI（`apps/web/app/(playground)/`），与 Marketing Studio（`apps/web/app/(studio)/`）并列
  - 渐进迁移：4 个 Wave + 双跑期 + feature flag

**新阶段定位**：
1. 阶段 2 收尾（feat-006 + feat-008）
2. **阶段 2.5 架构重构（feat-100~103，~4-5 周）**
3. 阶段 3 Agent 自动化（feat-010 + feat-011，基于 NestJS + SSE）
4. 阶段 4 Marketing Studio（feat-012）
5. 阶段 5 工程化（feat-013，Lucia Auth + 多租户 + BYOK + Drizzle + Fly.io）

详见 `docs/ROADMAP_PHASE2_PLUS.md`。

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
| feat-008 | 自动化评估矩阵——12 test case × 3 query CLI 脚本，对比 Chunk/Retrieval/Transform/Filter/Query Rewrite 5 维配置，输出指标对比报告。设计文档：docs/EVAL_MATRIX.md | todo |

### 技术状态

- **主分支**：`main`，当前 HEAD：`53fa467`（chore(harness): 把 track / phase / 段位约定落到 feature_list 结构 + 加一致性校验脚本）。本会话提交将使其前进 1 步。
- **工作树**：干净，无进行中的 worktree
- **Dev server**：`cd app && npm run dev`（端口 3000；若被占用自动升至 3001）
- **文档存储**：`app/data/documents.json`（本地 JSON，dev 阶段）
- **向量存储**：PostgreSQL + pgvector（`docker compose up postgres` 启动；需 `DATABASE_URL` env）
- **Provider 抽象**：`app/lib/providers.ts`（`createLLMClient` / `createEmbeddingClient`，读 `LLM_*` / `EMBEDDING_*` env，兼容 Qwen/DashScope）
- **面试题**：`.interview/` 目录，已覆盖 feat-002.5、feat-003.1～003.6、feat-004.1～004.5、feat-006、feat-008（各独立文件）

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

- **feat-008（自动化评估矩阵）**：设计已完成（docs/EVAL_MATRIX.md），待实现脚本代码：
  - `scripts/eval-matrix/test-matrix.json`（12 个 test case 配置）
  - `scripts/eval-matrix/run-matrix.ts`（主执行脚本，串行调用 pipeline API）
  - `scripts/eval-matrix/collect-metrics.ts`（从 evaluation 输出提取指标）
  - `scripts/eval-matrix/report.ts`（终端对比表 + summary.json）
- **feat-006（RAG Quality Evaluation UI）**：仍为 todo，但 evaluation route 已在会话 13 实现。

潜在的后续方向：
- 多文档对比、pipeline 配置导出/导入、评估结果历史对比

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
