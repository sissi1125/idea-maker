# 阶段 2+ 详细路线图

> 本文档承接 `docs/PRODUCT.md` 的阶段规划，是 feat-200 / feat-010 / feat-011 / feat-012 / feat-013 系列的执行级实施计划。
> 每个 feature 段落含：**用户故事 / 关键文件 / API 设计 / 验收标准 / 简历亮点**。
>
> **2026-05-27 更新**：阶段 2.5 架构重构已完成（feat-100.1~100.4 全 done）；当前主流程进入**阶段 3 MVP（feat-200.1~8，8 周快速交付）**；原 feat-010/011 真 Agent 推迟到 **阶段 3.5**（MVP 完成后启动）。

## 总览

```
✅ 已完成
├─ 阶段 1：RAG Playground 闭环（feat-001~005）
├─ 阶段 2.5：架构重构（feat-100.1~100.4）pnpm monorepo + NestJS 前后端分离
└─ section-citation（main）

🟢 当前位置（双轨并行）
┌─ 轨道 A：主流程（claude/mvp-week-N）
│  └─ 阶段 3 MVP（8 周）
│     ├─ feat-200.1  Week 1: API 基础设施 + 项目 CRUD          ← 下一个
│     ├─ feat-200.2  Week 2: 文档 + Ingestion Job + SSE 进度
│     ├─ feat-200.3  Week 3: Pipeline Orchestrator + Generate
│     ├─ feat-200.4  Week 4: 自动生成 + 反馈 + 历史 API
│     ├─ feat-200.5  Week 5: 前端骨架 + 登录 + 项目管理
│     ├─ feat-200.6  Week 6: 文档上传 + 自动卡片 + Chat 主界面
│     ├─ feat-200.7  Week 7: 多维反馈 + 历史 + 笔记库 + Settings
│     └─ feat-200.8  Week 8: 平台规则 + 流式化 + 联调打磨 + 部署
│
└─ 轨道 B：RAG 实验流（claude/experiments/<topic>）
   ├─ feat-006  RAG Quality Evaluation        [收尾中]
   └─ feat-008  Eval Matrix CLI               [收尾中]
        ↓ 默认只产报告；指标提升的算法改动单独小 PR 合入 main

🔵 MVP 之后
├─ 阶段 3.5：真 Agent 自动化层（学习系统 + 智能迭代）
│  ├─ feat-010  Pipeline Orchestration Agent（ReAct + 决策循环）
│  └─ feat-011  Content Generation ReAct Agent（工具自主选择）
├─ 阶段 4：Marketing Studio UX
│  └─ feat-012  Studio 四列看板 + PostTemplate
└─ 阶段 5：工程化与生产部署
   └─ feat-013  Lucia Auth + 多租户 + BYOK + Drizzle + Fly.io
```

**优先级原则（2026-05-27 调整）**：
1. **阶段 2.5 已完成** —— 架构重构基础已就位（apps/web + apps/api + packages/rag-core + shared-types）。
2. **当前主线：阶段 3 MVP 8 周快速交付** —— feat-200.1~8 每周一个 milestone，每周末跑 `docs/VERIFICATION.md` 中的验收清单。
3. **MVP 内不引入真 Agent** —— Pipeline Orchestrator 是 YAML 固定编排，没有 LLM 决策；真 Agent 推迟到 Phase 3.5 配合反馈学习闭环。
4. **RAG 实验与 MVP 并行** —— 实验流默认只产报告 + 数据；指标提升的算法改动单独小 PR 合入 main。MVP Week 3（Pipeline Orchestrator 集成）期间冻结算法核心改动只调参。
5. **不要把阶段 5 的 Auth 全套提前** —— MVP 用最简 JWT（feat-200.1），Lucia v3 + 多租户 + Drizzle 留到 Phase 5。

---

## 阶段 2.5：架构重构（✅ 已完成 2026-05-26）

> **状态**：feat-100.1~100.4 全部 done。`apps/web` + `apps/api` + `packages/rag-core` + `packages/shared-types` 已就绪，18 个 stage 全部迁到 NestJS，Next.js API routes 已清理。详见 `feature_list.json` 中 feat-100.* 的 evidence。
>
> 以下保留原迁移方案以供回溯，不再是当前工作项。

<details>
<summary>展开查看原迁移方案（已完成）</summary>

### 用户故事（开发者视角）
> 作为长期维护这个项目的开发者，我希望 RAG 算法是独立纯库（可单测、可被 CLI/未来的 worker 复用），前后端有清晰分层（NestJS 后端 + Next.js 前端），Playground 降级为调试入口、Marketing Studio 成为主产品。这样后续 Agent / Studio / Auth 功能都能直接长在干净的架构上。

### 目标结构

```
marketing-rag/                          ← repo root
├── apps/
│   ├── web/                            ← Next.js 前端（仅 UI + RSC pages）
│   │   └── app/
│   │       ├── (playground)/           ← 调试 UI（原 Playground）
│   │       └── (studio)/               ← 主产品 UI（Marketing Studio，阶段 4 上线）
│   └── api/                            ← NestJS 后端服务（独立部署）
│       └── src/
│           ├── pipeline/               ← RAG stage controllers（薄）
│           ├── agent/                  ← Pipeline Agent / Content Agent（阶段 3）
│           ├── studio/                 ← Marketing Studio 相关 API（阶段 4）
│           └── auth/                   ← Lucia Auth（阶段 5）
├── packages/
│   ├── rag-core/                       ← 纯 TS RAG 库（无 HTTP/framework 依赖）
│   └── shared-types/                   ← API DTOs（zod schema + 推导 TS 类型）
├── services/
│   └── pymupdf/                        ← 现有 Python sidecar，不动
├── pnpm-workspace.yaml
└── package.json
```

### 关键技术选型

| 决策 | 选择 | 理由 |
|------|------|------|
| Monorepo 工具 | **pnpm workspaces** | 比 npm/yarn workspaces 更省盘 + 严格 hoisting |
| 后端框架 | **NestJS** | Module/Controller/Service 强结构化 + 内置 DI + Swagger 自动生成 + 企业级背书 |
| 前端 | **Next.js**（保留） | App Router + RSC，studio 页面适合 SSR |
| 共享类型 | **zod schema + 推导** | 一份 schema 同时做后端校验、前端表单、TS 类型 |
| API 协议 | **REST + zod 校验** | 与 NestJS 内置 ValidationPipe 配合好 |
| Pure RAG lib | **packages/rag-core** | 无 HTTP / 无 framework / 无 Next.js 依赖，可独立单测，可被 CLI / API / 未来 worker 复用 |

### 渐进迁移策略：4 个 Wave

**不要一次性重写**。每个 Wave 结束都保证现有 Playground 仍可用。

#### Wave 1 (feat-100.1, ~1 周)：建 monorepo 骨架
- 根目录加 `pnpm-workspace.yaml`，改造 `package.json`
- 把现有 `app/` 移动到 `apps/web/`，调整 imports
- 创建空 `apps/api/`（NestJS init）、`packages/rag-core/`、`packages/shared-types/`
- **验收**：`pnpm dev` 启动 web，pipeline 一切如旧

#### Wave 2 (feat-100.2, ~1-2 周)：抽 rag-core 纯库
- 把 ingestion / retrieval / generation 各 stage 的核心逻辑（**非 HTTP 部分**）抽到 `packages/rag-core/src/`
- 例如：`packages/rag-core/src/ingestion/chunk.ts` 导出 `chunkText(text, params): ChunkResult`
- Next.js routes 改为**薄路由**：仅参数解析 + 调 rag-core + 包装 trace
- `packages/shared-types` 同步定义所有 DTOs（zod schema）
- **验收**：rag-core 有独立 vitest 单测可跑，Playground 行为零回归

#### Wave 3 (feat-100.3, ~1-2 周)：搭 NestJS 后端 + 双跑
- `apps/api` 初始化 NestJS，按 Phase 划分 Modules（pipeline / agent / studio / auth）
- 先迁 **5 个最简单端点**（document upload / chunk / embed / retrieve / generate）到 NestJS
- web 通过 `NEXT_PUBLIC_API_URL` fetch 调用 NestJS
- **双跑期**：Next.js routes 暂留作 fallback，feature flag `USE_NEST_API` 切换
- **验收**：迁移端点可通过 NestJS + Swagger UI 调通

#### Wave 4 (feat-100.4, ~1 周)：迁完剩余 + 清理
- 剩余 ~15 个端点全部迁完
- **删除** `apps/web/app/api/*`（playground 完全通过 NestJS）
- 部署架构：`apps/web` + `apps/api` + `pymupdf` + Fly Postgres 多服务并存
- **验收**：完整 RAG 链路在分离架构下通过

### 总验收标准（整个阶段 2.5）

- [ ] `packages/rag-core` 有独立 vitest 单元测试可跑
- [ ] `apps/api` 启动后 `/api/swagger` 显示完整 OpenAPI 文档
- [ ] `apps/web` 完全不直接 import `apps/api` 的实现代码（只通过 fetch + shared-types）
- [ ] 跑通完整 RAG pipeline 效果与重构前一致
- [ ] 关闭 `apps/api` 时 web 显示明确 connection error（不静默 fallback）

### 简历亮点

- **"为什么 monorepo？"** — packages/rag-core 类型与 apps/api、apps/web 同 PR 内同步演进；workspace 协议避免发包
- **"为什么 NestJS 而不是 Express/Hono？"** — 需要 Module/Controller/Service/DI 强分层（面试好讲），DI 容器自带 + OpenAPI 自动生成，企业项目背书
- **"为什么把 RAG 抽成纯库？"** — 解耦 framework，便于独立测试、CLI 复用、未来 worker 进程；面试能讲清"业务库 vs 传输层"边界
- **"如何渐进迁移而不破坏现有功能？"** — Wave 1-4 分批 + 双跑期 + feature flag，每步验证再推进
- **共享 zod schema 的好处** — 同一 schema 同时做后端校验 + 前端表单 + TS 类型，杜绝前后端 schema drift

</details>

---

## 阶段 3 MVP：Idea-Maker 8 周快速交付（feat-200.1~8）

> 与原始 plan：`/Users/sissi/.claude/plans/users-sissi-claude-plans-coze-agent-war-peppy-peach.md` 同步。决策摘要：`.claude/memory/mvp-plan-2026-05-27.md`。

### 用户故事

> 作为独立开发者，我希望登录后能建项目、传文档、自动看到产品介绍和竞品分析卡片，然后向 AI 提问营销 idea。每个生成结果都能看到 11-stage RAG 执行过程、成本分解，并能给 4 维反馈、复用为笔记。

### 核心定位（与 Coze 的差异）

- **不是"快速搭建"，而是"深度学习和持续演进"**
- 价值主张：**透明可观测**（看到 RAG 全 11-stage 执行过程）+ **成本追踪**（每次调用 token/成本分解）+ **反馈采集**（为 Phase 3.5 学习系统准备数据）
- **不依赖 Agent 概念**：核心是 **Pipeline Orchestrator**（YAML 配置驱动的固定 11-stage 编排，无 LLM 决策、无循环、无工具选择）

### 4 个确认的核心决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **BYOK API Key 存储** | 服务端 AES-256 加密入库 | KMS/env 持有主密钥；Agent 编排时服务端解密调用 LLM；用户填的 key 在 `project_settings.encrypted_api_key` |
| **Ingestion 进度推送** | SSE（`GET /projects/:id/ingestion/:jobId/events`） | Week 2 多预留 1-2 天处理断线重连；备用轮询作 fallback |
| **Generate 流式** | 两阶段：Week 3-7 一次性完整返回 + 前端伪动画；Week 8 把 11-stage 关键节点映射成 4 个 SSE 事件 | 复用原型 `useStageProgress`；MVP 末尾切到真实事件驱动 |
| **Auth** | 最简 JWT（邮箱 + 密码） | 不做 OAuth / 找回密码；Phase 5 再换 Lucia |

### 周排期 + 验收（详见 `docs/VERIFICATION.md` 每周末验收清单）

| Week | feat-id | 聚焦 | 核心交付 |
|------|---------|------|---------|
| 1 | feat-200.1 | API 基础设施 + 项目 CRUD | `auth / projects / project_settings` 模块；`TracingInterceptor + TraceContext` 骨架 |
| 2 | feat-200.2 | 文档 + Ingestion Job + SSE 进度 | `documents.category` 字段；`ingestion_jobs` 表；SSE 端点 |
| 3 | feat-200.3 | Pipeline Orchestrator + Generate | `pipeline-orchestrator` 模块（YAML 驱动）；`generations` 表；`POST /projects/:id/generate` |
| 4 | feat-200.4 | 自动生成 + 反馈 + 历史 API | `auto_generations / feedbacks / cost_summary` 表；25+ 端点 e2e 通过 |
| 5 | feat-200.5 | 前端骨架 + 登录 + 项目管理 | `(auth)/login` + `(workspace)/layout` + Sidebar；zustand store |
| 6 | feat-200.6 | 文档上传 + 自动卡片 + Chat 主界面 | `ProjectInfoCards + PresetGrid + PipelineTrace`；端到端 demo |
| 7 | feat-200.7 | 多维反馈 + 历史 + 笔记库 + Settings | `MultiDimRating + GenerationEditor + 笔记库 + BYOK` |
| 8 | feat-200.8 | 平台规则 + 流式化 + 联调打磨 + 部署 | platform_rules validator；4 SSE 事件；Fly.io 测试环境 |

### 关键模块新增（apps/api/src/）

```
auth/                     # 最简 JWT（邮箱 + 密码）
projects/                 # projects CRUD + settings
pipeline-orchestrator/    # YAML 驱动的 stage 编排（不是 Agent）
  ├─ pipeline-orchestrator.service.ts
  └─ pipelines/default.yaml   # intent-recognition → query-rewrite → embedding → retrieval → rerank → multi-recall-merge → context-management → prompt-build → generation → citation → evaluation
generations/              # generations + feedbacks 查询
auto-generations/         # ingestion.completed 事件监听 → 串行触发 intro / compete
platform-rules/           # 规则 CRUD + validator
cost/                     # cost_summary 查询
common/
  ├─ tracing.interceptor.ts
  └─ trace-context.service.ts  # AsyncLocalStorage 累计 tokens / vector queries / rerank / cost_usd
```

### 关键模块新增（apps/web/）

```
app/
├─ (auth)/login/page.tsx
├─ (workspace)/layout.tsx          # 含 Sidebar
├─ projects/page.tsx
└─ projects/[id]/
   ├─ page.tsx                     # Chat 主界面（ProjectInfoCards + PresetGrid + 输入框 + PipelineTrace + 结果区）
   ├─ knowledge/page.tsx           # 三 Tab 上传（产品 / 竞品 / 历史物料）
   ├─ history/page.tsx             # 时间线 + 详情 + 过滤
   ├─ notes/page.tsx               # 笔记库（NOTE_LIBRARY）
   └─ settings/page.tsx            # BYOK + 模型参数 + 平台规则

components/
├─ pipeline/PipelineTrace.tsx      # 原型 AgentThinking.jsx 迁过来；接 generate 返回的 pipeline_trace
├─ pipeline/StageDetail.tsx
├─ feedback/MultiDimRating.tsx     # 4 维评分（relevance / style / reliability / representativeness）
├─ feedback/GenerationEditor.tsx   # textarea + 保存 diff（diff-match-patch）
├─ feedback/CostBreakdown.tsx
├─ chat/PresetGrid.tsx
├─ chat/ProjectInfoCards.tsx
├─ chat/GeneratedNote.tsx
└─ shared/{Sidebar,ProjectCard,UploadDropzone}.tsx
```

### 字段命名映射（原型 → MVP）

| 原型（idea_maker） | MVP 落地 | 说明 |
|---|---|---|
| `THINKING_TRACE.think[]` | `pipeline_trace.intent` | 来自 intent-recognition + query-rewrite stage |
| `THINKING_TRACE.search` | `pipeline_trace.retrieval` | 来自 retrieval + rerank + multi-recall-merge stage |
| `THINKING_TRACE.tools[]` | `pipeline_trace.stages[]` | 实际是 stage 执行日志，**非 LLM 工具调用**（UI 文案可保留"tools"，内部数据结构叫 stages） |
| `THINKING_TRACE.selfEval[]` | `pipeline_trace.evaluation` | 来自 evaluation stage，规则式打分，**非 LLM 自评** |

> **诚实标注**：MVP 不是 LLM 决定调什么工具，而是 YAML 配置固定执行的 stage。UI 文案可保留用户友好措辞，但代码层面统一用 `Pipeline / Stage / Trace`。

### 数据库新增表（汇总）

```sql
-- Week 1
users(id, email, password_hash, created_at)
projects(id, name, emoji, description, owner_id, docs_count, total_cost_usd, created_at, updated_at)
project_settings(project_id, provider, encrypted_api_key, model, temperature, max_tokens, thinking_depth, retrieval_mode)

-- Week 2
ingestion_jobs(id, project_id, document_id, status, progress, current_stage, chunks_done, chunks_total, cost_usd, error)
-- documents 加 category 字段（product | compete | history）

-- Week 3
generations(id, project_id, query, pipeline_trace JSONB, retrieved_chunks JSONB, result_notes JSONB, evaluation JSONB, cost_breakdown JSONB, trace_id, created_at)

-- Week 4
auto_generations(id, project_id, type, title, body, chips[], source_document_ids[], created_at)  -- type: intro | compete
feedbacks(id, generation_id, ratings JSONB, edit_diff JSONB, comment, created_at)  -- ratings: {relevance, style, reliability, representativeness}
cost_summary(project_id, date, embedding_cost, llm_cost, total_cost, request_count)

-- Week 7
notes(id, project_id, generation_id, source_note_index, channel, style, tag, angle, body, hashtags[], uses_count, rating, created_at)

-- Week 8
platform_rules(id, project_id, name, platform, banned_words[], required_elements[], min_words, max_words, forced_format, is_active)
```

### MVP 重点说明（避免误解）

- ✅ 透明的 11-stage pipeline 执行过程可视化
- ✅ 完整的成本追踪（embedding + LLM + 总计）
- ✅ 多维反馈采集（4 维评分 + 编辑 diff）
- ✅ BYOK + 平台规则验证
- ❌ **不做真 Agent**（LLM 自主决策、工具选择、自评估迭代循环）— 这些留到 Phase 3.5
- ❌ **不做 EditPattern 学习** — MVP 只采集数据攒 `feedbacks.edit_diff`，Phase 3.5 再批量分析
- ❌ **不做多人共享 / RLS** — 先单租户；多租户留到 Phase 5

### 总验收标准（MVP 7 个成功指标）

- [ ] 用户完整走通：**登录 → 建项目 → 传文档 → 自动生成卡片 → 提问 → 看 Pipeline Trace → 给反馈 → 查历史 → 复用笔记库**
- [ ] 每个生成结果都能追溯到源文档和 LLM 调用过程（可观测性）
- [ ] 生成结果旁显示成本分解（`embedding $0.02 | LLM $0.15 | 总计 $0.17`）
- [ ] 用户的每个反馈（评分 + 编辑）都被记录用于 Phase 3.5
- [ ] 支持 BYOK（用户自带 API Key，AES-256 加密存储）
- [ ] 支持平台规则验证（违禁词 / 必含元素 / 字数限制）
- [ ] 部署到 Fly.io 测试环境可公网访问

### 简历亮点

- **Pipeline Orchestrator vs 真 Agent 的诚实区分**：MVP 不假装做 ReAct，先把可观测性和反馈采集做扎实，再演进到真 Agent
- **AsyncLocalStorage 链路追踪**：`TracingInterceptor + TraceContext` 跨 stage 累计成本，每个外层请求一个 traceId
- **YAML 驱动的 stage 编排**：`pipelines/default.yaml` 配置 11-stage 顺序，无 LLM 决策保证可调试可回滚
- **8 周冲刺 + 每周可独立验收**：每周末跑 `docs/VERIFICATION.md` 检查清单，scope 边界清晰

---

## 阶段 3.5：真 Agent 自动化层（MVP 之后）

> ⚠️ **架构基础**：以下所有文件路径均基于阶段 2.5 完成后的 monorepo + NestJS 结构 + 阶段 3 MVP 完成后的 feat-200.* 数据基础（反馈数据 + 编辑 diff 已积累）。
>
> 与 MVP 的关键区别：**MVP 是 Pipeline Orchestrator**（YAML 固定编排、无 LLM 决策、无工具选择）；**Phase 3.5 是真 Agent**（LLM 决策循环、工具自主选择、基于历史反馈调整策略）。

### feat-010 Pipeline Orchestration Agent

#### 用户故事
> 作为独立开发者，我已经选好了文档，希望点一个按钮就能从 ingestion 一直跑到生成营销 idea，途中能看到每一步在做什么，失败了能从断点继续。

#### 设计核心：Plan-and-Execute

**为什么不用 ReAct**：pipeline 顺序已由 rag-core 中的 `STAGE_DEPS` 图静态确定，无需 LLM 动态推理「下一步做什么」。用 ReAct 只会增加 token 消耗和不可预测性，违背可调试原则。

**为什么服务端 + SSE 而非客户端循环**：阶段 2.5 重构后已有独立 NestJS 后端，agent 改为服务端 NestJS Service 运行 + SSE 推送进度，不再受 serverless 超时限制，且更利于日志、追踪、复用。

#### 关键文件（阶段 2.5 后的新路径）
| 文件 | 改动 |
|------|------|
| `apps/api/src/agent/pipeline-agent.service.ts` | **新增**：runPipeline async iterable，注入 RagCoreService |
| `apps/api/src/agent/pipeline-agent.controller.ts` | **新增**：POST /start + GET /:runId/events（@Sse） |
| `packages/shared-types/src/agent.ts` | **新增**：AgentRunConfig + AgentProgressEvent zod schema |
| `apps/web/components/agent/AutoRunModal.tsx` | **新增**：预运行配置 Modal |
| `apps/web/components/agent/AgentProgressPanel.tsx` | **新增**：通过 EventSource 订阅 SSE 流的进度时间线 |
| `apps/web/components/playground/PlaygroundShell.tsx` | 修改：Header 加按钮 + 切换 panel |
| `packages/rag-core/src/pipeline/deps.ts` | 复用：`resolveEffectiveUpstream` / `isStageActive` |
| `packages/rag-core/src/pipeline/stages.ts` | 复用：`PIPELINE_STAGES` 顺序列表 |

#### 核心类型
```typescript
// apps/api/src/agent/pipeline-agent.service.ts

export interface AgentRunConfig {
  documentId: string;
  enabledSteps: Set<string>;
  stageParamsMap: Record<string, Record<string, unknown>>;
  defaultQueries: string[];        // 预设 3 个营销向 query
  pauseAfterIngestion: boolean;
}

export type AgentProgressEvent =
  | { type: "stage_started"; stageId: string }
  | { type: "stage_completed"; stageId: string; output: unknown; durationMs: number }
  | { type: "stage_failed"; stageId: string; error: { code: string; message: string } }
  | { type: "paused"; reason: "user_request" | "ingestion_checkpoint" | "stage_failure" }
  | { type: "done"; totalDurationMs: number; runId: string };

export async function* runPipeline(
  config: AgentRunConfig,
  results: Map<string, unknown>
): AsyncGenerator<AgentProgressEvent> { /* 顺序循环调 handleRun */ }
```

#### 验收标准
- [ ] 选定文档 → 点「一键生成」→ 弹出 Modal → 确认 → 时间线展开
- [ ] 每个 stage 完成时 progress 实时刷新
- [ ] 任意 stage 失败 → agent 暂停 + 错误高亮 + 可重试
- [ ] 全部完成 → 跳转 Marketing Studio（feat-012 上线后）
- [ ] Pipeline trace drawer 中能看到完整 run 历史

#### 简历亮点
- **Plan-and-Execute vs ReAct 取舍**："我们的领域是确定性的，用 ReAct 只增加复杂度"
- **客户端循环规避 serverless 超时**：架构权衡的实例
- **断点续跑**：复用已有 stage_snapshots 表，故障恢复 0 额外存储

---

### feat-011 Content Generation ReAct Agent

#### 用户故事
> 作为独立开发者，我希望 AI 不要只生成一个平庸的 idea 就交差。它应该自己评估生成质量，发现 hook 太弱时主动换角度重试，最多 3 次。我可以随时打断或指定方向。

#### 设计核心：ReAct with Tools

**为什么这里用 ReAct**：内容质量迭代次数不确定，agent 需要「观察评分 → 推理下一步动作」，是真正的动态决策循环。**与 feat-010 形成对比**：两种 agent 模式各司其职，是项目最大的简历亮点之一。

#### 工具集（4 个）

```typescript
// packages/rag-core/src/agent/content-tools/*.ts

// Tool 1: 生成 ideas
async function generate_ideas(
  angle: string,
  evidence: EvidenceItem[],
  platform: Platform,
  format: ContentFormat
): Promise<ContentIdea[]>

// Tool 2: 评估 hook（双层评估）
async function evaluate_hook(idea: ContentIdea): Promise<{
  score: number;                 // 0-10
  dimensions: {
    emotional_impact: number;
    curiosity: number;
    platform_fit: number;
  };
  feedback: string;              // "hook 平铺直叙，缺乏悬念感"
}>
// 实现：先规则预检（0 token），通过的候选项再 LLM 精评

// Tool 3: 验证证据覆盖
async function evaluate_evidence(
  idea: ContentIdea,
  evidence: EvidenceItem[]
): Promise<{ coverage: number; uncited_claims: string[] }>

// Tool 4: 推荐下一个角度
async function suggest_angle(
  feedback: string,
  tried_angles: string[]
): Promise<{ new_angle: string; rationale: string }>
// 角度库：痛点故事型 / 教程型 / 对比型 / 悬念开头型 / 数据佐证型 / 场景代入型
```

#### evaluate_hook 双层评估实现要点

**规则预检（同步、0 token）**：
- hook 长度 < 10 字 → score 上限 4
- 不含动词或感叹/疑问标点 → score 上限 5
- 完全是产品名 + 功能描述句式 → score 上限 5

**LLM 精评（异步、消耗 token）**：
- 仅对规则预检 ≥ 5 的候选项调用
- System prompt：「你是一个挑剔的小红书重度用户，每天刷 200 条笔记，对营销味重的内容会立刻划走」
- 输出 JSON：3 个维度评分 + 综合分 + 一句话反馈

#### ReAct 循环逻辑

```typescript
// apps/api/src/agent/content-agent.service.ts

export async function* runContentAgent(config: ContentAgentConfig) {
  let angle = config.initialAngle;
  const triedAngles: string[] = [];
  const iterations: IterationResult[] = [];

  for (let i = 0; i < config.maxIterations; i++) {
    yield { type: "iteration_started", iteration: i, angle };

    // ACT 1: generate
    const ideas = await generate_ideas(angle, config.evidence, config.platform, config.format);
    yield { type: "ideas_generated", ideas };

    // ACT 2: evaluate hook
    const hookEval = await evaluate_hook(ideas[0]);
    yield { type: "hook_evaluated", evaluation: hookEval };

    iterations.push({ angle, ideas, hookScore: hookEval.score });
    triedAngles.push(angle);

    // 终止条件 1: 通过质量门槛
    if (hookEval.score >= config.threshold) {
      yield { type: "passed", finalIteration: iterations.at(-1) };
      return;
    }

    // 终止条件 2: 达到最大迭代
    if (i === config.maxIterations - 1) {
      const best = iterations.reduce((a, b) => b.hookScore > a.hookScore ? b : a);
      yield { type: "max_reached", bestIteration: best };
      return;
    }

    // ACT 3: 决策换角度
    const suggestion = await suggest_angle(hookEval.feedback, triedAngles);
    yield { type: "angle_switching", new_angle: suggestion.new_angle, rationale: suggestion.rationale };

    angle = suggestion.new_angle;
  }
}
// 终止条件 3（用户接管）由 UI 层 abort signal 实现
```

#### 关键文件
| 文件 | 改动 |
|------|------|
| `packages/rag-core/src/agent/content-tools/{generate-ideas,evaluate-hook,evaluate-evidence,suggest-angle}.ts` | **新增**：4 个纯函数工具（可独立单测）|
| `apps/api/src/agent/content-agent.service.ts` | **新增**：ReAct 循环引擎（NestJS Service）|
| `apps/api/src/agent/content-agent.controller.ts` | **新增**：start + SSE events + accept 端点 |
| `apps/web/components/agent/ContentAgentPanel.tsx` | **新增**：迭代卡片 + 接管按钮（订阅 SSE）|
| `apps/api/src/providers/` | 复用：LLM client（依赖注入）|
| `apps/api/src/pipeline/generation/` | 复用：作为 generate_ideas 的底层实现 |

#### 验收标准
- [ ] 给定一个有水分的产品文档，agent 至少能跑出 2 次迭代且评分递增
- [ ] hook 评分 ≥ 7 时自动停止
- [ ] 用户点「接受当前版本」可立即停止
- [ ] 「手动指定角度」可注入并触发一次新迭代
- [ ] 完整迭代历史持久化到 pipeline_run_history（便于 Studio 复用）

#### 简历亮点
- **两种 Agent 模式都实现**：Pipeline (Plan-and-Execute) + Content (ReAct)，对比适用场景
- **evaluate_hook 双层评估**：规则预检 + LLM 精评，成本与质量的工程权衡
- **三重终止机制**：质量门槛 + 最大迭代 + 用户接管，防止无限循环

---

## 阶段 4：Marketing Studio UX

### feat-012 Studio 工作流

#### 用户故事
> 作为独立开发者，我希望生成结果不要是 JSON 列表，而是一个像 Trello 看板的页面：选卖点 → 看营销方向 → 挑 idea → 一键展开成完整帖子，过程中能踩赞反馈让 AI 重新生成而不用从头跑 pipeline。

#### Studio 路由布局

```
/studio/[runId]
┌────────────┬────────────┬────────────┬────────────┐
│   卖点      │  营销方向   │  Content   │  扩展为     │
│  (Selling   │  (Content  │  Ideas     │  完整帖      │
│  Points)    │  Direct.)  │            │  (PostExp.) │
│            │            │  (踩 / 赞) │  (Drawer)   │
└────────────┴────────────┴────────────┴────────────┘
   选中 → 过滤    选中 → 过滤   选中 → 展开
```

#### 关键 API

**POST /api/marketing/regenerate-idea**
```typescript
// 不重跑整条 pipeline 的关键设计
{
  runId: string;
  ideaIndex: number;
  reason: "down_vote" | "manual_request";
  angleHint?: string;
  excludeAngles: string[];
}
→ ContentIdea  // 单个替换 idea
// 内部：读 stage_snapshots 拿 evidence pack，仅调 /api/pipeline/generation
```

**POST /api/marketing/expand-idea**
```typescript
{
  runId: string;
  idea: ContentIdea;
  platform: "xiaohongshu" | "twitter" | "linkedin" | "wechat";
  targetAudience: string;
  tone: "story" | "tutorial" | "comparison" | "list" | "question";
}
→ PostTemplate {
  hook: string;
  body: string[];      // 3-5 段
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  evidenceIds: string[];
  characterCount: number;
}
```

#### 数据库新增表

```sql
CREATE TABLE idea_feedback (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  idea_index INTEGER NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('up', 'down')),
  angle_override TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_idea_feedback_run ON idea_feedback(run_id);
```

#### 关键文件（阶段 2.5 后的新路径）
| 文件 | 改动 |
|------|------|
| `apps/web/app/(studio)/studio/[runId]/page.tsx` | **新增**：路由入口（RSC 拉取 run 数据）|
| `apps/web/components/studio/IdeaBoardColumn.tsx` | **新增**：通用看板列 |
| `apps/web/components/studio/IdeaCard.tsx` | **新增**：含踩赞 |
| `apps/web/components/studio/PostExpansionDrawer.tsx` | **新增**：抽屉 |
| `apps/web/components/studio/PlatformMockup.tsx` | **新增**：纯 Tailwind 手机框 |
| `apps/api/src/studio/regenerate-idea.controller.ts` | **新增**：POST /api/studio/regenerate-idea |
| `apps/api/src/studio/expand-idea.controller.ts` | **新增**：POST /api/studio/expand-idea |
| `apps/api/src/pipeline/generation/` | 修改：新增 `content-directions` method |
| `apps/api/src/snapshot/` + `apps/api/src/db/schema.ts` | 修改：加 `idea_feedback` 表 |
| `packages/shared-types/src/studio.ts` | **新增**：PostTemplate / ContentDirection / FeedbackSignal zod schema |

#### 验收标准
- [ ] Pipeline Agent 完成后能跳转到 `/studio/[runId]` 看到看板
- [ ] 踩某个 idea + 填角度 → 5 秒内得到替换 idea（不重跑 pipeline）
- [ ] 点 idea 的「扩展为帖」→ Drawer 中展示手机框预览 + 复制按钮
- [ ] 四个平台模板各有差异（字数限制 / hashtag 风格）
- [ ] 所有 PostTemplate 仍保留 evidenceIds，可点回查证据

#### 简历亮点
- **反馈迭代不重跑 pipeline**："evidence pack 缓存在 snapshot，只换 generation prompt"
- **平台感知的内容生成**：不同平台 prompt 不同，hashtag 策略不同
- **看板式 UX**：从开发者工具升级为面向终端用户的工作流

---

## 阶段 5：工程化与生产部署

### feat-013 系列

#### 用户故事
> 作为求职者，我希望这个项目能上线、能演示给雇主、能让面试官真的注册账号试用。同时项目用户填的 API Key 不能泄露，多个用户的数据不能串扰。

#### feat-013.1 Lucia Auth

**为什么 Lucia 不用 NextAuth**：
- NextAuth (Auth.js v5) 在 App Router 下配置复杂、文档碎片化
- Lucia v3 更透明、TypeScript 友好、好在面试中解释
- 自带 PostgreSQL adapter，与现有 pg 栈无缝

**Token 策略**：
- Access token：15min，存 httpOnly cookie
- Refresh token：7 天，存 `user_sessions` 表
- 防 XSS：禁用 localStorage 存 token

**关键文件（阶段 2.5 后的新路径）**：
```
apps/api/src/auth/auth.module.ts                # NestJS Auth Module
apps/api/src/auth/auth.service.ts               # Lucia 实例 + session 管理
apps/api/src/auth/auth.guard.ts                 # NestJS Guard
apps/api/src/auth/auth.controller.ts            # login/logout/signup/refresh
apps/web/middleware.ts                          # 仅做跳转保护（实际鉴权在 NestJS Guard）
apps/web/app/(auth)/(login|signup)/page.tsx     # 前端表单
```

#### feat-013.2 Workspace 多租户

**应用层 isolation（不用 PostgreSQL RLS）**：
- RLS 配置复杂、调试困难，对一人项目过重
- 应用层在每个 API route 注入 `workspace_id` 过滤，足够安全

**Schema 改动**：在以下表加 `workspace_id TEXT NOT NULL`：
- `rag_documents` / `rag_chunks` / `stage_snapshots` / `pipeline_run_history` / `idea_feedback`

**Migration 策略**：先加列允许 NULL → 回填默认 workspace → 加 NOT NULL 约束。

#### feat-013.3 BYOK API Key 管理

**为什么 BYOK（Bring Your Own Key）**：
- 目标用户是独立开发者，他们都有自己的 API Key
- 项目不做按量计费 → 不用接 Stripe → 项目复杂度大降
- 用户的 token 消费走自己账户 → 项目无成本风险

**加密存储**：
```typescript
// apps/api/src/crypto/vault.service.ts
import crypto from "crypto";

const VAULT_KEY = process.env.VAULT_KEY!;  // 32 字节 base64

export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(VAULT_KEY, "base64"), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}
```

**Provider 读取顺序**（修改 `apps/api/src/providers/`）：
1. 用户在 form 里临时填入 → 优先（不持久化）
2. 用户在 Settings 里保存的 DB key → 次之
3. 系统 env var → fallback

#### feat-013.4 Drizzle ORM 迁移

**渐进迁移策略**（不要一次性重写）：
1. 加入 Drizzle 依赖 + schema 文件
2. 第一波：迁 `snapshotDb.ts`（surface 最小，4 个函数）
3. 第二波：迁 `docStore.ts`（dev JSON + PG 双实现）
4. 第三波：迁所有 API route 的查询
5. 清理 raw pg 代码

**功能开关**：`USE_DRIZZLE=true` env var 控制实现切换，保证可回滚。

#### feat-013.5 Fly.io 部署

**为什么不用 Vercel**：
- pymupdf Python sidecar 必须 Docker 部署
- Vercel 的 managed Postgres 不保证 pgvector 版本

**Fly.io 配置**：
```toml
# fly.toml
app = "marketing-rag-playground"

[[services]]
  internal_port = 3000
  protocol = "tcp"
  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

[[services]]
  internal_port = 8001
  name = "pymupdf"
```

**CI**：GitHub Actions 在 PR 时跑 `typecheck + lint + build`，合并到 main 后 `fly deploy`。

#### 验收标准（整个 feat-013 系列）
- [ ] 多个用户注册 → 各自数据完全隔离（互相看不到）
- [ ] 用户填的 API Key 在数据库里是密文，日志中不出现
- [ ] 公网 URL 可访问，能从头跑完一整条 pipeline + Content Agent
- [ ] CI 在 PR 时阻塞不合规代码

#### 简历亮点
- **JWT vs session cookies**：httpOnly cookie + 双 token 模式，防 XSS
- **应用层 vs DB 层多租户**：架构取舍的实例
- **BYOK 模式**：避开计费系统的工程取舍
- **渐进式 ORM 迁移**：双实现共存 + feature flag，零风险切换

---

## 总验证清单

每个 feature 完成后，必须确认：

- [ ] `feature_list.json` 状态从 `todo` 改为 `done`，填写 evidence
- [ ] `.interview/<feat-id>_<topic>.md` 写好面试题（AGENTS.md 规定）
- [ ] `docs/API_CONTRACTS.md` 同步新端点契约
- [ ] `progress.md` 记录改动 + 验证结果
- [ ] `session-handoff.md` 更新当前状态 + 下一步
- [ ] Playground 仍可用，已有 stage 无回归
- [ ] `npm run typecheck && npm run lint` 通过

## 排期估算（2026-05-27 更新）

| 阶段 | feature | 周数（一人 part-time） | 状态 |
|------|---------|----------------------|------|
| 阶段 1 | feat-001~005 RAG Playground 闭环 | - | ✅ done |
| 阶段 2.5 | feat-100.1~100.4 架构重构 | 4-5 周 | ✅ done |
| 收尾（轨道 B） | feat-006 + feat-008 RAG 质量评估 | 1-2 周 | 🟡 进行中（并行） |
| **阶段 3 MVP**（轨道 A） | **feat-200.1~8 Idea-Maker 8 周交付** | **8 周** | 🟢 **当前主线** |
| 阶段 3.5 | feat-010 + feat-011 真 Agent | 5-7 周 | 🔵 MVP 后 |
| 阶段 4 | feat-012 Marketing Studio | 4-5 周 | 🔵 待启动 |
| 阶段 5 | feat-013 工程化与部署 | 5-7 周 | 🔵 待启动 |
| **合计**（MVP 起算） | | **~6 个月** | |

按这个节奏推，**MVP 8 周后即可有完整可演示产品**；继续推进 5-6 个月后能拿到一个完整、可上线、可演示的简历项目（含真 Agent + Studio + 工程化）。

---

## 双轨并行执行模型（2026-05-27 更新）

### 背景

阶段 2.5 架构重构已完成，主流程进入阶段 3 MVP 8 周冲刺。RAG 实验调优是**长期、不确定**的工作（query 跑一轮要几小时、参数组合多），与 MVP 产品功能开发并不冲突 —— 继续保持双轨并行。

### 双轨模型（当前）

```
┌─────────────────────────────────────────────────────────────────┐
│  轨道 A：主流程（claude/mvp-week-N worktree）                   │
│                                                                  │
│  阶段 3 MVP：feat-200.1~8（8 周）                               │
│      Week 1: API 基础设施 + 项目 CRUD                           │
│      Week 2: 文档 + Ingestion Job + SSE                         │
│      Week 3: Pipeline Orchestrator + Generate ← 冲突高风险窗口  │
│      Week 4: 自动生成 + 反馈 + 历史 API                         │
│      Week 5-8: 前端 + 反馈 + 历史 + 笔记库 + 平台规则 + 部署    │
│      ↓                                                           │
│  阶段 3.5 真 Agent (feat-010 + feat-011)                        │
│      ↓                                                           │
│  阶段 4 Studio (feat-012) → 阶段 5 工程化 (feat-013)            │
└─────────────────────────────────────────────────────────────────┘
                            ↑
                            │ 选择性 PR 合入（指标提升的小 PR）
                            │
┌─────────────────────────────────────────────────────────────────┐
│  轨道 B：RAG 实验调优（claude/experiments/<topic>）             │
│                                                                  │
│  feat-006 / feat-008 收尾 + 持续算法实验                        │
│      （新方法 / 调参 / prompt 优化）                            │
│      默认产出：scripts/eval-matrix/results/run-XXX/             │
│              + .interview/ 面试题                                │
└─────────────────────────────────────────────────────────────────┘
```

### 同步规则

| 决策 | 规则 |
|------|------|
| **实验代码合入策略** | **选择性合入**：实验默认只产报告 + 数据；确认指标提升的算法/参数改动单独提小 PR 合入 main |
| **Week 3 冻结窗口** | 主流程做 Week 3（feat-200.3，集成 Pipeline Orchestrator + YAML 编排，~1 周）期间，**实验流只调参不动算法核心代码**。可以做：跑新 query 组合 / 调 chunk size / threshold / topK / 生成报告。不可以做：改 packages/rag-core/src/ 下的算法实现 |
| **主流程 rebase 节奏** | 每个 Week 开始前 rebase main，把实验流合入的最新算法拉进来 |
| **实验流 base** | 实验流持续在 **main 顶端**跑，保证实验环境稳定 |
| **实验入口** | 实验流直接在 `packages/rag-core/` 上跑（阶段 2.5 已完成迁移）；调用入口走 `apps/api` 端点 |

### 分支约定

| 分支 | 用途 | 基于 |
|------|------|------|
| `main` | 唯一合并入口（实验 PR + 主流程 PR 都合入这里） | - |
| `claude/mvp-week-N`（N=1..8） | 主流程：feat-200.N 当周 milestone | main 顶端，每 Week 开始 rebase |
| `claude/experiments/<topic>` | 实验流（每个实验主题一个短命分支） | main 顶端 |

### Feature 编号约定（避免冲突）

| 编号段 | 归属 | 示例 |
|--------|------|------|
| `feat-006.x` / `feat-008.x` / `feat-009.x` | 轨道 B 实验流 | feat-006.1 评估指标补充、feat-008.1 新增 query 维度 |
| `feat-200.x` | 轨道 A 主流程（MVP，当前主线） | feat-200.1 Week 1 API 基础设施 |
| `feat-010 ~ feat-013`（业务段位）与 `feat-100.x`（已完成的架构段位） | 轨道 A 主流程（MVP 之后） | feat-010 Phase 3.5 真 Agent |

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 实验改了算法导致 MVP evidence drift | 实验流 PR 必须附带 eval 指标对比（hitRate / citationCoverage / confidenceScore 不退化）|
| 主流程 Week 3 期间冲突 | Week 3（~1 周）内实验冻结算法改动，只调参；冻结开始/结束在 session-handoff.md 明确写明 |
| 实验流 PR 与主流程 rebase 时序混乱 | 主流程在每个 Week 开始前 rebase main，避免实验 PR 堆积 |
| MVP 周末验收时被实验改动干扰 | 周末验收（Week N Friday）前 24 小时不接受实验 PR；validator 失败时优先回退实验 PR |

### 同步触发点（关键节点通知）

| 时机 | 实验流应感知（写入 session-handoff.md） |
|------|------------|
| Week 3 开始（feat-200.3 启动） | **冻结算法改动**通知；实验流仅调参 |
| Week 3 完成 | Pipeline Orchestrator 已就位；实验流恢复算法改动；后续每周末验收前 24h 冻结 |
| Week 8 完成 | MVP 上线到测试环境；实验流可以基于真实用户反馈数据做新一轮调优 |
| Phase 3.5 启动 | 真 Agent 介入后，实验流的"调参"工作可能被 Agent 自动决策替代；实验流转向"prompt 模板优化"和"few-shot example 库构建" |

### 实验流默认工作流

1. 用户在另一个 session 启动 worktree：`git worktree add .claude/worktrees/exp-<topic> -b claude/experiments/<topic> main`
2. 修改 `packages/rag-core/` 算法 / 调参 / 跑实验
3. 输出 `scripts/eval-matrix/results/run-XXX/` 报告 + `.interview/` 面试题（如适用）
4. 评估指标对比基线：通过则提小 PR 合入 main；不通过则归档报告，分支可删
5. 主流程下次 Week 开始时 rebase main 拉取已合入的优化

> **重要原则**：RAG 算法的进化（实验流）独立于产品形态演进（主流程 MVP），二者通过 main 分支异步同步。Week 3 是唯一的高冲突窗口，需要明确的冻结约定。
