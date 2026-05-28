# 会话交接

## 最后更新

2026-05-28（feat-200.8.2 + 200.8.3 ✅ 全局 toast + 三态 review + 部署联调资产）

## 本次变更摘要

【200.8.2 toast + 三态】
- ToastProvider 自写（4 variant + auto-dismiss + reducer）
- Chat/Settings/Notes/Knowledge/Feedback/AddToLibrary 全部接入 toast
- 项目列表加 Empty state + Loading skeleton
- 顺手修了 knowledge 页 set-state-in-effect lint

【200.8.3 部署联调】
- DbService.initSchema 加 `CREATE EXTENSION IF NOT EXISTS vector`
- apiFetch BASE_URL 三级回退：env > window.origin > localhost
- .github/workflows/ci.yml：PR 跑 typecheck/lint/unit；smoke 走 workflow_dispatch
- DEPLOY.md 补充 NEXT_PUBLIC_API_URL + CI 章节

【验证】
- pnpm -r typecheck + lint 全过
- pnpm smoke 10 步 18s 全过

**进度**：MVP 完整收官；推迟到 200.8.1 的只剩 SSE 流式化（Token 级）。
next：Phase 3.5 真 Agent（feat-010.x）或 200.8.1 SSE。

---

## 上一次更新（feat-200.8 Week 8 收官）

2026-05-28（feat-200.8 ✅ 平台规则验证 + e2e smoke + Fly.io 部署资产 — **MVP 8 周收官**）

## 本次变更摘要（feat-200.8 Week 8）

【新增后端】
- DDL_PLATFORM_RULES 表 + PlatformRulesModule（CRUD + listEnabledByIds 内部接口）
- rule-validator.ts：maxLength / bannedKeywords / mandatoryTagPattern 三检查 + buildRuleSystemPrompt

【后端修改】
- GenerateRequest 加 platformRuleIds；GenerateResponse 加 violations
- orchestrator.run 接受 ruleSystemPrompt 注入到 contextText 之前
- GenerationsService 接 PlatformRulesService：pre-prompt 注入 + post-generation 校验

【新增前端】
- lib/api/platform-rules.ts + 4 平台预设（小红书 / 微博 / 抖音 / 公众号）
- components/platform-rules/{PlatformRulesManager, RuleSelector, ViolationsBanner}.tsx
- Settings 平台规则 Section 替换占位为完整管理面板
- Chat 输入上方 RuleSelector 多选 chip
- GeneratedResult 顶部橙黄 ViolationsBanner

【发布资产】
- scripts/smoke.mjs：10 步端到端，21s 全过
- Dockerfile（multi-stage + Next standalone + dumb-init）
- fly.toml（双端口 / Postgres / Volume / healthcheck）
- docs/DEPLOY.md（一键部署清单 + secrets 列表）

【验证】
- pnpm -r typecheck / pnpm smoke 全过
- fly deploy 实际部署留给用户：所有资产就绪

**进度**：MVP 8 周交付完成（feat-200.1~8）。next：Phase 3.5（feat-010 真 Agent）或 200.8.x 子 feature 收尾（SSE 流式化 / 全局 toast / 三态 review / 实际部署联调）。

---

## 上一次更新（feat-200.7）

2026-05-28（feat-200.7 ✅ 反馈 + 历史 + 笔记库 + Settings 完善）

## 本次变更摘要（feat-200.7 Week 7）

【新增】
- 后端：`notes` 表 + NotesModule（CRUD 5 端点）
- 前端 API：`feedbacks.ts` + `notes.ts`
- 前端组件：`feedback/{MultiDimRating,GenerationEditor,FeedbackPanel}.tsx`、`notes/AddToLibraryButton.tsx`
- 前端页面：`history/page.tsx`（cursor 分页 + source filter + 行内 trace + 评分）、`notes/page.tsx`（编辑/删除 + tags）

【修改】
- Chat 页 GeneratedResult 加成本分解 chip 行 + FeedbackPanel + AddToLibraryButton
- Sidebar 加"笔记库"入口；"内容资产"重命名为"生成历史"
- Settings 页修上 session 遗留的 set-state-in-effect lint；加"平台规则（Week 8）"占位 Section

【验证】
- pnpm -r typecheck / -F @harness/web lint --max-warnings 0 全过

**进度**：feat-200.7 status=done；feat-200.8（Week 8 平台规则验证 + 流式化 + 联调打磨 + 部署）待启动。

---

## 上一次更新（feat-200.6 补丁）

2026-05-28（feat-200.6 补丁 ✅ Ingestion 阶段输出可视化 + 项目级摘要接入 Chat 页）

## 本次变更摘要（feat-200.6 补丁，非新 feature）

【核心】
- 后端 ingestion runner 在 5 个 stage 各写一份"输出摘要"进 `ingestion_jobs.stage_outputs`（JSONB）；
- 前端知识库文件行加折叠面板展示 5 个 stage 的 method / 耗时 / metrics；
- 后端新增 `GET /projects/:pid/auto-generations/latest`（DISTINCT ON 取每种 card_type 最新成功）；
- 前端 Chat 页 `ProjectInfoCards` 不再显示写死的占位文案，而是真实读 auto_generations 的 resultNotes 渲染产品介绍 / 竞品分析。

【已知前提】
- 自动摘要依赖 LLM：`apps/api/.env` 需配 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`；
- 不配也不阻塞——ingestion 5 stage 全程跑通（embedding 走 mock，UI 显示 ⚠ 提示），auto-gen 触发后 generate 失败，latest 端点返回空，UI 自然降级到引导文案。

【验证】
- pnpm -r typecheck ✅
- pnpm -F @harness/web lint：本次改动 0 报错（settings/page.tsx 那条 lint 错是 untracked 文件预存问题）
- 面试题：`.interview/feat-200.6_patch_stage-outputs-and-summaries.md`（5 题）

---

## 上一次更新（Session 44）

2026-05-27（会话 44 — feat-200.6 Week 6 完成 ✅ Chat 主界面 + 知识库 + PipelineTrace）

## 本会话变更摘要（Session 44 — Week 6 部分）

🎉 Week 6 完整闭环：6 新文件 + 3 修改 + Chat + Knowledge + PipelineTrace

【交付】
- `lib/api/documents.ts` — 文档 CRUD + ingestion 轮询 + SSE 连接函数
- `lib/api/generations.ts` — generate / list / get + 完整类型镜像
- `components/pipeline/PipelineTrace.tsx` — 4 阶段进度动画 + trace 详情 + chunk 展示
- `app/(workspace)/projects/[id]/page.tsx` — Chat 主界面（InfoCards + PresetGrid + ChatInput + Generate）
- `app/(workspace)/projects/[id]/knowledge/page.tsx` — 知识库（三分类 Tab + Dropzone + 文件列表）
- `app/globals.css` — shimmer / spin / dot / fade-up 动画 + kbd + no-scroll

【设计决策】
- PipelineTrace: rAF 伪动画 + finished 后真实 trace 数据
- Chat 状态机: idle → running → done，generate 同步等后端完整结果
- Knowledge 上传: FormData multipart 直传（不经 apiFetch JSON 封装）
- useStageProgress: useState + rAF callback 避免 set-state-in-effect lint 错误
- 修复: tokenGetter 同步注入（解决 React effect bottom-up 导致的 401）

【验证】
- typecheck + lint 全过
- 页面渲染：/login 200 / /projects 200 ✅

**进度**：feat-200.6 status="done" ✅；feat-200.7（Week 7 反馈 + 历史 + 笔记库）待启动。

---

## Week 7 启动清单（feat-200.7，Session 44 → Session 45）

**下一 Session 开工前必读**：
1. `progress.md` Session 44 — feat-200.6 条目
2. `feature_list.json` feat-200.7 条目

**Week 7 边界**：
- `app/projects/[id]/history/page.tsx`：Generation 历史列表 + cursor 分页
- `app/projects/[id]/feedback/page.tsx`：反馈表单（4 维度评分 + editDiff + comment）
- `components/chat/NoteCard.tsx`：可折叠笔记卡 + 评分 + 保存到内容资产
- 笔记库页面（Week 7 增强）

**Scope 红线**：
- 不改后端 API（Week 1-4 端点已足够）
- 不做平台规则验证（Week 8）

**前端已就绪资产（Week 5-6）**：
- API client：auth / projects / documents / generations
- Stores：auth-store / projects-store
- 组件：Sidebar + PipelineTrace + Chat + Knowledge
- CSS：完整品牌色 + stage 色 + 动画

---

## 历史交接记录（会话 43 — feat-200.5 Week 5 完成 ✅）

🎉 Week 5 完整闭环：15 新文件 + 3 修改 + zustand + lucide-react + 路由三分区

【交付】
- `apps/web/lib/api/` — 4 文件：client(fetch+tokenGetter) + auth + projects + index
- `apps/web/lib/stores/` — 2 文件：auth-store(persist JWT) + projects-store(persist currentId)
- `apps/web/app/providers.tsx` — tokenGetter 注入 + refreshUser hydrate
- `apps/web/app/(auth)/login/page.tsx` — 登录/注册双模式表单，lucide 图标，ApiError 展示
- `apps/web/app/(workspace)/layout.tsx` — AuthGuard + Sidebar 全屏布局
- `apps/web/app/(workspace)/projects/page.tsx` — 项目卡片网格 + 内联新建 + 删除
- `apps/web/app/(workspace)/projects/[id]/page.tsx` — Week 6 占位
- `apps/web/components/layout/Sidebar.tsx` — 品牌+项目切换器+导航+成本+用户区
- `apps/web/app/playground/page.tsx` — 旧 Playground 路由保留

【设计决策】
- API client 用原生 fetch（不引 axios）；tokenGetter 回调避免 store 循环依赖
- zustand persist: auth 只存 token，projects 只存 currentProjectId；其余每次拉 API
- route groups: (auth) 无 Sidebar / (workspace) 有 Sidebar / /playground 独立
- globals.css 迁入原型全部 30+ CSS 变量 + card/btn/chip/fade-in 原子类
- btn-primary:hover 改为 brand-2（原型误用了深蓝色 #16307a）

【验证】
- typecheck + lint 全过
- curl：register + login + create project + list ✅
- 页面渲染：/login 200（"欢迎回来"）/ /projects 200（"加载中"）/ /playground 200 ✅

**进度**：feat-200.5 status="done" ✅；feat-200.6（Week 6 上传+卡片+对话）待启动。

---

## Week 6 启动清单（feat-200.6，Session 43 → Session 44）

**下一 Session 开工前必读**：
1. 上一周成果：`progress.md` Session 43 — feat-200.5 条目
2. 本周任务：plan § "Week 6"
3. `feature_list.json` feat-200.6 条目

**Week 6 边界**：
- `app/projects/[id]/knowledge/page.tsx`：Upload 组件 + 进度轮询
- `app/projects/[id]/page.tsx`：ProjectInfoCards + PresetGrid + 输入框 + generate 调用
- `components/pipeline/PipelineTrace.tsx`：Week 6 先用伪动画
- 4 阶段可视化 + 结果展示
- 验收：端到端跑一次"传文档 → 自动卡片 → 提问 → 看 Agent 思考 → 看结果"

**Scope 红线**：
- 不改后端 API（Week 1-4 端点已足够）
- 不做反馈 / 历史 / 笔记库（Week 7）
- 不做平台规则验证（Week 8）

**前端已就绪资产（Week 5）**：
- API client：`lib/api/` (auth / projects)
- Stores：`lib/stores/` (auth-store / projects-store)
- 路由骨架：(auth)/login + (workspace)/layout+Sidebar + projects/[id]
- CSS 变量：globals.css 完整品牌色 + stage 色

**Week 6 需新增 API client**：
- `lib/api/documents.ts`（upload + list + delete + ingestion SSE）
- `lib/api/generations.ts`（generate + list + get）

---

## 历史交接记录（会话 43 — feat-200.4 Week 4 完成 ✅）

🎉 Week 4 完整闭环：3 张新表 + 3 个新 module + 5 个新端点 + e2e curl 验证通过

【交付】
- `apps/api/src/db/schema.ts` — DDL_FEEDBACKS / DDL_AUTO_GENERATIONS / DDL_COST_SUMMARY；generations 加 `source` 列（ALTER ADD COLUMN IF NOT EXISTS 幂等）
- `apps/api/src/feedbacks/` — 4 文件（types / service / controller / module）
- `apps/api/src/cost/` — 4 文件
- `apps/api/src/auto-generations/` — 4 文件
- `apps/api/src/generations/generations.service.ts` — cursor 分页 + source/status 过滤 + cost_summary upsert + `assertOwnedByUser` + `generate(opts)`
- `apps/api/src/generations/generations.controller.ts` — 接 cursor/limit/status/source query
- `.interview/feat-200.4_feedback-autogen-cost.md`（7 题）

【5 新端点】
- `POST /generations/:id/feedback`（upsert，UNIQUE(generation_id)）
- `GET  /generations/:id/feedback`
- `GET  /projects/:id/cost/summary?from&to`（默认最近 30 天）
- `GET  /projects/:id/documents/:docId/auto-generations`
- `GET  /projects/:id/generations` 改造为 cursor + 过滤（含 limit）

【AutoGenerations 设计】
- `@OnEvent('ingestion.completed', { async: true })`
- 用 `setImmediate` 每张卡独立调度，不阻塞 emit 路径
- `tracer.run('auto-gen:<autoGenId>', ...)` 起独立 ALS context（不继承上游 HTTP trace）
- `generate({ source: 'auto', skipOwnerCheck: true })`（事件源可信，无 userId）
- product → intro 卡 / compete → compete 卡；history 不触发
- 失败不抛：落 `auto_generations.error`，不影响 ingestion 主路径

【cost_summary 写入】
- generate succeeded 分支末尾，按 UTC day 做 ON CONFLICT upsert
- 即便 costUsd=0 也 +1 generations_count（活跃度指标）

【cursor 设计】
- `(created_at DESC, id DESC)` keyset
- cursor = base64url(JSON({createdAt, id}))；解析失败抛 400
- `LIMIT N+1` 多取一条决定 hasMore，省 COUNT 查询

【验证】
- pnpm -r typecheck / lint 全过
- curl 12 项端到端：register/project/generate×2/list 默认/limit+cursor 翻页/source 过滤/feedback POST+upsert+GET/bad rating 400/cost summary/bad date 400/invalid cursor 400/跨用户 404
- 上传 product PDF → ingestion succeeded → auto-gen intro succeeded（含 generationId 反写）

**进度**：feat-200.4 status="done" ✅；feat-200.5（Week 5 前端骨架）待启动。

---

## 历史交接记录（会话 42 — feat-200.3 Week 3 完成 ✅ Pipeline Orchestrator + Generations + Generate 端点）

## 本会话变更摘要（Session 42）

🎉 Week 3 完整闭环：8 个新文件 + 3 个新端点 + YAML 11-stage 编排 + curl 验证通过

【交付】
- `apps/api/src/pipeline-orchestrator/` — 4 文件：types / service / module / pipelines/default.yaml
- `apps/api/src/generations/` — 3 文件：service / controller / module
- `apps/api/src/db/schema.ts` 加 `DDL_GENERATIONS`（pipeline_trace / retrieved_chunks / cost_breakdown JSONB）
- `.interview/feat-200.3_pipeline-orchestrator-generate.md`（6 题）

【3 新端点】
- `POST /projects/:projectId/generate` — 执行完整 11-stage RAG pipeline
- `GET /projects/:projectId/generations` — 历史列表
- `GET /projects/:projectId/generations/:id` — 详情

【Pipeline Orchestrator 设计】
- YAML 配置驱动 11 stage：context-management → query-rewrite → intent-recognition → retrieval → filter → rerank → citation → prompt-build → generation → evaluation + 条件 fallback
- 错误容忍：runStage catch 不抛，downstream 可继续或走 fallback
- Fallback：retrieval 返回 0 结果 → 跳过 filter~evaluation → reject-answer
- TraceContextService.addCost() 在 retrieval/rerank/generation 后累计

【bug 修】
1. GenerationsModule 缺 AuthModule → DI 失败
2. FallbackOutput.fallbackAnswer → fallbackResponse
3. RerankOutput fallback upstream 缺必填字段
4. EvaluationUpstream.evidencePack 需要 EvidenceItem[]

【验证】
- pnpm -r typecheck / lint 全过
- curl：5 stage trace（3 success + 1 error(mock key) + 1 fallback）+ generations 列表正确

**进度**：feat-200.3 status="done" ✅；feat-200.4（Week 4）待启动。

---

## Week 5 启动清单（feat-200.5，2026-05-27 Session 43 → Session 44）

**下一 Session 开工前必读**：
1. 上一周成果：`progress.md` 2026-05-27 Session 43 条目 + `.interview/feat-200.4_feedback-autogen-cost.md`
2. 本周任务：`/Users/sissi/.claude/plans/users-sissi-claude-plans-coze-agent-war-peppy-peach.md` § "Week 5"
3. `feature_list.json` feat-200.5 条目

**Week 5 边界（前端骨架）**：
- `apps/web/app/(auth)/login` + `(workspace)/layout.tsx` + Sidebar
- 全局状态（zustand）：`currentUser / currentProjectId / settings cache`
- API client（`lib/api/*.ts`，按域拆：auth / projects / documents / generations / feedbacks / cost）
- 把原型 CSS 变量（`--brand --think --search --tool --gen`）迁到 `globals.css`
- 把原型 Login / Projects / Sidebar 组件 `.jsx → .tsx`，对接 Week 1-4 真实 API
- 验收：走通"登录 → 看项目列表 → 建项目 → 切换项目"

**Scope 红线**：
- 不改后端 API 形状（如需新端点单开 feat）
- 不做 Chat 主界面 / 上传 UI / Pipeline 可视化（Week 6）
- 不做反馈 / 历史 / 笔记库（Week 7）
- 不动 packages/rag-core

**后端已就绪资产（Week 1-4 全部 19 端点）**：
- auth：register/login/me
- projects：CRUD + settings
- documents：upload/list/get/delete + ingestion/SSE
- generations：generate + list(cursor + 过滤) + get
- feedbacks：upsert/get
- cost：summary
- auto-generations：list by document

**已知注意点**：
- API 列表分页结构变了：`{ generations, nextCursor }`，前端需写无限滚动 / load-more
- generation.source 字段区分 manual/auto，前端可考虑用不同卡片样式
- Cost summary `daily: []` 在没数据日返回空数组，前端要兜底显示

---

## 历史交接记录（会话 41 — feat-200.2 Week 2 完成 ✅ Documents + Ingestion + SSE）

**进度**：feat-200.2 完成。详见 progress.md 2026-05-27 Session 41。

---

## 历史交接记录（会话 40 — feat-200.1 Week 1 完成 ✅ Auth + Projects + Tracing 骨架）

## 本会话变更摘要

🎉 Week 1 完整闭环：12 个新文件 + 9 个新路由 + 17 项 curl smoke 全过

【交付】
- `apps/api/src/db/` — DDL（users/projects/project_settings）+ `withClient` 统一 DB 入口
- `apps/api/src/auth/` — bcrypt + JWT(HS256 7d) + JwtAuthGuard + register/login/me
- `apps/api/src/projects/` — CRUD + settings 子端点，全部按 owner_id 过滤（跨用户一律 404）
- `apps/api/src/common/` — AsyncLocalStorage TraceContext + TracingInterceptor + x-trace-id header
- `app.module.ts` 注册 4 个新 module；`main.ts` Swagger 加 BearerAuth

【新增依赖】
- bcrypt + jsonwebtoken（仅 apps/api）

【验证】
- pnpm -r typecheck/lint 全过
- 17 项 curl：register / 409 dup / 401 wrong-pw / login / me / projects CRUD（5 端点）/ settings GET+PUT / 跨用户 404 防枚举 / DELETE 后 FK CASCADE / x-trace-id 头
- DB schema：FK CASCADE + 索引齐全（\\d 验证）

【面试题】
`.interview/feat-200.1_auth-projects.md`（6 题）：passport vs 手写 / 账户枚举 / TEXT vs BYTEA / ALS vs REQUEST scope DI / Client vs Pool / DDL inline vs migrations

**进度**：feat-200.1 status="done" ✅。下一步 feat-200.2（Week 2）。

---

## Week 2 启动清单（feat-200.2，2026-05-27 Session 40 → Session 41）

**下一 Session 开工前必读**：
1. 上一周成果：`progress.md` 2026-05-27 Session 40 条目
2. 本周任务：`/Users/sissi/.claude/plans/users-sissi-claude-plans-coze-agent-war-peppy-peach.md` § "Week 2"
3. `feature_list.json` feat-200.2 条目

**Week 2 边界**：
- documents 表加 `category` 列（product / compete / history）
- 新建 `ingestion_jobs` 表（id / project_id / document_id / status / progress / current_stage / chunks_done / chunks_total / cost_usd / error）
- 改造 ingestion 走异步 job（不阻塞 HTTP 请求；现有 idempotency / preprocess / chunk / embedding / storage 链改成 job runner）
- SSE 端点：`GET /projects/:id/ingestion/:jobId/events`（每秒推 progress）
- 验收：上传 PDF 后 SSE 流看进度 0→100

**Scope 红线**：
- 不动 Week 1 已做的 auth / projects / settings（除非发现 bug）
- 不做前端 Upload 组件（Week 6）
- 不动 packages/rag-core（已稳定）

**启动命令**：
```bash
# Postgres：主仓 Postgres 容器已在 5432，主仓 .claude/worktrees/magical-raman-204f50 也可复用
docker exec -e PGPASSWORD=postgres harness_idea_maker-postgres-1 psql -U postgres -d rag

# API（注意环境变量）：
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/rag' \
JWT_SECRET=feat-200.1-dev-secret-needs-16-chars \
pnpm --filter @harness/api dev
```

**已验证可复用**：
- DDL 自动初始化（`db.service.ts` 在首次 withClient 时跑 CREATE TABLE IF NOT EXISTS）
- `@CurrentUser()` 装饰器 + JwtAuthGuard 现成可挂在新 controller 上
- TracingInterceptor 全局自动生效，新路由也带 x-trace-id

---

## 历史交接记录（会话 39 — Idea-Maker MVP 8 周规划完成 + Harness 更新）

🎉 战略调整完成：
- **重命名**：Coze-Agent → Idea-Maker
- **架构简化**：ReAct Agent → Pipeline Orchestrator（YAML 配置驱动）
- **规划细化**：8 周 MVP 排期确定（feat-200.1~8），每周明确的验收标准
- **决策锁定**：4 个核心决策已确认（BYOK / SSE / 流式化 / Auth）
- **Harness 更新**：新增 `.claude/memory/mvp-plan-2026-05-27.md` + 更新 AGENTS.md / feature_list.json / progress.md

【NestJS 路由 25 路径】
- /health x1
- /pipeline/{18 个 stage} x18
- /documents + /documents/{id} x2
- /snapshots + /snapshots/{stageId} x2
- /pipeline-runs + /pipeline-runs/{id} x2

【新模块】
- SnapshotsModule：SnapshotsService (DDL + CRUD) + SnapshotsController + PipelineRunsController
- 复用 PipelineModule 导出的 ProvidersService 创建 pg 连接

【apps/web 清理】
- 删除 app/api/* 整个目录
- 删除 lib/providers.ts、lib/snapshotDb.ts
- lib/docStore.ts 缩成 28 行类型存根（仅 DocumentRecord 类型）
- lib/api-base.ts 取消白名单：所有 fetch 走 NestJS

【关键设计】
- DocStoreService 加 get(id) / getBuffer(doc) 给 idempotency / preprocess
- DocumentsModule + PipelineModule 互相 export DocStoreService / ProvidersService

【验收】
- pnpm -r typecheck/lint 全过；rag-core 238/238 单测
- NestJS smoke：preprocess 真实读 PRODUCT.md 抽 cleanText / idempotency 算 sha256 命中 v9 /
  pipeline-runs 无 DB 时 400 / filter 空 upstream 400
- 跨进程数据共享：apps/api 通过共用 apps/web/data/documents.json 看到 17 文档

**进度**：feat-100.4 status="done" ✅。feat-100 epic 4/4 全部收尾。
下一步：feat-010 起业务 feature（Pipeline Agent / Content Agent / Studio）。

【当前运行方式（feat-100.4 起）】
- `pnpm --filter @harness/api dev` (ts-node-dev, 端口 3001) — 后端
- `pnpm --filter @harness/web dev` — 前端
- 前端必须设 `NEXT_PUBLIC_USE_NEST_API=true` 才能 fetch 后端

【部署架构（feat-100.4）】
- 多服务：apps/web (Next.js) + apps/api (NestJS) + Postgres + services/pymupdf
- CI：`pnpm -r typecheck/lint/test` 已就绪

---

## Week 1 启动清单（2026-05-27 Session 39 → Session 40）

**下一个 Session 开工前必读**：
1. `.claude/memory/mvp-plan-2026-05-27.md` —— 4 个决策的原理
2. `/Users/sissi/.claude/plans/users-sissi-claude-plans-coze-agent-war-peppy-peach.md` —— Week 1-8 完整任务
3. `AGENTS.md` 新增的"阶段 3 MVP"章节
4. `feature_list.json` 的 feat-200.1 条目

**Week 1 边界明确**：
- **只做 feat-200.1**：auth / projects / project_settings + TracingInterceptor
- **不涉及**：pipeline 改造、前端任何页面、文档相关逻辑
- **验收标准**：Postman 跑通登录 + 建项目 + 改 settings（见 plan 文档 §"Week 1"）

**scope control 警告**：
- 不要提前做 password reset / OAuth / Lucia —— 这些是 Phase 5
- 不要改 packages/rag-core 或 18-stage pipelines —— 这些在 feat-100 已稳定
- 不要新增 Playground 功能 —— Playground 保留为独立的"高级调试视图"

**周末验收流程**：
1. 代码改动完成，跑 `pnpm -r typecheck/lint`
2. Postman 验证 4 个新端点
3. 更新 `feature_list.json` feat-200.1 的 status 为 "done" + evidence
4. 更新 `progress.md` 记录这周完成的内容和遇到的问题
5. 更新 `session-handoff.md`，写明 Week 2 启动清单

**关键文件位置**：
- 规划：`/Users/sissi/.claude/plans/users-sissi-claude-plans-coze-agent-war-peppy-peach.md`
- 决策：`./.claude/memory/mvp-plan-2026-05-27.md`
- 功能追踪：`./feature_list.json` (feat-200.x)
- 规则：`./AGENTS.md` (阶段 3 MVP 章节)
- 进度：`./progress.md`
- 交接：`./session-handoff.md` （本文件）

---

## 历史交接记录（会话 37 — feat-100.3 Wave 3 ✅ NestJS 后端启动 + 5 端点双跑）

🎉 feat-100.3 完整收尾：apps/api NestJS 真正能跑了，5 端点已在 NestJS + Next.js 上双跑。

【NestJS 基建】
- `apps/api/src/main.ts`：ValidationPipe + CORS + PipelineExceptionFilter + Swagger UI (`/docs`)
- `common/pipeline-exception.filter.ts`：PipelineError/ZodError/HttpException → HTTP envelope
- `pipeline/providers.service.ts`：DI 工厂复刻 apps/web/lib/providers.ts 的 env 优先级
- 4 个 Controller：chunk / embedding / retrieval / generation
- DocumentsModule：DocStoreService 共用 apps/web/data/documents.json（DOCUMENTS_DATA_FILE 可改）

【apps/web 切换层】
- `lib/api-base.ts`：`pipelineUrl(stageId)` + `documentsUrl(suffix)` 两个 helper
- `NEXT_PUBLIC_USE_NEST_API=true` + `NEXT_PUBLIC_API_URL=http://localhost:3001` 切换；默认走 Next.js 安全
- PlaygroundShell + DocumentUploadPanel 共 5 处 fetch 替换

【关键踩坑】tsx (esbuild) 不支持 `emitDecoratorMetadata` → NestJS DI 全静默失败。换 ts-node-dev 解决

【验收】
- pnpm -r typecheck/lint 全过；rag-core 238/238 单测
- NestJS 自测：health 200 / Swagger 200 / chunk 正确分块 / documents 列表 17 / DELETE missing 404 / Zod 400
- Swagger 路径：/health, /pipeline/{chunk,embedding,retrieval,generation}, /documents, /documents/{id}

**当前 worktree**：`.claude/worktrees/refactor-monorepo/`，分支 `claude/refactor-monorepo`。

**进度**：feat-100.3 status="done" ✅。Wave 3 完整收尾。
下一步：feat-100.4 Wave 4（剩余 14 stage 迁完 + 删 apps/web/app/api/* + CI 多服务）。

【运行方式】
- `pnpm --filter @harness/api dev` (ts-node-dev, 端口 3001) — NestJS
- `pnpm --filter @harness/web dev` — Next.js
- 双跑期 web 默认走 Next.js；想试 NestJS 路径设 `NEXT_PUBLIC_USE_NEST_API=true` + `NEXT_PUBLIC_API_URL=http://localhost:3001`

---

## 历史交接记录（会话 21 — feat-100.2 启动：rag-core 基础设施 + idempotency 样板）

阶段 2.5 Wave 2 启动。打造 rag-core 抽取工具链 + idempotency 作样板（1/18 stage）：
- packages/rag-core：vitest 配置 + errors.ts (PipelineError) + ingestion/idempotency.ts + README.md「提取模式」
- packages/shared-types：zod IdempotencyParamsSchema + 接口，加 zod 依赖
- 关键修复：next.config.ts 加 transpilePackages（缺失会让 Next.js 子进程风暴→机器假死）
- 新约定：每加一个 workspace 包必须登记到 `transpilePackages`

---

## 历史交接记录（会话 20 — feat-100.1 完成：pnpm monorepo 骨架）

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

- **主分支**：`main`，当前 HEAD：`b25b053`（feat-100.3 Wave 3 已合）。feat-100.4 在 `claude/refactor-monorepo` 待 ff merge。
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
