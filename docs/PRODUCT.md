# 产品说明

## 名称

暂定名：Marketing RAG Playground

备选名：IdeaGraph AI

## 产品定位

一个面向产品运营、独立开发者、一人公司和小团队的可视化 RAG Pipeline Playground。它把产品资料处理成可复用、可检索、可追踪的知识库，再基于可信 evidence 生成产品画像、卖点地图和运营内容 idea。

更简洁地说：一个可调试的 RAG 驱动运营选题生成系统。

## 目标用户

- 准备做产品发布或增长内容的独立开发者。
- 有产品资料但没有完整市场团队的一人公司。
- 需要验证内容方向的小团队产品运营。
- 希望围绕自己产品构建营销工作流的开发者。

## 核心用户流程

1. 上传产品资料，或从已上传文档库中选择历史 document version。
2. 配置 RAG ingestion pipeline。
3. 执行 ingestion 并查看每一步产物。
4. 配置 retrieval。
5. 检索相关 evidence chunks。
6. 生成产品画像。
7. 生成结构化卖点地图。
8. 基于卖点和 evidence 生成内容 idea。
9. 查看引用和 confidence。
10. 调整 pipeline 参数并重新运行。

## 项目阶段规划

项目整体按“先闭环、再增强、再产品化”的方式推进。每个阶段都应保持可验证、可回退、可追踪，不把后续复杂能力提前塞进当前阶段。

### 阶段 0：Harness 与工程基座

目标：让后续 agent 或开发者进入项目后，能快速理解产品边界、当前状态、验证方式和交接规则。

范围：

- 建立 `AGENTS.md`、`feature_list.json`、`progress.md`、`session-handoff.md` 和 `init.sh`。
- 记录产品说明、架构说明、API 契约和验证清单。
- 明确“文档默认中文、工程标识保留英文”的协作规则。
- 定义 feature 状态、完成标准和会话交接机制。

交付标准：

- `./init.sh` 可以完成 harness 文件检查。
- 后续开发者可以基于文档直接启动下一个 feature。

### 阶段 1：可调试 RAG Playground 闭环

目标：先跑通从产品文档到 evidence-backed marketing ideas 的最小闭环。

范围：

- Playground Web UI：左侧 pipeline steps，中间配置，右侧 output/trace。
- Document Upload & Library：上传 MD/TXT/PDF 或粘贴文本，保存原始内容、metadata、hash 和 version；页面进入时自动加载已上传文档并可选择历史版本。
- Ingestion steps：document idempotency、preprocess、chunk、transform、embedding、storage。
- Retrieval steps：query rewrite、retrieval、filter、rerank、citation。
- Marketing generation：product profile、selling point map、content ideas。
- 每个卖点和 idea 都带 evidence references。
- 存储主线采用 PostgreSQL + pgvector，保留 provider 抽象和可调试 trace。
- Embedding 支持 OpenAI、Hugging Face TEI、Hugging Face Transformers.js 和 debug deterministic provider。
- REST endpoints 具备 request、response、mock 和 error schema。

交付标准：

- 用户可以导入一份产品资料，并在界面上看到每一步输入、参数、输出、耗时和 trace。
- 系统能基于 retrieval evidence 生成产品画像、卖点地图和内容 idea。
- 无远程 API key 时，非 LLM 阶段和 debug embedding 仍可运行；用户选择需要真实 provider 的方法时，系统必须返回明确 provider 错误。

### 阶段 2：RAG 质量评估与调参能力（收尾）

目标：让用户能判断生成效果不好时，到底是文档处理、chunk、embedding、retrieval、rerank 还是 prompt 出了问题。

### 阶段 2.5：架构重构（基座升级，先于阶段 3）

目标：把当前 Next.js 单体重构为「pnpm monorepo + 独立 NestJS 后端 + Next.js 前端 + 纯 RAG 库」清晰分层架构。**所有阶段 3-5 的开发都直接长在新架构上**，避免"在旧结构上写完再迁"的二次重写浪费。

范围：

- **RAG 作为独立模块**：抽到 `packages/rag-core` 纯 TS 库，无 HTTP/framework 依赖，可独立单元测试。
- **Playground 降级为调试 UI**：从主入口降为 `/playground` 路由（仅作 RAG 阶段调试用途），与即将上线的 Marketing Studio（`/studio`）并列。
- **前后端分离**：`apps/api`（NestJS）独立运行，`apps/web`（Next.js）只做 UI，二者通过 REST + zod 共享 schema 通信。
- **pnpm monorepo**：`packages/rag-core` + `packages/shared-types` + `apps/web` + `apps/api`。
- **渐进迁移策略**（4 个 Wave，每个 Wave 结束都保证现有 Playground 可用）：
  - Wave 1: monorepo 骨架 + apps/web 迁移
  - Wave 2: 抽 packages/rag-core 纯库 + shared-types
  - Wave 3: 搭 NestJS 后端 + 5 端点迁移 + 双跑期（feature flag）
  - Wave 4: 剩余端点迁完 + 清理 Next.js API 路由 + 部署调整

交付标准：

- `packages/rag-core` 有独立 vitest 单元测试可跑。
- `apps/api` 启动后 `/api/swagger` 显示完整 OpenAPI 文档。
- `apps/web` 完全不直接 import `apps/api` 的实现代码（只通过 fetch + shared-types）。
- 完整 RAG pipeline 在分离架构下与重构前一致。
- 关闭 `apps/api` 时，web 显示明确的 connection error（不静默 fallback）。



范围：

- 展示 chunk count、token estimate、chunk coverage 和 source coverage。
- 增加 retrieval hit rate、score distribution、evidence coverage、citation correctness 等指标（feat-006）。
- 自动化评估矩阵 CLI：12 个配置组合 × 3 个 query 的离线对比报告（feat-008）。
- 支持 curated test queries，用固定问题回归 retrieval 表现。

交付标准：

- 用户能对同一文档运行多组 retrieval 配置并比较结果。
- 每次生成结果都能看到 evidence 覆盖率和低置信 warning。
- 质量问题能被定位到具体 pipeline 阶段。

### 阶段 3：Agent 自动化层（核心升级）

目标：把"用户手动点 12 次 stage"变成"选文档 → 点一下 → 看进度 → 拿结果"。两种 Agent 模式共存，各司其职。

#### 3A：Pipeline Orchestration Agent（Plan-and-Execute）

- 自动顺序执行 ingestion + retrieval + generation 全链路。
- 复用 `STAGE_DEPS` 依赖图作为静态执行计划，无需 LLM 动态推理。
- 客户端循环调用现有 `handleRun`，实时推送进度时间线到 UI。
- 失败可暂停，用户修复参数后从断点继续。

#### 3B：Content Generation ReAct Agent（with Tools）

- 工具集（4 个）：`generate_ideas` / `evaluate_hook` / `evaluate_evidence` / `suggest_angle`。
- 角度库：痛点故事型 / 教程型 / 对比型 / 悬念开头型 / 数据佐证型 / 场景代入型。
- 循环：生成 → 评估 → 不达标则换角度 → 重新生成，最多 3 次迭代。
- `evaluate_hook` 双层评估：规则预检（0 token 快速过滤）+ LLM 精评（扮演挑剔用户）。
- 三重终止：质量门槛（≥7 分）+ 最大迭代数 + 用户随时可接管。

交付标准：

- 用户从选文档到拿到 evidence-backed idea，全程 ≤ 3 次主动操作。
- 两种 Agent 的迭代过程对用户可见、可中止、可干预。
- 内容质量稳定通过质量门槛（hook ≥ 7 分）或明确告知用户为何未达标。

### 阶段 4：Marketing Studio UX（营销工作流）

目标：从"展示 JSON 列表"升级为"符合营销师使用习惯的内容创作工作流"。

范围：

- 独立 `/studio/[runId]` 路由，四列看板布局：卖点 → 营销方向 → Content Ideas → 扩展为完整帖。
- Content Directions 中间层：在卖点和具体 idea 之间增加战略角度层。
- 踩赞反馈机制：用户对 idea 踩 / 赞，触发"换角度重生"而非重跑整条 pipeline（复用 snapshot 的 evidence pack）。
- 帖子扩展：把单个 idea 扩展为完整 PostTemplate（hook / body / CTA / hashtags / imagePrompt），含手机框 mockup 预览。
- 多平台适配：小红书 / Twitter / LinkedIn / 微信公众号。

交付标准：

- 用户能在 Studio 内完成"从 idea 选择到帖子草稿"的完整工作流。
- 反馈迭代不重跑 pipeline，只重调 generation 端点（耗时 < 5s）。
- 所有 PostTemplate 仍保留 evidence chunk IDs 溯源。

### 阶段 5：工程化与生产部署

目标：把 Playground 推进到可上线、可多用户使用、可演示给雇主的产品形态。

范围：

- **认证**：Lucia Auth v3 + PostgreSQL adapter（httpOnly cookie + access/refresh token 双 token 模式）。
- **多租户**：应用层 `workspace_id` Row-level isolation（所有相关表加 workspace_id 字段，所有查询带 workspace 过滤）。
- **BYOK API Key 管理**：用户自带 LLM/Embedding key，AES-256 服务端加密存储，不做按量计费。
- **数据库迁移**：Drizzle ORM 替换 raw `pg` 查询，渐进迁移（先 snapshotDb.ts）。
- **部署**：Fly.io 或 Railway（含 PostgreSQL + pgvector + pymupdf sidecar），CI/CD via GitHub Actions。

交付标准：

- 多用户可独立使用，数据不互相串扰。
- 用户的 API Key 加密存储，日志和错误信息不泄露。
- 可通过公网 URL 演示给雇主或潜在用户。

## 产品原则

- Evidence first：生成声明必须能指向 chunk IDs。
- Debuggable by default：每一步都应该展示 input、params、output、status、timing 和 trace。
- Provider explicit：用户选择哪个 provider 就执行哪个 provider，不静默 fallback。
- Small surface, complete loop：先交付能证明 RAG 质量影响营销输出的最小闭环。

## 主要输出

产品画像：

```json
{
  "productName": "",
  "targetUsers": [],
  "coreProblems": [],
  "coreFeatures": [],
  "positioning": "",
  "evidenceChunkIds": []
}
```

卖点地图：

```json
{
  "sellingPointMap": {
    "functional": [],
    "emotional": [],
    "scenario": [],
    "differentiation": []
  },
  "evidence": []
}
```

内容 idea：

```json
{
  "ideas": [
    {
      "title": "",
      "angle": "",
      "sellingPointId": "",
      "targetUser": "",
      "platform": "",
      "hook": "",
      "outline": [],
      "evidenceChunkIds": []
    }
  ]
}
```
