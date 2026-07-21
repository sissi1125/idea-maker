# Idea-Maker

面向独立开发者和小团队的营销内容生成系统：把产品文档与官方网站整理成可确认、可追溯的产品事实，再基于已批准主张生成并评测营销内容。

> 这个项目关注的不只是“生成一段文案”，而是如何让 RAG 与 Agent 的事实依据、执行步骤、成本、评测和用户反馈都可观察、可解释、可迭代。

## 在线体验

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| Web 应用 | [https://idea-maker-web.vercel.app](https://idea-maker-web.vercel.app) | 请自行注册账号体验完整流程 |
| API | [https://api.retreevo.online](https://api.retreevo.online) | NestJS 后端；健康检查见 [`/health`](https://api.retreevo.online/health) |

生产环境采用 **Vercel 前端 + 阿里云 ECS 后端 + Cloudflare Named Tunnel**。部署架构和踩坑复盘见[部署文档](docs/DEPLOY.md)与[部署复盘](docs/DEPLOYMENT_RETROSPECTIVE.md)。

## 面试官快速体验

建议预留 3-5 分钟，按下面的路径查看核心闭环：

1. 注册并创建一个项目。
2. 在「资料库」上传中文产品资料，或提交产品官方网站。
3. 在「产品档案」查看模型提取的候选字段、来源和 evidence，确认产品事实。
4. 在「产品卖点」审核 Claim，区分可用表达与未经确认的事实。
5. 在「内容创作」创建任务，比较不同传播角度及其评测结果。
6. 在「AI 对话」观察 Agent 自主选择工具，并查看实时 Trace、引用证据和成本。
7. 在「内容资产」查看已采纳内容、海报、生成历史和评估报告。

没有配置可用模型凭据时，涉及 LLM 与 Embedding 的步骤可能无法完成；产品界面、数据结构和已有记录仍可查看。

## 当前产品闭环

```text
产品文档 / 官方网站
        ↓
候选 Product Brief（字段级来源、证据、置信度）
        ↓ 用户确认
Confirmed Product Brief（产品事实裁决层）
        ↓
Approved Claims（允许使用的传播表达）
        ↓
Campaign Brief → 多角度内容候选
        ↓
确定性规则检查 + 评测 Agent
        ↓
人工确认 / 编辑 / 拒绝
        ↓
反馈记录与更新建议
```

Product Brief 的事实字段必须来自 evidence chunk 或用户确认。模型推断、历史内容和反馈只能形成候选或表达建议，不能自动升级为产品事实。

## 核心能力

### 可追溯的 Product Brief

- 从产品文档和用户主动提交的官方网站提取结构化候选字段。
- 字段记录来源、evidence chunk IDs、置信度、状态和版本。
- 支持逐字段确认、编辑、拒绝和过期标记，不让同步结果覆盖已确认事实。
- 官网导入遵守 robots、同域白名单、页数、深度、限速和 SSRF 防护。

### Claim 与内容评测闭环

- 事实型 Claim 必须有证据，只有已批准 Claim 才能进入内容生成。
- Campaign 一次生成多个可比较角度，并保留 Claim 与 Brief 版本引用。
- 确定性规则先检查引用、价格、规格、禁词和平台约束，失败不能被模型高分绕过。
- 评测结果进入人工筛选，用户可以采纳、编辑或拒绝候选内容。

### 真 ReAct Agent

- LLM 自主决定是否检索、调用哪个工具、是否批判或修改草稿，以及何时停止。
- `search_kb`、`generate_draft`、`critic_review`、`refine_draft` 等能力以 tools 提供，不在代码中写死调用顺序。
- 每个 reasoning、tool call、tool result 和 finish step 都持久化并通过 SSE 实时展示。
- `max_steps` 与 `budget_usd` 提供安全阀，超限时进入可观察的 fallback。

### Agent Grounding

- Confirmed Product Brief 是 Agent 的唯一事实裁决层。
- Approved Claims 定义允许表达的传播主张。
- raw RAG chunk 不直接注入生成模型，仅保留 field/claim evidence IDs 用于 provenance 与审计。
- outer Agent、生成、修订和评测共享同一份服务端 Grounding Context。
- 只有通过代码门禁且被 critic 审核的精确 draft 才能交付，避免转述时丢失引用或改变事实。

### 反馈、成本与 Eval

- 从用户评分和编辑中蒸馏风格、偏好、禁忌与受众 Memory，并保留反馈来源。
- 记录 token、成本、步骤数、耗时和终止原因。
- 使用 LLM-as-judge、trajectory match、运行元数据和人工反馈评估 Agent。
- Golden cases 用于 prompt、tool description 或模型变更后的离线回归。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | Next.js、React、TypeScript、Tailwind CSS |
| 后端 | NestJS、TypeScript |
| Agent | Vercel AI SDK、自建 ReAct loop、tool calling、SSE |
| RAG | PostgreSQL、pgvector、中文分词、Embedding、Reranker |
| 评测 | Golden cases、LLM-as-judge、trajectory match、确定性规则 |
| 工程 | pnpm monorepo、Docker Compose、Vercel、Cloudflare Tunnel |

## 仓库结构

```text
apps/web                 Web 产品界面与 Agent Trace
apps/api                 API、Agent、Product Brief、Campaign、Eval
packages/rag-core        文档处理、检索、Embedding 与存储基础能力
docs/agent               真 Agent 架构与实现说明
docs                     产品、API、评测和部署文档
```

旧的 11-stage Pipeline Playground 仍作为 RAG 学习与调试工具保留；当前面向用户的生成链路以 Product Brief 闭环和 ReAct Agent 为主。

## 本地运行

### 环境要求

- Node.js 20+
- pnpm 9.6+
- Docker 与 Docker Compose

### 启动步骤

```bash
pnpm install
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env

pnpm --filter @harness/api dev
pnpm --filter @harness/web dev
```

打开：

- Web：<http://localhost:3000>
- API：<http://localhost:3001>
- Health：<http://localhost:3001/health>

### 模型配置

在 `apps/api/.env` 中配置 OpenAI-compatible 服务。项目默认中文优先，推荐使用 Qwen `text-embedding-v4` 或 `BAAI/bge-m3`，Reranker 推荐 `BAAI/bge-reranker-v2-m3`。

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag
JWT_SECRET=replace-with-a-random-secret-at-least-16-characters
CORS_ORIGIN=http://localhost:3000

LLM_API_KEY=your-api-key
LLM_BASE_URL=https://your-openai-compatible-endpoint/v1
LLM_MODEL=your-chat-model

EMBEDDING_API_KEY=your-api-key
EMBEDDING_BASE_URL=https://your-embedding-endpoint/v1
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSION=1024
```

完整变量及默认值以 [`apps/api/.env.example`](apps/api/.env.example) 为准。没有 LLM key 时不能运行真实生成和评测；没有 Embedding key 时，部分知识库场景会降级使用 BM25 检索。

## 常用命令

```bash
pnpm dev          # 启动 Web
pnpm build        # 构建整个 monorepo
pnpm typecheck    # 全仓类型检查
pnpm lint         # 全仓 lint
pnpm test         # 全仓测试
pnpm smoke        # 端到端 smoke
pnpm --filter @harness/api eval  # Agent 离线评测
```

## 设计文档

- [产品定位与阶段规划](docs/PRODUCT.md)
- [Product Brief 产品闭环与迭代顺序](docs/PRODUCT_BRIEF_ITERATION_PLAN.md)
- [真 Agent 架构](docs/agent/ARCHITECTURE.md)
- [系统架构](docs/ARCHITECTURE.md)
- [API 契约](docs/API_CONTRACTS.md)
- [Eval Matrix](docs/EVAL_MATRIX.md)
- [生产部署](docs/DEPLOY.md)
- [部署复盘](docs/DEPLOYMENT_RETROSPECTIVE.md)

## 当前状态

Phase 4 Product Brief 闭环已经完成，Agent Grounding 已落地。当前系统已经覆盖“资料导入 → 事实确认 → Claim 审核 → 内容生成 → 自动评测 → 人工筛选 → 反馈记录”的完整路径，并已部署到生产环境。

后续重点是用更多真实产品数据扩充 Grounding 与 Campaign eval、持续校准评测阈值，以及完善凭据加密和更严格的多租户授权。
