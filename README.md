# Idea-Maker

一个透明可观测的营销 Agent，用产品知识生成有证据支撑的内容创意。

Idea-Maker 是一个围绕 RAG、ReAct Agent、Memory 蒸馏和 Eval 构建的全栈 AI 产品实验。它的目标不是只做一个“能生成内容”的 Demo，而是把 Agent 的每一步决策、检索证据、用户反馈和评估结果都变得可追踪、可解释、可迭代。

## 项目要点

- ReAct Agent 主循环：模型可以自主决定下一步调用哪个 tool
- RAG 工作流：基于产品知识库生成更可靠的营销内容
- Memory 蒸馏：从用户反馈中提炼偏好，并注入后续生成
- 实时 Trace：通过 SSE 展示 Agent 每一步执行过程
- 成本与状态追踪：记录 token、成本、步骤、终止原因等元信息
- 三层 Eval：LLM-as-judge、trajectory match、agent_runs 元数据
- BYOK 配置：支持 OpenAI-compatible 模型服务

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | Next.js, TypeScript, Tailwind CSS |
| 后端 | NestJS, TypeScript |
| Agent | AI SDK, ReAct loop, tool calling |
| RAG | PostgreSQL, pgvector, embeddings |
| 评估 | Golden cases, LLM judge, trajectory match |
| 工程 | pnpm monorepo, Docker Compose |

## 架构概览

```text
apps/web
  对话界面、设置页、Memory 面板、Eval 报告、实时 Trace

apps/api
  Agent Runner、Tools、Memory Distiller、Eval Runner、数据库访问

packages/rag-core
  Retrieval、chunking、embedding、pipeline 基础能力

PostgreSQL + pgvector
  文档、切片、向量、Agent 运行记录、步骤、Memory、Eval 记录
```

## 核心流程

1. 上传或选择产品知识。
2. 针对知识库进行检索。
3. Agent 规划、搜索、起草、批判和改写。
4. 在时间线中查看每一步 Trace。
5. 用户给出反馈。
6. 系统将重复反馈蒸馏成 Memory。
7. 下一次生成时自动复用 Memory。
8. 通过 Eval 检查输出质量和决策路径是否退化。

## 为什么做这个项目

很多 LLM Demo 停在“看起来能用”。Idea-Maker 更关注工程化问题：

- Agent 为什么做了这个决策？
- 输出依据了哪些证据？
- 用户反馈到底教会了系统什么？
- 一次改动有没有让效果变差？
- Eval 能不能发现普通测试发现不了的问题？

## 快速开始

```bash
pnpm install

docker compose up -d postgres

pnpm --filter @harness/api dev
pnpm --filter @harness/web dev
```

然后打开：

- Web app: `http://localhost:3000`
- API: `http://localhost:3001`

## 环境变量

在 `apps/api/.env` 中配置数据库和模型服务：

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag
JWT_SECRET=your-secret-min-16-chars

LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini

EMBEDDING_API_KEY=your-api-key
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536
```

## 常用命令

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke
pnpm eval
```

## 文档

- [产品说明](docs/PRODUCT.md)
- [架构说明](docs/ARCHITECTURE.md)
- [编排说明](docs/ORCHESTRATION.md)
- [API 契约](docs/API_CONTRACTS.md)
- [Eval Matrix](docs/EVAL_MATRIX.md)
- [部署说明](docs/DEPLOY.md)

## 项目状态

这是一个持续迭代中的 AI 工程项目。最有价值的部分是可观测 Agent 运行时、反馈到 Memory 的闭环，以及用于发现行为退化的 Eval 系统。
