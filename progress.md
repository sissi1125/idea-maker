# 进度记录

## 2026-07-13 Product Brief 产品迭代方案

- 新增 `docs/PRODUCT_BRIEF_ITERATION_PLAN.md`，定义 Phase 4 的完整产品闭环：受限官网与文档来源 → 可确认 Product Brief → Claim Map → 规则门禁与评测 Agent → 人工筛选 → 反馈学习 → 内容包 → 后置 HTML 海报。
- 明确 Product Brief 只作为统一命名，字段覆盖产品事实、用户与场景、定位、表达约束、视觉资产、内容记忆和平台规则；事实字段必须有 evidence 或用户确认。
- 官网导入限定为用户主动提供的官方域名；社交平台不引入爬虫。视觉资产在 Brief 后按需补充，不阻塞文本闭环。
- 规划 feature：新增 `feat-400.1` 至 `feat-400.5`；旧 `feat-012` Studio 规划及其子项已标记 `superseded`，不再实施。
- 本次为文档与 harness 规划，未改业务代码；文档结构与 JSON consistency 待 `node scripts/check-harness.mjs` 验证。

## 2026-07-13 Codex 迁移审计

- 将 `AGENTS.md` 设为唯一受版本控制的协作入口；新分支前缀改为 `codex/`，`.claude/` 作为忽略的历史本地目录保留，新增 `.codex/` 忽略规则。
- 修复 `init.sh` 漏掉 `superseded` status 导致的前置校验失败；移除当前规划对 Claude Code 用户目录文件的依赖。
- 修复验证编排：`shared-types` / `rag-core` 的 package exports 指向 `dist`，因此初始化与 CI 先构建两个内部库；CI 现在同时运行 API 的 199 个单测。
- 验证：干净锁定安装后 `pnpm -r typecheck` 通过；`pnpm -r test` 通过（438 tests）；`pnpm -r lint` 仍失败，API 有 10 个未使用变量错误；Web 生产 build 在受限网络下无法下载 Google Geist fonts。
- 审计发现：Agent run 的 SSE、读取、spill 和 abort 端点未验证项目 owner，且 `encrypted_api_key` 当前为明文。应在下一项安全 feature 优先处理。

## 2026-05-28（feat-200.8.2 + 200.8.3：全局 toast + Loading/Empty/Error 三态 + 部署联调）✅

### 范围

MVP 收尾两个子 feature——`200.8.1 SSE` 推迟单独做。

### 交付

**200.8.2 toast + 三态**：

| 文件 | 说明 |
|------|------|
| `apps/web/components/toast/ToastProvider.tsx` | 全自写 toast 容器（~200 行）：4 variant + auto-dismiss + 模块级 globalHandler + reducer 防丢消息 |
| `apps/web/app/providers.tsx` | ToastProvider 包在最外层 |
| `apps/web/app/(workspace)/projects/page.tsx` | 项目列表 Empty / Loading skeleton 状态；alert/inline 错误统一改 toast |
| `apps/web/app/(workspace)/projects/[id]/page.tsx` | Chat 页 generate 失败 → toast.error；违规 → toast.warn 提示看横幅 |
| `apps/web/app/(workspace)/projects/[id]/settings/page.tsx` | 保存成功/失败 → toast |
| `apps/web/app/(workspace)/projects/[id]/knowledge/page.tsx` | 上传/删除 → toast；同时修了 set-state-in-effect lint（loadDocuments 内联到 useEffect + cancelled 标记） |
| `apps/web/app/(workspace)/projects/[id]/notes/page.tsx` | 更新/删除 → toast |
| `apps/web/components/feedback/FeedbackPanel.tsx` | 提交成功/失败 → toast |
| `apps/web/components/notes/AddToLibraryButton.tsx` | 保存成功/失败 → toast |

**200.8.3 部署联调**：

| 文件 | 说明 |
|------|------|
| `apps/api/src/db/db.service.ts` | initSchema 加 `CREATE EXTENSION IF NOT EXISTS vector`——Fly Postgres 等环境无需手动装扩展 |
| `apps/web/lib/api/client.ts` | `resolveBaseUrl()` 三级回退：env > window.location.origin（浏览器内同源 fallback）> localhost；同站部署无需配 NEXT_PUBLIC_API_URL |
| `.github/workflows/ci.yml` | CI：每 PR 跑 typecheck + lint + unit tests；smoke 走 workflow_dispatch 手动触发（含 pgvector postgres service + LLM secrets） |
| `docs/DEPLOY.md` | 补充 NEXT_PUBLIC_API_URL 解析策略 + CI 章节 |

### 设计决策

- **自写 toast 而非引第三方**：~200 行 + 0 依赖。react-hot-toast / sonner 都好用但样式/动画风格不一定能完美贴项目色板；自写一次后改样式不用绕第三方 API
- **toast vs inline 错误的边界**：表单内验证错误（如新建项目 name 校验）保留 inline——视线不需要跳到右下角；异步操作失败 / 系统通知统一走 toast
- **modular-level globalHandler**：让 apiFetch / store 等非组件代码也能 toast（暂未启用，但 API 已就绪）
- **Empty state 而非空白**：项目列表为空时显示引导而非什么都没有——降低用户首次使用心理门槛
- **CREATE EXTENSION 兜底而非强求**：fly postgres 实测 `vector` 已预装，但部分自建 PG 没装；`IF NOT EXISTS` + try/catch 让两种环境都能跑
- **NEXT_PUBLIC_API_URL fallback 到 window.origin**：单 VM 部署时前端从 `https://x.fly.dev` 访问 API，自然落到同源；跨 app 部署再显式配
- **smoke 不在每 PR 跑**：依赖外部 LLM API + LLM 调用收费——`workflow_dispatch` 手动触发用于 release 前冒烟，PR 跑 typecheck/lint/unit 足够

### 验证

- [x] `pnpm -r typecheck` ✅
- [x] `pnpm -F @harness/web lint --max-warnings 0` ✅（顺手清了 knowledge 页 set-state-in-effect 旧错）
- [x] `pnpm -F @harness/api lint` ✅
- [x] `pnpm smoke` ✅ 10 步 18s 全过（toast + 部署改动未引入回归）

### 推迟到 200.8.1

SSE 流式化整块推迟单独做。后续做的方向：Token 级（最佳体验），LLM chat.completions stream:true → 后端 SSE 推 chunk → 前端打字机效果。需要改 `rag-core/generation/generation.ts` 的 LLM 调用模式。

---

## 2026-05-28（feat-200.8 Week 8：平台规则验证 + e2e smoke + Fly.io 部署资产）✅

### 范围

MVP 8 周收官周——聚焦在交付价值最高的两块：

1. **平台规则系统**（业务逻辑闭环）：后端 CRUD + prompt 注入 + validator 校验，前端 Settings 管理 + Chat 选择器 + 违规横幅
2. **可发布交付物**：e2e smoke 脚本 + Fly.io 部署资产（Dockerfile / fly.toml / 一键部署文档）

原计划另外两块 **SSE 流式化** 和 **全局 toast + 三态 review** 推迟到 200.8.x 子 feature——本周聚焦在让 MVP 能"发出去给真用户测"上。

### 交付

**后端（新增）**：

| 文件 | 说明 |
|------|------|
| `apps/api/src/db/schema.ts` | 新增 `DDL_PLATFORM_RULES`（id/project_id/name/config(JSONB)/enabled + index by project） |
| `apps/api/src/platform-rules/platform-rules.types.ts` | PlatformRuleRow / PlatformRuleConfig / Create+UpdateInput / RuleViolation |
| `apps/api/src/platform-rules/platform-rules.service.ts` | CRUD + assertOwner 校验 + `listEnabledByIds` 内部接口（自动过滤 disabled） |
| `apps/api/src/platform-rules/platform-rules.controller.ts` | 5 个 REST 端点：POST/GET list/GET one/PATCH/DELETE，含 class-validator DTO |
| `apps/api/src/platform-rules/platform-rules.module.ts` | 模块声明 |
| `apps/api/src/platform-rules/rule-validator.ts` | `validateAgainstRules`：maxLength（用 `[...text].length` 正确处理 emoji/中文）/ bannedKeywords（不区分大小写）/ mandatoryTagPattern（regex try-catch 防恶意）三检查；`buildRuleSystemPrompt`：把规则压成中文注入 prompt |
| `apps/api/src/app.module.ts` | 注册 PlatformRulesModule |

**后端（修改）**：

| 文件 | 改动 |
|------|------|
| `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.types.ts` | `GenerateRequest` 加 `platformRuleIds?: string[]`；`GenerateResponse` 加 `violations: ViolationItem[]`；新增 ViolationItem 类型 |
| `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.service.ts` | `run(query, options?)` 接受 `ruleSystemPrompt`；prompt-build 阶段把规则提示拼到 contextText 之前并加 `---` 分隔 |
| `apps/api/src/generations/generations.service.ts` | constructor 注入 PlatformRulesService；generate 流程：加载规则 → 构建 ruleSystemPrompt → 传给 orchestrator → 完成后跑 validator → response 带 violations |
| `apps/api/src/generations/generations.module.ts` | imports 加 PlatformRulesModule |
| `apps/api/src/generations/generations.controller.ts` | POST /generate body 把 `platformRuleIds` 透传给 service |

**前端（新增）**：

| 文件 | 说明 |
|------|------|
| `apps/web/lib/api/platform-rules.ts` | CRUD 客户端 + `PLATFORM_PRESETS`（4 平台预设：小红书 / 微博 / 抖音 / 公众号） |
| `apps/web/components/platform-rules/PlatformRulesManager.tsx` | Settings 内嵌的完整管理面板：预设快捷添加 + 现有规则 RuleCard 列表（行内编辑/删除/启用切换） + 自定义新建 |
| `apps/web/components/platform-rules/RuleSelector.tsx` | Chat 输入框上方多选 chip；空状态 → 链接去 Settings |
| `apps/web/components/platform-rules/ViolationsBanner.tsx` | 结果上方橙黄警告 banner，按 violation.type 分色 chip |

**前端（修改）**：

| 文件 | 改动 |
|------|------|
| `apps/web/lib/api/generations.ts` | GenerateResponse 加 `violations` + 新增 `ViolationItem` 类型；`generate()` 接受 `options.platformRuleIds` |
| `apps/web/lib/api/index.ts` | 导出 platformRulesApi + ViolationItem 等类型 |
| `apps/web/app/(workspace)/projects/[id]/settings/page.tsx` | 删除"平台规则（Week 8）"占位 Section，挂上 `<PlatformRulesManager />` |
| `apps/web/app/(workspace)/projects/[id]/page.tsx` | ChatInput 上方加 RuleSelector；startGenerate 传 platformRuleIds；GeneratedResult 顶部加 ViolationsBanner |
| `apps/web/next.config.ts` | 加 `output: "standalone"`——Dockerfile 需要 |

**E2E smoke + 部署**：

| 文件 | 说明 |
|------|------|
| `scripts/smoke.mjs` | 10 步端到端：注册 → 创建项目 → 上传文档 → 等 ingestion（轮询） → 创建小红书规则 → generate 带规则 → 验证 violations 字段 → 反馈 → 保存笔记 → 列笔记 |
| `package.json` | 加 `pnpm smoke` 脚本 |
| `Dockerfile` | 多阶段构建：base / deps / build / runner；runner 用 Next.js standalone + NestJS dist + dumb-init |
| `.dockerignore` | 排除 node_modules / .next / .git / .claude / 文档元数据等 |
| `scripts/docker-entrypoint.sh` | 并发启动 API + Web，任一退出整体退出（让 Fly.io / Docker restart 接管） |
| `fly.toml` | app 配置：双端口（80→3000 前端 / 3001 API）+ HTTP healthcheck + Volume + 2c1g VM |
| `docs/DEPLOY.md` | 一键部署清单 + secrets 完整列表 + 验证 / 运维命令 |

### 设计决策

- **平台规则是项目级而非用户级**：同一用户的不同项目可能面向不同平台；项目内可多条规则共存（多选启用）
- **`ON DELETE CASCADE` 而非 SET NULL**：规则不像笔记是"内容资产"——它依附于项目，项目没了规则也没意义
- **预设 + 自定义双路径**：4 平台预设让 95% 用户零配置上手；自定义留给小众平台 / 品牌特定约束
- **`listEnabledByIds` 二次过滤 disabled**：前端传过来的 ruleId 可能是缓存的旧值，用户在 Settings 关掉后不应再被注入
- **prompt 注入 vs 后置 validator 双保险**：LLM 不一定 100% 听话，注入是"软提示"让它尽量遵守，validator 是"硬检查"标出违规；用户拿到结果立刻知道哪里没合规
- **violations 不阻塞保存**：banner 是橙黄 warn 调，不是红色 error；用户自己决定改不改，体验权在用户手里
- **`[...text].length` 算字符**：emoji 和中文的字符数计数 JS 默认会算错（emoji 算 2 / surrogate pair）；用 spread 转成 code point 数组才准确
- **regex try-catch 包住**：用户在 mandatoryTagPattern 填非法正则不能崩进程
- **Dockerfile 单 VM 双进程**：MVP 阶段省钱（API + Web 一个容器），后续扩容拆双 fly app
- **deploy 走 Fly.io 而非 Vercel + Render**：单 platform 部署 + Postgres + Volume 一站式；国内访问选东京机房

### 验证

- [x] `pnpm -r typecheck` ✅
- [x] `pnpm -F @harness/web lint --max-warnings 0` ✅
- [x] `pnpm -F @harness/api lint` ✅
- [x] `pnpm smoke` ✅ 10 步 21 秒全过
- [ ] `fly deploy` 实际部署：需用户操作账号（Dockerfile + fly.toml 就绪）

### MVP 8 周交付总结

| Week | Feature | 状态 |
|------|---------|------|
| Week 1 | feat-200.1 Auth + Projects + Tracing 骨架 | ✅ |
| Week 2 | feat-200.2 Documents + Ingestion + SSE | ✅ |
| Week 3 | feat-200.3 Pipeline Orchestrator + Generations | ✅ |
| Week 4 | feat-200.4 Feedbacks + Auto-Gen + Cost Summary | ✅ |
| Week 5 | feat-200.5 Frontend 骨架 + Login + Project 管理 | ✅ |
| Week 6 | feat-200.6 Chat 主界面 + 知识库 + PipelineTrace + (patch) | ✅ |
| Week 7 | feat-200.7 反馈 + 历史 + 笔记库 + Settings | ✅ |
| Week 8 | feat-200.8 平台规则 + e2e smoke + Fly.io 部署资产 | ✅ |

剩余 backlog（200.8 子 feature 推迟）：
- `feat-200.8.1` SSE 流式化（generate 推送 stage 事件，前端伪动画切真实事件驱动）
- `feat-200.8.2` 全局 toast 错误处理 + Loading / Empty / Error 三态 review
- `feat-200.8.3` 实际 fly deploy + 公网联调 + 性能 review

下一阶段：**Phase 3.5 真 Agent**（feat-010.x，LLM 决策循环替代固定 YAML pipeline）

---

## 2026-05-28（feat-200.7 Week 7：反馈 + 历史 + 笔记库 + Settings 完善）✅

### 范围

feat-200.7 整周交付——前端为主，后端补一张表：

1. **反馈面板** —— Chat 页生成结果卡 + 历史页详情下方都挂 `FeedbackPanel`，4 维评分 + 编辑生成结果 + 备注，支持部分提交
2. **历史页** —— `/projects/[id]/history`：cursor 分页 + source filter（all / manual / auto）+ 行内展开看 trace + 反馈面板
3. **笔记库** —— 后端新建 `notes` 表 + NotesModule CRUD；前端 `/projects/[id]/notes` 列表 + 内联编辑 / 删除 + `AddToLibraryButton` 在 Chat 和 History 都接入
4. **Settings 完善** —— 复用上 session 写到一半的 685 行 settings/page.tsx（LLM 配置 + 思考深度 + RAG 策略只读），修 lint，加平台规则占位 Tab；Sidebar 加"笔记库"入口

### 交付

**后端（新增）**：
| 文件 | 说明 |
|------|------|
| `apps/api/src/db/schema.ts` | 新增 `DDL_NOTES`（id/project_id/generation_id/title/content/tags[]/timestamps）+ index by project+created_at + by generation_id |
| `apps/api/src/notes/notes.types.ts` | NoteRow / CreateNoteInput / UpdateNoteInput |
| `apps/api/src/notes/notes.service.ts` | CRUD：assertOwner 校验 + create（验 generationId 归属本项目）/ list（limit+offset）/ getOne / update（PATCH 语义）/ delete |
| `apps/api/src/notes/notes.controller.ts` | 5 个 REST 端点：POST/GET list/GET one/PATCH/DELETE |
| `apps/api/src/notes/notes.module.ts` | 注册 |
| `apps/api/src/app.module.ts` | 引入 NotesModule |

**前端（新增）**：
| 文件 | 说明 |
|------|------|
| `apps/web/lib/api/feedbacks.ts` | submitFeedback / getFeedback（FeedbackInput / FeedbackRow） |
| `apps/web/lib/api/notes.ts` | listNotes / getNote / createNote / updateNote / deleteNote |
| `apps/web/lib/api/index.ts` | 加 feedbacksApi + notesApi 导出 |
| `apps/web/components/feedback/MultiDimRating.tsx` | 4 维 1-5 星受控控件，再次点同一星 toggle 回 null |
| `apps/web/components/feedback/GenerationEditor.tsx` | 折叠 textarea + 字符数对比，没改动不写 editDiff |
| `apps/web/components/feedback/FeedbackPanel.tsx` | 组合上面三个 + comment + 提交按钮；展开时拉历史反馈预填表单；状态机 idle→submitting→saved/error |
| `apps/web/components/notes/AddToLibraryButton.tsx` | 内联表单：title（默认从 query 截前 30 字符）+ tags，状态机 idle→editing→saving→saved |
| `apps/web/app/(workspace)/projects/[id]/history/page.tsx` | 历史页主组件 + HistoryRow（折叠/展开 + 评分 chip + cost 摘要 + trace + FeedbackPanel + AddToLibraryButton） |
| `apps/web/app/(workspace)/projects/[id]/notes/page.tsx` | 笔记库主组件 + NoteCard（标题 + tags + 编辑 / 删除 + 行内删除确认） |

**前端（修改）**：
| 文件 | 改动 |
|------|------|
| `apps/web/app/(workspace)/projects/[id]/page.tsx` | GeneratedResult 加成本分解 chip 行（6 个 chip）+ FeedbackPanel + AddToLibraryButton |
| `apps/web/app/(workspace)/projects/[id]/settings/page.tsx` | 复用上 session 的 685 行；修 set-state-in-effect lint（loadSettings inline 进 useEffect + cancelled 标记）；尾部加"平台规则（Week 8）"占位 Section |
| `apps/web/components/layout/Sidebar.tsx` | 新增"笔记库"导航项（BookOpen icon），"内容资产" → "生成历史" 名字更直白 |

### 设计决策

- **反馈 UI 在生成结果卡底部默认折叠**——主流程是看结果、评价是次要动作；折叠按钮带"已评 X.X / 5"摘要让用户一眼看到已评状态
- **部分提交允许**——4 维评分 + editDiff + comment 任一非空就能提交；后端 `feedbacks.upsert` ON CONFLICT(generation_id) DO UPDATE，重复提交自动覆盖
- **editDiff 只在内容真改了才存**——`value !== original` 才传 editDiff，相同就传 null，避免脏数据
- **笔记库独立表，不复用 generations.is_saved 列**——笔记是用户的内容资产，应该独立于事实记录；generation 被删（feat-200.8 可能加 retention 策略）也不影响笔记；generation_id ON DELETE SET NULL 保留来源信息但不阻塞删除
- **限于 limit+offset 不上 cursor**——笔记体量小（< 500/项目预估），limit+offset 实现简单且支持 total 计数；后续超大时再迁 cursor
- **AddToLibraryButton 走内联表单不弹 Modal**——Modal 打断阅读节奏，内联表单顺手；标题默认从 query 截前 30 字符让用户可改可不改
- **Settings 的平台规则做占位**——feat-200.8 正式实装，但用户进 Settings 就能知道这块功能在哪、什么时候到位

### 验证

- [x] `pnpm -r typecheck` ✅
- [x] `pnpm -F @harness/web lint --max-warnings 0` ✅（顺手修了上 session 遗留的 settings/page.tsx 同款 lint 错）
- [x] `pnpm -F @harness/api lint` ✅
- [ ] 用户端到端：提一个问题 → 生成结果 → 评分 + 保存到笔记库 → 去笔记库看到 → 去历史看到评分（待用户实测）

---

## 2026-05-28（feat-200.6 补丁 — Ingestion 阶段输出可视化 + 项目级摘要接入）✅

### 范围

feat-200.6 完成性修补，**不开新 feature 编号**。补齐 Week 6 验收里"端到端传文档 → 自动卡片 → 看 trace"中"看到 ingestion 真的跑了什么"和"自动卡片真实展示"两环：

1. **Ingestion 阶段输出** — runner 在 5 个 stage 结束时各写一份输出摘要进 `ingestion_jobs.stage_outputs` JSONB；前端知识库展示折叠面板。
2. **项目级自动摘要接入** — 后端已存在的 `auto_generations` 机制（监听 ingestion.completed → product 触发 intro 卡 / compete 触发 compete 卡）被前端 Chat 页 `ProjectInfoCards` 真正读到——以前是写死占位文案。新增 `/projects/:pid/auto-generations/latest` 端点用 DISTINCT ON 取每种 card_type 最新成功摘要。

### 交付

| 文件 | 说明 |
|------|------|
| `apps/api/src/db/schema.ts` | `ingestion_jobs` 加 `stage_outputs JSONB`（幂等 ADD COLUMN IF NOT EXISTS） |
| `apps/api/src/ingestion/ingestion.types.ts` | 新增 `IngestionStageOutput` / `IngestionStageOutputs`；`IngestionJobRow.stageOutputs` |
| `apps/api/src/ingestion/ingestion.service.ts` | 新增 `setStageOutput(jobId, stage, output)`（jsonb_set 写入） |
| `apps/api/src/ingestion/ingestion-job-runner.ts` | 5 个 stage 各加 startTime + 完成时 `setStageOutput`：idempotency(hash 前8位/decision)、preprocess(charsExtracted/sourceRefs/pageCount)、chunk(chunksTotal/avgChunkSize)、embedding(model/dimension/batchCount/mock)、storage(rowsInserted/indexMode) |
| `apps/api/src/auto-generations/auto-generations.types.ts` | 新增 `ProjectAutoGenLatest` 类型 |
| `apps/api/src/auto-generations/auto-generations.service.ts` | 新增 `getLatestByProject(projectId)` — DISTINCT ON (card_type) JOIN generations 取最新成功 |
| `apps/api/src/auto-generations/auto-generations.controller.ts` | 新增 `ProjectAutoGenerationsController`：GET `/projects/:projectId/auto-generations/latest` |
| `apps/api/src/auto-generations/auto-generations.module.ts` | 注册新 controller |
| `apps/web/lib/api/documents.ts` | `IngestionJob` 加 `stageOutputs`；导出 `IngestionStage` / `IngestionStageOutput` / `IngestionStageOutputs` |
| `apps/web/lib/api/auto-generations.ts` | 新文件：`getLatestProjectAutoGen` + `ProjectAutoGenLatest` 类型 |
| `apps/web/lib/api/index.ts` | barrel 导出 |
| `apps/web/app/(workspace)/projects/[id]/knowledge/page.tsx` | 新增 `StageOutputsPanel` + 文件行折叠按钮；处理中自动展开，完成后默认收起 |
| `apps/web/app/(workspace)/projects/[id]/page.tsx` | `ProjectInfoCards` 接受 `summaries` props；进入页面拉一次 + generate 完后再拉；有 resultNotes 替换 body，无则保留引导文案 |

### 设计决策

- **不另建 project_summaries 表**：发现 `auto_generations`（feat-200.4 已交付）正好就是这件事的事实表——监听 ingestion.completed、按 category 触发 generate、resultNotes 就是卡片正文。新建表会重复且让两套真值并存。
- **DISTINCT ON 而非"先 list 再前端过滤"**：单查询命中，less round-trip。
- **stageOutputs 是"摘要"不是"trace"**：method + 耗时 + 几个 metric chip，前端按 key=value 渲染；不暴露完整 input/output JSON，避免成 Playground 的克隆。
- **embedding 降级有 note 字段提示**：无 LLM API key 时走 debug-deterministic（FNV-1a hash 伪向量），UI 显示 ⚠ 提示，避免"看着完成了但实际没真嵌入"的隐性问题。
- **触发摘要不需要新代码**：复用已有 `AutoGenerationsService.handleIngestionCompleted`。LLM 调用前提：apps/api/.env 需要配 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`（否则 generate 阶段会失败，`/auto-generations/latest` 返回空数组，UI 自然降级到引导文案）。

### 验证

- [x] `pnpm -r typecheck` ✅
- [x] `pnpm -F @harness/web lint --max-warnings 0`：本次改动 0 报错（settings/page.tsx 那条 set-state-in-effect 是 untracked 文件的预存问题，与本补丁无关）
- [x] DDL 用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 保证向后兼容
- [ ] 真实 LLM 流程：依赖用户配 LLM_API_KEY 后端到端验证（产品介绍卡片真实渲染）

### 已知前提（需用户配置）

- `apps/api/.env` 需补：`LLM_API_KEY=...` / `LLM_BASE_URL=...` / `LLM_MODEL=...`（智谱/SiliconFlow/OpenAI 兼容均可）；
- 不配也不阻塞：ingestion 5 stage 全程跑通（storage 写 pgvector），只是 embedding 用 mock + 自动摘要会失败 → ProjectInfoCards 走引导文案。

### 后续端到端联调修复（同次会话）

用户配 .env 后实测发现 4 个隐性 bug，已逐个修复：

| 文件 | 问题 | 根因 | 修法 |
|------|------|------|------|
| `apps/api/src/main.ts` | LLM/Embedding env 没加载 → embedding 全走 mock | `ts-node-dev` 的 wrapper 把 `-r dotenv/config` flag 吃掉了，只保留 `tsconfig-paths/register` | 在 main.ts 顶部 `try { require('dotenv').config() } catch {}` 显式加载 |
| `apps/api/src/ingestion/ingestion-job-runner.ts` | embedding 阶段对 Ollama / 智谱发 `model: "text-embedding-3-small"` → 404 | 写死了 model 名 | 改成从 `ProvidersService.createEmbeddingClient().defaultModel` 拿（读 EMBEDDING_MODEL env） |
| `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.service.ts` | retrieval 阶段同样问题：默认 embeddingModel='text-embedding-v4' 但 Ollama 只有 bge-m3 | YAML 不写时走 zod schema 默认值 | orchestrator 在 parse 前注入 env 默认值，YAML 显式写过的优先 |
| `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.service.ts` | result_notes 是 `{"generatedContent": "..."}` JSON 原文，UI 显示原始 JSON | `extractResultText` 只识别 `ideas[]` / `result` 字段，marketing-ideas 输出 `generatedContent` 落到 `JSON.stringify` 兜底 | 按 4 种 GenerationOutput 形态分支：generatedContent / sellingPoints / targetSegment / ideas + summary 兜底，最后才 JSON.stringify |

### 用户体验补强

| 文件 | 补强点 |
|------|--------|
| `apps/api/src/auto-generations/{types,service,controller}.ts` | `/auto-generations/latest` 端点增加 `inFlight: ProjectAutoGenInFlight[]`——每种 card_type 取最新一行的 queued/running/failed，让前端能展示"LLM 生成中"状态 |
| `apps/web/app/(workspace)/projects/[id]/page.tsx` | ProjectInfoCards 三态：生成中（转圈 chip + 绿色提示行 + dot 跳动）/ 失败（红色 error 行）/ 已生成；存在 in-flight 时自动 3s 轮询直到结束 |
| `apps/web/app/(workspace)/projects/[id]/page.tsx` | `normalizeSummaryText` 容错——result_notes 以 `{` 开头时尝试 JSON.parse 抽 generatedContent/summary，保护历史脏数据 |
| `apps/web/app/(workspace)/projects/[id]/page.tsx` | 卡片正文 `maxHeight: 14em + overflowY: auto`——超长时卡片**内部**滚动，不撑歪两列等高 |

### 用户验证

- ✅ 端到端：上传文件 → ingestion 5 stage 正常 → embedding 走真实 bge-m3 → auto-gen 触发 → LLM 生成 markdown → Chat 页卡片显示自然语言（不再是 JSON）+ 期间显示 "LLM 生成中…" 转圈

---

## 2026-05-27（会话 44 — feat-200.6 Week 6：Chat 主界面 + 知识库 + PipelineTrace）✅

### 范围

feat-200.6：前端 Chat 主界面 + 知识库上传 + PipelineTrace 可视化。

### 交付

| 文件 | 说明 |
|------|------|
| `lib/api/documents.ts` | 文档 CRUD + ingestion 轮询 + SSE 连接 |
| `lib/api/generations.ts` | generate + list + get（镜像后端类型） |
| `lib/api/index.ts` | 新增 documentsApi / generationsApi 导出 |
| `components/pipeline/PipelineTrace.tsx` | 4 阶段进度动画 + trace 详情 + chunk 展示 |
| `app/(workspace)/projects/[id]/page.tsx` | Chat 主界面：InfoCards + PresetGrid + Input + Generate |
| `app/(workspace)/projects/[id]/knowledge/page.tsx` | 知识库：三分类 + Dropzone 上传 + 文件列表 |
| `app/globals.css` | 新增 shimmer/spin/dot/fade-up 动画 + kbd + no-scroll |
| `.interview/feat-200.6_chat-knowledge-trace.md` | 6 道面试题 |
| `apps/api/package.json` | 加 dotenv 依赖 + dev 脚本 -r dotenv/config |
| `apps/web/app/providers.tsx` | tokenGetter 同步注入修复 |

### 验证

- [x] typecheck ✅
- [x] eslint --max-warnings 0 ✅
- [x] 页面渲染 /login 200, /projects 200

### 设计决策

- PipelineTrace 用 rAF 驱动伪动画（running 时），finished 后展示真实 trace
- Chat 状态机 idle→running→done，generate 同步等待后端返回
- 知识库 Dropzone 上传走 FormData multipart，不经过 apiFetch 的 JSON 封装
- useStageProgress 用 useState + rAF callback 避免 lint set-state-in-effect 错误

---

## 2026-05-27（会话 43 — feat-200.5 Week 5：前端骨架 + 登录 + 项目管理）✅

### 范围

Week 5 核心：前端路由骨架（Next.js route groups）、登录/注册页、项目列表+CRUD、Sidebar、zustand 状态管理、API client 层、CSS 变量迁移。

### 交付

**新增文件（15 个）**：
- `apps/web/lib/api/client.ts` — fetch 封装 + ApiError + tokenGetter 注入
- `apps/web/lib/api/auth.ts` — login / register / getMe
- `apps/web/lib/api/projects.ts` — CRUD + settings
- `apps/web/lib/api/index.ts` — 统一导出
- `apps/web/lib/stores/auth-store.ts` — zustand persist + JWT + refreshUser
- `apps/web/lib/stores/projects-store.ts` — projects list + currentProjectId persist
- `apps/web/app/providers.tsx` — Client Component wrapper（tokenGetter 注入 + hydrate）
- `apps/web/app/(auth)/login/page.tsx` — 登录/注册双模式，lucide-react 图标，对接真实 API
- `apps/web/app/(workspace)/layout.tsx` — AuthGuard + Sidebar 布局
- `apps/web/app/(workspace)/projects/page.tsx` — 项目列表网格 + 内联新建 + 删除
- `apps/web/app/(workspace)/projects/[id]/page.tsx` — 项目详情占位（Week 6 填充）
- `apps/web/components/layout/Sidebar.tsx` — 品牌 + 项目切换器 + 导航 + 成本 + 用户区
- `apps/web/app/playground/page.tsx` — 旧 Playground 保留入口

**修改文件（3 个）**：
- `apps/web/app/globals.css` — 迁入原型 CSS 变量（30+ 变量）+ 全局原子类
- `apps/web/app/layout.tsx` — Providers 包裹 + metadata 更新
- `apps/web/app/page.tsx` — 根路径 redirect → /projects

**新增依赖**：zustand、lucide-react

### 验证

- pnpm -r typecheck / lint 全过
- API 端点验证：register + login + create project + list ✅
- 页面渲染验证（curl）：/login 200 + "欢迎回来" / /projects 200 + "加载中" / /playground 200 ✅
- 路由结构：(auth)/login、(workspace)/projects、/playground 三分区正确

---

## 2026-05-27（会话 43 — feat-200.4 Week 4：Feedbacks + Auto-Gen + Cost Summary + History API）✅

### 范围

Week 4 核心：自动生成卡片（ingestion.completed 事件驱动）、反馈系统（4 维评分 + edit_diff）、成本统计（按天 upsert）、generations cursor 分页 + 过滤。

### 交付

**新增文件（12 个）**：
- `apps/api/src/feedbacks/feedbacks.types.ts` — FeedbackInput / FeedbackRow / 4 维评分类型
- `apps/api/src/feedbacks/feedbacks.service.ts` — upsert（ON CONFLICT 覆盖式） + getByGeneration
- `apps/api/src/feedbacks/feedbacks.controller.ts` — POST + GET /generations/:id/feedback
- `apps/api/src/feedbacks/feedbacks.module.ts` — NestJS module
- `apps/api/src/cost/cost.types.ts` — CostDailyRow / CostSummaryResponse
- `apps/api/src/cost/cost.service.ts` — 按日期范围查询 cost_summary + totals 聚合
- `apps/api/src/cost/cost.controller.ts` — GET /projects/:id/cost/summary
- `apps/api/src/cost/cost.module.ts` — NestJS module
- `apps/api/src/auto-generations/auto-generations.types.ts` — AutoGenCardType / category→cards 映射 / query 模板
- `apps/api/src/auto-generations/auto-generations.service.ts` — @OnEvent(ingestion.completed) 监听 + 自动调 generate
- `apps/api/src/auto-generations/auto-generations.controller.ts` — GET /projects/:id/documents/:docId/auto-generations
- `apps/api/src/auto-generations/auto-generations.module.ts` — NestJS module

**修改文件（5 个）**：
- `apps/api/src/db/schema.ts` — 新增 DDL_FEEDBACKS / DDL_AUTO_GENERATIONS / DDL_COST_SUMMARY + generations 加 source 列
- `apps/api/src/generations/generations.service.ts` — cursor 分页 + source/status 过滤 + cost_summary upsert + skipOwnerCheck
- `apps/api/src/generations/generations.controller.ts` — Query params: cursor/limit/status/source
- `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.types.ts` — GenerationRow 加 source 字段
- `apps/api/src/app.module.ts` — 注册 FeedbacksModule / CostModule / AutoGenerationsModule

**5 新端点**：
- `POST /generations/:id/feedback` — upsert 4 维评分 + edit_diff（ON CONFLICT 覆盖）
- `GET /generations/:id/feedback` — 查询反馈（不存在返回 null）
- `GET /projects/:id/cost/summary?from=&to=` — 日级成本汇总（默认 30 天）
- `GET /projects/:id/documents/:docId/auto-generations` — 自动生成历史
- `GET /projects/:id/generations?cursor=&limit=&status=&source=` — 改造为 cursor 分页 + 过滤

**3 新 DDL 表**：
- `feedbacks` — UNIQUE(generation_id) + CHECK(1-5) + edit_diff TEXT
- `auto_generations` — document_id FK + card_type + generation_id FK
- `cost_summary` — PK(project_id, day) + ON CONFLICT upsert

### 验证

- pnpm -r typecheck / lint 全过
- 12 项 curl smoke 全过：
  1. register / login / create project ✅
  2. POST /generate → succeeded + generationId ✅
  3. GET /generations?limit=2 → count=1, nextCursor=null ✅
  4. POST /feedback → id + relevance=4 + overall=4 ✅
  5. GET /feedback → editDiff + comment 正确 ✅
  6. GET /cost/summary → genCount=1, range 30 天 ✅
  7. Invalid feedback rating=6 → 400 ✅
  8. Upsert feedback 覆盖 → overall=1 ✅
  9. Filter source=auto → 0 条 / source=manual → 1 条 ✅
  10. Cost summary from/to 同天 → daily_len=1 ✅
  11. Empty feedback body → 400 "至少需提供一项" ✅
  12. 跨用户 feedback → 404 "Generation 不存在" ✅

---

## 2026-05-27（会话 42 — feat-200.3 Week 3：Pipeline Orchestrator + Generations + Generate 端点）✅

### 范围

Week 3 核心：YAML 配置驱动 11-stage 编排（Pipeline Orchestrator），generations 表 + POST /generate 端点。

### 交付

**新增文件（8 个）**：
- `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.types.ts` — PipelineConfig / StageResult / PipelineTrace / GenerateRequest / GenerateResponse / GenerationRow 类型
- `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.service.ts` — 核心编排逻辑：加载 YAML → 按序调 rag-core → 错误容忍 → 累计 cost → fallback 路径
- `apps/api/src/pipeline-orchestrator/pipeline-orchestrator.module.ts` — NestJS module
- `apps/api/src/pipeline-orchestrator/pipelines/default.yaml` — 默认 11-stage 配置
- `apps/api/src/generations/generations.service.ts` — generate + list + getOne + 项目归属校验
- `apps/api/src/generations/generations.controller.ts` — 3 端点
- `apps/api/src/generations/generations.module.ts` — NestJS module
- `.interview/feat-200.3_pipeline-orchestrator-generate.md` — 6 题面试题

**修改文件**：
- `apps/api/src/db/schema.ts` — 新增 DDL_GENERATIONS（pipeline_trace JSONB / retrieved_chunks JSONB / cost_breakdown JSONB）
- `apps/api/src/app.module.ts` — 注册 GenerationsModule
- `apps/api/package.json` + `pnpm-lock.yaml` — 新增 yaml 依赖

**3 新端点**：
- `POST /projects/:projectId/generate` — 执行完整 RAG pipeline，返回 pipeline_trace + cost_breakdown
- `GET /projects/:projectId/generations` — 历史列表（最新 50 条）
- `GET /projects/:projectId/generations/:id` — 单条详情

**11-stage 编排顺序**：
context-management → query-rewrite → intent-recognition → retrieval → filter → rerank → citation → prompt-build → generation → evaluation → fallback（条件触发）

### Bug 修

1. GenerationsModule 缺 AuthModule 导入 → DI 找不到 JwtAuthGuard 的 AuthService → 添加 imports: [AuthModule]
2. FallbackOutput.fallbackAnswer 不存在 → 改用 fallbackResponse
3. RerankOutput 缺 rankChanges/method/warnings 必填字段 → 补齐 fallback 路径的假 upstream
4. EvaluationUpstream.evidencePack 需要 EvidenceItem[] 而非简单 {content, score}[] → 从 citationOutput 取

### 验证

- pnpm -r typecheck / lint 全过
- curl smoke：register → create project → POST /generate → 5 stage 成功 + retrieval error（mock key 预期） + fallback 触发 → generations 列表 1 条
- pipeline_trace 包含 5 个 stage result（3 success + 1 error + 1 fallback success），每个含 stageId / methodId / status / durationMs
- costBreakdown 结构完整（6 字段全 0，因为 mock key 没真正调 LLM）

---

## 2026-05-27（会话 41 — feat-200.2 Week 2 收尾：Documents + Ingestion + SSE 全链路打通）✅

### 范围

Week 2 主线打通：PDF/文本上传 → 异步 5-stage ingestion → SSE 推 progress 0→100。

### 交付

**新文件**
- `apps/api/src/db/schema.ts`：DDL_DOCUMENTS / DDL_INGESTION_JOBS（追加到 FEAT_200_DDL_BLOCKS）
- `apps/api/src/mvp-documents/`：types / service / controller / module / file-storage（multipart 上传 → 本地 fs + PG 元数据；list / get / delete + status 回填）
- `apps/api/src/ingestion/`：types / service / controller / job-runner / module（异步 job 表 + EventEmitter2 + @Sse 流 + 5-stage pipeline）
- `EventEmitterModule.forRoot()` 注册到 app.module

**5 个新端点**
- `POST   /projects/:projectId/documents`（multipart，category=product|compete|history）→ 立即返回 `{document, ingestionJobId}`
- `GET    /projects/:projectId/documents?category=` / `GET /projects/:projectId/documents/:docId` / `DELETE /projects/:projectId/documents/:docId`
- `GET    /projects/:projectId/ingestion`（列出近 100 job）
- `GET    /projects/:projectId/ingestion/:jobId`（轮询）
- `GET    /projects/:projectId/ingestion/:jobId/events?token=...`（SSE）

**Stage 权重映射**：idempotency 0→10，preprocess 10→35，chunk 35→45，embedding 45→85，storage 85→100。

**SSE 事件**：`snapshot`（建连即推一帧当前 job 状态）→ `progress`（每 stage 入口 + 完成两次）→ `completed` | `failed`（takeWhile inclusive=true，最后一帧后关流）+ `keepalive`（15s 心跳防代理超时）。

### 关键 bug 修复

1. **TracingInterceptor 与 SSE 冲突**：NestJS @Sse 在 interceptor 执行前已写 `Content-Type: text/event-stream` 响应头（`res.headersSent=true`）。再调 `res.setHeader("x-trace-id", ...)` 抛错 → 进 ExceptionFilter → filter 调 `res.json()` 又抛同样错 → 被 SSE 流封成 `event: error\ndata: Cannot set headers...`，客户端只收到一帧错误，看不到任何 progress。
   - 修法：`if (!res.headersSent)` 跳过 setHeader；SSE 路由短路 tap（每帧 emit 触发 access log 也无意义）；filter 加 `if (res.headersSent) return;` 兜底
2. **IngestionController TDZ**：`@CurrentUserOrQueryToken()` 装饰器在 class 内使用，但 const 声明在文件末尾。class 定义时进入 TDZ，模块加载即崩。修法：装饰器声明提到 class 之上 + 相关 imports 合并到顶部
3. **rag-core schema 漂移**：runner 用了不存在的 method id `docx-html-markdown`（应为 `markitdown`）和过期的 params 字段（`collapseWhitespace`/`appendKeywords`/`normalize` 等）。按 `packages/shared-types/src/pipeline/*` 当前 schema 修齐
4. **Dimension Guard 冲突**：MVP 用 `debug-deterministic dimension=64`，但 Playground 已往 chunks 表写过 1024 维向量。修法：dimension=1024 对齐 + storage 切到 `pgvector-replace-version`（只删本 document 旧 chunks，不全表覆盖）

### 验收（curl smoke）

```
event: snapshot   progress=10 currentStage=preprocess
event: progress   progress=35 currentStage=preprocess
event: progress   progress=35 currentStage=chunk
event: progress   progress=45 currentStage=chunk      chunksTotal=1
event: progress   progress=45 currentStage=embedding
event: progress   progress=85 currentStage=embedding  chunksDone=1
event: progress   progress=85 currentStage=storage
event: completed                                       chunksTotal=1 costUsd=0
```

终态查询：`status=succeeded, progress=100, finishedAt=...`。`pnpm -r typecheck/lint` 全过。

### 设计决策回顾

1. **Documents 新建 PG 表**：与旧 JSON store 并存，Playground 不动
2. **Job runner = 进程内 Promise + setImmediate**：重启丢任务接受（Week 8 再加 cron 兜底扫 queued 行）
3. **SSE + 轮询同时支持**：SSE 主推浏览器，`?token=` 走 query（EventSource 不能塞 header）；`GET /:jobId` 留作 curl 调试

---

## 2026-05-27（会话 40 续 — feat-200.2 Week 2 启动：Documents + Ingestion Jobs + SSE）🚧

### 范围

Week 2 主线：把 PDF/文本"上传 → 异步跑 5-stage ingestion → 实时看进度 0→100"打通。

**3 个关键设计决策**（与用户确认）：
1. Documents 新建 PG 表（与旧 JSON store 并存，Playground 不动）
2. Job runner：进程内 Promise + setImmediate 异步（PG 写状态），重启丢任务接受
3. 进度推送：SSE 主推（`/events`）+ 轮询 fallback（同 jobId GET，便于 curl 调试）

**交付计划**：
- DDL：`documents` + `ingestion_jobs` 两张表
- `apps/api/src/mvp-documents/`：项目级 documents CRUD（multipart 上传 → 写本地 fs + PG 元数据）
- `apps/api/src/ingestion/`：JobRunner + Service + Controller + SSE 端点
- 5-stage pipeline 在 JobRunner 内部串：idempotency → preprocess → chunk → embedding (debug-deterministic 免 API key) → storage（pgvector）

**Scope 红线**：
- 不改原 `/documents` JSON store 端点（Playground 仍在用）
- 不做 Week 3 generations / pipeline-orchestrator
- 不做前端 Upload UI（Week 6）

---

## 2026-05-27（会话 40 — feat-200.1 Week 1 完成：Auth + Projects + Tracing）✅

### 范围

按 8 周 MVP 排期启动 Week 1（feat-200.1）：搭建 MVP 后端骨架。

**交付清单**（12 个新文件 / 1 个修改）：

- **DB 层** `apps/api/src/db/`：
  - `schema.ts` — users / projects / project_settings 三表 DDL（FK CASCADE + 索引）
  - `db.service.ts` — `withClient(fn)` 统一 DB 入口，模块级 DDL 标记位避免重复 CREATE
  - `db.module.ts` — @Global 注册
- **Auth 模块** `apps/api/src/auth/`：
  - `auth.service.ts` — bcrypt (rounds=10) + jsonwebtoken (HS256, 7d) + register/login/findById；登录失败统一返回"邮箱或密码错误"防账户枚举
  - `jwt-auth.guard.ts` — Bearer token 解析 + 验签 + @CurrentUser 装饰器
  - `auth.controller.ts` — POST /register (201) / POST /login (200) / GET /me（JwtAuthGuard）
  - `auth.types.ts` / `auth.module.ts`
- **Projects 模块** `apps/api/src/projects/`：
  - `projects.service.ts` — list/create/get/update/delete + getSettings/updateSettings；所有方法按 owner_id 过滤，跨 owner 一律 404 防泄漏
  - `projects.controller.ts` — 9 路由全 @UseGuards(JwtAuthGuard)
- **Tracing 骨架** `apps/api/src/common/`：
  - `trace-context.service.ts` — AsyncLocalStorage 持 traceId + CostBreakdown（Week 3 起 pipeline-orchestrator 累计）
  - `tracing.interceptor.ts` — 入口生成 uuid traceId → response header x-trace-id → tap next/error 打 access log
  - `common.module.ts` — APP_INTERCEPTOR 全局注册
- **修改**：`app.module.ts` 注册 CommonModule/DbModule/AuthModule/ProjectsModule；`main.ts` Swagger 加 BearerAuth + 5 个 tag

**依赖新增**（`apps/api/package.json`）：
- `bcrypt ^6.0.0` + `@types/bcrypt` — 密码哈希
- `jsonwebtoken ^9.0.3` + `@types/jsonwebtoken` — JWT

### 验证证据

**typecheck/lint**：`pnpm -r typecheck` 4 包全过；`pnpm -r lint` 4 包全过。

**boot**：NestJS 启动，新增 9 路由全部 mapped：
```
/auth/register POST | /auth/login POST | /auth/me GET
/projects GET POST | /projects/:id GET PATCH DELETE
/projects/:id/settings GET PUT
```

**17 项 curl smoke 全过**（用 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag` + `JWT_SECRET`）：

| # | 操作 | 期望 | 实际 |
|---|------|------|------|
| 1 | register | 201 + user + token | ✅ |
| 2 | duplicate register | 409 | ✅ |
| 3 | login wrong pw | 401 | ✅ |
| 4 | login | 200 + token | ✅ |
| 5 | GET /me | 200 + user | ✅ |
| 6 | list projects (空) | `{projects:[]}` | ✅ |
| 7 | POST /projects | 201 + project | ✅ |
| 8 | list projects (1) | 1 条 | ✅ |
| 9 | GET /projects/:id | 200 | ✅ |
| 10 | PATCH name+desc | 200 + 更新后 | ✅ |
| 11 | 不存在 id | 404 | ✅ |
| 12 | GET settings 默认 | 全 null | ✅ |
| 13 | PUT settings | 200 + 字段持久化 | ✅ |
| 14 | GET 验证 | 字段已写入 | ✅ |
| 15a | user2 访问 user1 settings | 404 (防枚举) | ✅ |
| 15b | user2 PATCH user1 project | 404 | ✅ |
| 16 | DELETE → 再 GET | 204 → 404 | ✅ |
| 17 | x-trace-id header | uuid v4 | ✅ |

**DB schema 验证**（`docker exec ... psql \d`）：
- users：`id PK`, `email UNIQUE`, `idx_users_email`，被 projects FK 引用
- projects：`id PK`, `owner_id FK ON DELETE CASCADE`, `idx_projects_owner_id`, `idx_projects_updated_at DESC`
- project_settings：`project_id PK FK ON DELETE CASCADE`
- DELETE project 后 settings 同步消失（FK CASCADE 工作）

**Trace 日志样本**（验证 TracingInterceptor）：
```
[trace] a2033708-... GET /health 200 0ms
[trace] 9879cfce-... POST /auth/register 201 78ms
[trace] 2f0f5808-... PUT /projects/.../settings 200 22ms
[trace] 7249577c-... GET /projects/.../settings 404 10ms err=项目不存在
```

### 面试题

`.interview/feat-200.1_auth-projects.md`（6 题）：
1. 为什么不用 `@nestjs/passport` 而手写 JwtAuthGuard
2. 登录失败统一文案防账户枚举的原理
3. `encrypted_api_key` 用 TEXT 而非 BYTEA 的 trade-off + Week 5 AES 计划
4. AsyncLocalStorage vs NestJS REQUEST scope DI 的性能差
5. `new Client + end` per-request 何时该切到 `Pool`
6. （加分）DDL inline vs Drizzle migrations 的 trade-off + 升级触发器

### Scope Control 守住

- 没碰 pipeline / playground / packages/rag-core / apps/web
- 没做 OAuth / 密码重置 / refresh token（Phase 5）
- 没做 AES 真加密（Week 5 BYOK UI 时做）

### 下一步（Week 2 / feat-200.2）

- documents 表加 category 字段（product / compete / history 三 Tab）
- 新建 ingestion_jobs 表（status / progress / current_stage）
- 改 ingestion 走异步 job
- SSE 端点：`GET /projects/:id/ingestion/:jobId/events`
- 验收：上传 PDF 看进度 0→100

---

## 2026-05-27（会话 39 — Idea-Maker MVP 8 周细化规划 + Harness 更新）✅

### 范围

完成从"Coze-Agent 通用 Agent 平台"到"Idea-Maker 产品 MVP"的战略调整和细化规划；更新项目 harness 为 MVP 阶段做准备。

### 核心转变

1. **项目重命名**：Coze-Agent → Idea-Maker（产品定位明确）
2. **架构简化**：从"ReAct 自动循环 Agent"简化为"Pipeline Orchestrator（YAML 配置驱动 11-stage）"
   - 原因：MVP 不需要 LLM 自主决策、工具选择、迭代循环
   - 价值主张：透明可观测 + 成本追踪 + 反馈采集，足以构成 vs Coze 的差异化
   - 真 Agent 推迟到 Phase 4（3.5）配合学习闭环才有意义
3. **规划体系**：从原有的"feat-010~013 跨 Phase 混合"改为"feat-200.1~8 垂直 8 周 MVP"
   - feat-200（epic）= Idea-Maker MVP 总体
   - feat-200.1 ~ feat-200.8 = Week 1-8 的具体 milestone
   - 每周明确的验收标准

### 4 个已锁定的关键决策

1. **BYOK API Key 存储**：AES-256 加密入库，服务端 KMS/env 持有主密钥
2. **Ingestion 进度推送**：SSE（Server-Sent Events）
3. **Generate 流式化**：两阶段，Week 3-7 完整返回 + 伪动画，Week 8 加 SSE 真实事件
4. **Auth**：最简 JWT（邮箱+密码），Phase 5 换 Lucia

### Harness 更新（以 harness-creator 框架）

**新建文件**：
- `.claude/memory/mvp-plan-2026-05-27.md`：4 个决策的原理 + 对接清单

**改造文件**：
- `AGENTS.md`：加"阶段 3 MVP"章节（§ 末尾）
- `feature_list.json`：新增 feat-200 epic + feat-200.1~8（共 9 条）
- `progress.md`：本条目（2026-05-27 会话 39）

### 关键产出

**规划文档**：
- `/Users/sissi/.claude/plans/users-sissi-claude-plans-coze-agent-war-peppy-peach.md`（8 周详细计划 + 4 个确认决策）
- `.claude/memory/mvp-plan-2026-05-27.md`（决策原理 + 交接清单）

### 下一步（周 1 启动前）

- [ ] 更新 session-handoff.md，为 Week 1 做交接
- [ ] Session 40（Week 1 开工）时按新规则执行 feat-200.1

---

## 2026-05-26（会话 38 — feat-100.4 Wave 4：完整迁完 + 删 Next.js routes）✅

### 范围

把剩余 14 个 stage + snapshots + pipeline-runs 全部迁到 NestJS，删除 `apps/web/app/api/*`。
Wave 完结：所有端点都在 NestJS，apps/web 退回到"纯前端 + Playground UI"。

### NestJS 新增

- **14 个 pipeline controller**：idempotency / preprocess / transform / query-rewrite /
  intent-recognition / multi-recall-merge / filter / rerank / storage / citation /
  fallback / context-management / prompt-build / evaluation
- **2 个新模块**：
  - `SnapshotsModule`：`SnapshotsService` 封 DDL + CRUD（含 DDL 初始化、upsert 快照、列 / 取单条）
  - `SnapshotsController` + `PipelineRunsController`：共 5 端点
- **DocStoreService 扩展**：加 `get(id)` / `getBuffer(doc)` 给 idempotency / preprocess
- **PipelineModule**：注册全部 18 个 stage controller；export ProvidersService 给 SnapshotsModule
- **DocumentsModule**：export DocStoreService 给 PipelineModule

### apps/web 清理

- `app/api/*` 整个目录删除（含 18 stage routes + documents x3 + snapshots x2 + pipeline-runs x2）
- `lib/providers.ts` 删除
- `lib/snapshotDb.ts` 删除
- `lib/docStore.ts` 缩成 28 行的类型存根（只保留 `DocumentRecord` 类型给 components 用）
- `lib/api-base.ts` 取消白名单：`pipelineUrl()` / `documentsUrl()` / `snapshotsUrl()` /
  `pipelineRunsUrl()` 全部走 NestJS

### 路由总数

NestJS 25 路径（Swagger `/docs` 可见）：
- `/health` x1
- `/pipeline/{idempotency,preprocess,chunk,transform,embedding,storage,query-rewrite,intent-recognition,retrieval,multi-recall-merge,filter,rerank,citation,fallback,context-management,prompt-build,generation,evaluation}` x18
- `/documents` + `/documents/{id}` x2
- `/snapshots` + `/snapshots/{stageId}` x2
- `/pipeline-runs` + `/pipeline-runs/{id}` x2

### 验收

- `pnpm -r typecheck/lint` 全过；rag-core 238/238 单测
- NestJS smoke：health 200 / Swagger 25 路径 / preprocess 读真实文档 cleanText / idempotency
  正确算 sha256 命中 PRODUCT.md v9 / filter 空 upstream 400 / pipeline-runs 无 DB 400
- 跨进程文件共享验证：apps/api 通过共用 `apps/web/data/documents.json` 看到 17 个文档

### 下一步

feat-100 epic 完整收尾。开始 feat-010 起的业务 feature（Phase 3 Agent / Phase 4 Studio）。

---

## 2026-05-26（会话 37 — feat-100.3 Wave 3：NestJS 后端启动 + 5 端点双跑）✅

### 范围

完整搭起 `apps/api` NestJS 后端，把 5 个最关键端点迁过去，apps/web 通过 feature flag 切换。

### 关键交付

- **NestJS 基建** (`apps/api`):
  - `src/main.ts`: ValidationPipe + CORS + PipelineExceptionFilter + Swagger UI (`/docs`)
  - `src/common/pipeline-exception.filter.ts`: 统一翻译 `PipelineError` / `ZodError` / `HttpException`，沿用 feat-100.2 的 status code 表
  - `src/pipeline/providers.service.ts`: I/O 客户端 DI 工厂（LLM / Embedding / pg / TEI 端点），复刻 apps/web/lib/providers.ts 的 env 优先级
  - 4 个 Controller：`ChunkController` / `EmbeddingController` / `RetrievalController` / `GenerationController`
  - `DocumentsModule`: `DocStoreService` 复刻 docStore.ts；通过 `DOCUMENTS_DATA_FILE` env 与 apps/web 共用同一份 `apps/web/data/documents.json`，双跑期数据零分裂
- **apps/web 切换层** (`lib/api-base.ts`):
  - `pipelineUrl(stageId)` / `documentsUrl(suffix)` 两个 helper
  - `NEXT_PUBLIC_USE_NEST_API=true` + `NEXT_PUBLIC_API_URL=http://localhost:3001` 一键切换
  - 默认不开启，对未迁移端点 (snapshots / pipeline-runs / 其他 14 stage) 完全透明
  - PlaygroundShell + DocumentUploadPanel 共 5 处 fetch 替换
- **关键依赖切换**：tsx 不支持 `emitDecoratorMetadata`（esbuild 限制），NestJS DI 会全部失效。改用 `ts-node-dev --transpile-only --respawn` 作为 dev runner

### 验收

- `pnpm -r typecheck` 全过；`pnpm -r lint` 全过；rag-core 238/238 单测
- NestJS 自测：`/health` 200 / `/docs` 200 / `/pipeline/chunk` 正确分块 / `/documents` 列表 17 / `DELETE` missing → 404 not_found / ZodError → 400 invalid_params
- Swagger UI 列出 7 个端点：`/health`, `/pipeline/{chunk,embedding,retrieval,generation}`, `/documents`, `/documents/{id}`

### 下一步

- feat-100.4 Wave 4：剩余 14 个 stage 端点迁完 + 删 `apps/web/app/api/*` + CI 多服务构建

---

## 2026-05-26（会话 33-36 综合 — feat-100.2 完整收尾，18/18 ✅）

### 🎉 feat-100.2 全部 18 stage 抽取完成

retrieval pipeline 之王 + generation 链 3 + evaluation 1，五个连续提交一鼓作气：

#### 5 个收尾 commit

| Stage | 复杂度 | 注入 | 单测 |
|---|---|---|---|
| retrieval | 最高（574 行） | **三重**：pg + OpenAI/Embed + TEI | 15 |
| context-management | 中 | LLMChatClient | 10 |
| prompt-build | 低（纯算法） | — | 12 |
| generation | 高（4 LLM method） | LLMChatClient + defaultModel | 14 |
| evaluation | 中（含 LLM judge） | LLMChatClient（optional，缺则降级） | 16 |

#### feat-100.2 全景

- **Ingestion 6/6**：idempotency / preprocess / chunk / transform / embedding / storage
- **Retrieval 8/8**：query-rewrite / intent-recognition / retrieval / multi-recall-merge / filter / rerank / citation / fallback
- **Generation 3/3**：context-management / prompt-build / generation
- **Evaluation 1/1**：evaluation

#### 三类 client 契约（shared-types 零外部依赖）

```ts
OpenAICompatibleClient  // embeddings.create
LLMChatClient            // chat.completions.create + usage
PgClient                 // query<T>(sql, params)
```

#### 7 种 idiom

1. upstreamQuery 跨 stage 字段提取（intent / rerank / citation 等）
2. 双 provider 注入（rerank：tei + llm）
3. 三重 client 注入（retrieval：pg + openai + tei）
4. missing 降级 vs missing 失败（fallback/evaluation 降级；其他抛 PipelineError）
5. per-chunk 失败收集（rerank llm-relevance 单 chunk 失败不中断）
6. 预定义 canonical types（chunk → retrieval/MatchedChunk → rerank/RankedChunk）
7. evidencePack 跨 stage 透传（citation → prompt-build → generation → evaluation）

#### 累计单测

238/238 ✅（idempotency 12 + preprocess 10 + transform 11 + chunk 14 + embedding 15 + storage 19 + query-rewrite 12 + intent-recognition 11 + multi-recall-merge 10 + filter 13 + citation 17 + fallback 10 + rerank 17 + retrieval 15 + context-management 10 + prompt-build 12 + generation 14 + evaluation 16 + smoke 1）

#### 路由减幅

整个 pipeline 18 个 route 从合计 ~6500 行（含逻辑）→ ~1500 行薄路由（仅参数 + I/O + 错误翻译）。算法 + schema 全在 packages/{rag-core,shared-types}。

### 下一步

- feat-100.3 Wave 3：NestJS 后端 + 5 端点迁移 + 双跑期（USE_NEST_API flag）
- feat-100.4 Wave 4：剩余端点全迁完 + 删 apps/web/app/api/* + 部署架构调整

完成 feat-100 epic（Wave 1-4 全部）后，主流程业务 feature（feat-010 Pipeline Agent / feat-011 Content Agent / feat-012 Marketing Studio / feat-013 工程化）才正式启动。

---

## 2026-05-26（会话 29-32 综合 — feat-100.2 推进：retrieval 链推进至 7/8，13/18）

### 已完成（5 个 stage 抽取）

retrieval 链快速推进。沿用 ingestion 链定下的提取模式 + I/O 注入模式，新增 5 种 idiom：

1. **upstreamQuery 跨 stage 字段提取**：intent-recognition / rerank / citation Input 含可选 `upstreamQuery`，路由层从 `body.upstreamOutput.originalQuery` 提取注入
2. **双 provider 注入**：rerank 同时声明 `hfTeiEndpoint` + `llmClient`，按 methodId 决定使用哪个
3. **可选注入的 "missing 降级" vs "missing 失败"语义**：fallback 的 generic-response 缺 llmClient → 优雅降级到拒答 + warning（不抛错）；其他 stage 缺 client → 抛 PipelineError(missing_client)
4. **per-chunk 失败收集**：rerank llm-relevance 单 chunk LLM 调用失败时降为原始分数 + warning，不中断其他 chunk
5. **预定义 canonical types 模式**：chunk → Chunk → retrieval/MatchedChunk → rerank/RankedChunk。下游 stage 抽取时通过 import + alias 重用，避免重复定义

#### 变更明细

| Stage | 测 | 路由减幅 | 注入 |
|---|---|---|---|
| 9. multi-recall-merge | 10 | 170→65 | — |
| 10. filter | 13 | 350→60 | — |
| 11. citation | 17 | 424→110 | pg.Client（section-citation） |
| 12. fallback | 10 | 188→75 | LLMChatClient（generic，optional） |
| 13. rerank | 17 | 384→92 | hfTeiEndpoint + LLMChatClient |

shared-types 新增：multi-recall-merge / filter / citation / fallback / rerank + retrieval 预定义 canonical types

rag-core 新增：retrieval/multi-recall-merge / filter / citation / fallback / rerank

apps/web 薄路由：5 个 route 全部改薄，行为零回归

#### 验收

- pnpm test：累计 172/172（idempotency 12 + preprocess 10 + transform 11 + chunk 14 + embedding 15 + storage 19 + query-rewrite 12 + intent-recognition 11 + multi-recall-merge 10 + filter 13 + citation 17 + fallback 10 + rerank 17 + smoke 1）
- pnpm -r typecheck/lint：4 包全过

#### 下一步

剩 5 stage：retrieval（574 行，pipeline 之王，pg + OpenAI/TEI 三重注入，最复杂）+ generation 链 3（context-management / prompt-build / generation）+ evaluation 1。

---

## 2026-05-26（会话 28 — feat-100.2 推进：intent-recognition，8/18）

### 已完成（intent-recognition stage 抽取）

复用 query-rewrite 定下的 LLMChatClient 注入模式。**首例 upstreamOutput 跨 stage 取字段（query）**——shared-types Input 加 `upstreamQuery` 可选字段，路由层从 `body.upstreamOutput?.query` 提取注入。

#### 变更

- **shared-types**：新建 `pipeline/intent-recognition.ts`（IntentValue enum 4 类 + IntentRecognitionMethodId 2 method + Input 含 upstreamQuery / llmClient + Output/Trace）
- **rag-core**：新建 `retrieval/intent-recognition.ts` runIntentRecognition：
  - rule-based：3 组正则（marketing / chitchat / out-of-scope）+ 默认 knowledge-qa
  - llm-router：JSON mode + intent 白名单 + confidence clamp
  - upstreamQuery 优先于 params.query
- **apps/web 薄路由**：intent-recognition/route.ts 200 → 67 行；上游 `{ query?: string }` 类型化注入
- **单测**：10 个新测覆盖 rule-based 4 类意图 + upstreamQuery 优先级 / LLM mock（正常 / 未知 intent 回退 / 非 JSON 回退 / confidence clamp / missing_client）

#### 验收

- pnpm test：105/105
- pnpm -r typecheck/lint：4 包全过

#### 下一步

继续 retrieval 链 6 个。建议批量推进 4 个纯算法 stage（multi-recall-merge / filter / citation / fallback 的 rule 部分），然后 rerank + retrieval 收尾。

---

## 2026-05-26（会话 27 — feat-100.2 推进：query-rewrite，retrieval 链启动，7/18）

### 已完成（query-rewrite stage 抽取）

retrieval 链 8 stage 第一站。`LLMChatClient` 接口确立，与 embedding 的 `OpenAICompatibleClient` 分离——每个 stage 显式声明用 chat 还是 embeddings API。

#### 变更

- **shared-types**：新建 `pipeline/query-rewrite.ts`（QueryRewriteMethodId 3 method + zod ParamsSchema 8 字段 + Input 含 llmClient + Output/Trace + `LLMChatClient` 最小契约）
- **rag-core retrieval/**：新目录，存放检索链 stage
- **rag-core**：新建 `retrieval/query-rewrite.ts` runQueryRewrite async：
  - none 透传
  - rule-keyword-expansion：jieba 分词 + 4 种角度模板（关键词/功能/受众/原query）
  - llm-marketing-rewrite：注入 LLMChatClient，OpenAI chat 生成 JSON 数组变体
- **apps/web 薄路由**：query-rewrite/route.ts 259 → 65 行
- **单测**：12 个新测覆盖 none / rule（中文/英文/停用词/maxQueries/受众注入）/ LLM mock client（正常/非JSON回退/不含原query插入/prompt 注入/missing_client）

#### 验收

- pnpm test：94/94（idempotency 12 + preprocess 10 + transform 11 + chunk 14 + embedding 15 + storage 19 + query-rewrite 12 + smoke 1）
- pnpm -r typecheck/lint：4 包全过

#### 下一步

继续 retrieval 链 7 个 stage。建议节奏：
1. intent-recognition（200 行，LLM 注入，复用 query-rewrite 模式）
2. multi-recall-merge / filter / citation / fallback（4 个纯算法或半纯算法，可批量推进）
3. rerank（384 行，TEI + OpenAI 双 provider）
4. retrieval（574 行，**pg + OpenAI 双重注入**，最复杂）

---

## 2026-05-26（会话 26 — feat-100.2 推进：storage 抽取，ingestion 链收尾，6/18）

### 已完成（storage stage 抽取）

ingestion 链 6 个 stage 全部抽完。storage 是注入 pg.Client 的第一例，沿用 embedding 定下的 I/O 注入模式：
- shared-types 定义 `PgClient` 最小接口（仅 query 方法），不引 pg dep
- 路由层 `new Client + await connect()` 后注入到 rag-core，`finally end()` 管理 lifecycle
- rag-core 不读 env、不管连接生命周期

#### 变更

- **shared-types**：新建 `pipeline/storage.ts`（StorageMethodId 3 method enum + StorageConflictPolicy/IndexMode enum + zod ParamsSchema + Input 含 pgClient + Output/Trace + `PgClient` 最小契约）
- **rag-core**：新建 `ingestion/storage.ts` runStorage async 函数：
  - DDL 自动初始化 rag_documents + rag_chunks 表
  - Dimension Guard 检查表内现有维度
  - truncateTable 选项（TRUNCATE + DROP INDEX + ALTER COLUMN TYPE vector）
  - 3 method 各自决定 version（upsert / new+1 / replace）
  - HNSW / IVFFlat / none 三种索引模式
- **apps/web 薄路由**：storage/route.ts 450 → 128 行
  - 路由层负责 connectionString 解析（params / DATABASE_URL）
  - new Client + connect + try { runStorage } finally { end() }
  - pg 错误码（ECONNREFUSED/23505/28P01/3D000）→ HTTP status 映射保留
- **单测**：19 个新单测，全部 mock PgClient（vi.fn 即可）覆盖：3 method 的 version 决定 / Dimension Guard 3 种情况 / truncateTable 全套副作用 / 3 种 indexMode + 索引已存在 skip / 错误路径（missing_client / empty_chunks / dim_mismatch + details） / INSERT 语句生成（ON CONFLICT 是否存在 / enhancedText fallback）

#### 验收

- pnpm test：82/82（idempotency 12 + preprocess 10 + transform 11 + chunk 14 + embedding 15 + storage 19 + smoke 1）
- pnpm -r typecheck/lint：4 包全过

#### 下一步

ingestion 链全完成 ✅。下一段进 retrieval 链 8 个 stage（query-rewrite → intent-recognition → retrieval → multi-recall-merge → filter → rerank → citation → fallback）。retrieval 自身要同时注入 pg.Client（查向量）+ OpenAI client（embed query）+ TEI URL，是双重注入第一例。

---

## 2026-05-26（会话 25 — feat-100.2 推进：embedding + I/O 注入模式确立，5/18）

### 已完成（embedding stage 抽取）

第一个有真实外部 I/O 的 stage。**I/O 注入模式**经此次定型，后续 stage 复用：
- shared-types 定义 `OpenAICompatibleClient` 结构契约（不直接 import openai，零依赖原则）
- 路由层 `apps/web/lib/providers.ts` 创建 client + 读 env，通过 Input 字段注入 rag-core
- rag-core 不读 env、不 new OpenAI，纯靠 Input 工作
- 每个 provider 在 runtime 校验所需注入，缺则 throw PipelineError(missing_client / missing_endpoint)

#### 变更

- **shared-types**：新建 `pipeline/embedding.ts`（EmbeddingMethodId enum 4 provider + zod ParamsSchema 6 字段 + Input 含 openaiClient/hfTeiEndpoint + Output/Trace + `OpenAICompatibleClient` 结构契约）
- **rag-core util**：新建 `util/openai-embed.ts`（embedBatch/embedSingleText 纯函数，从 apps/web/lib/providers.ts 迁移）
- **rag-core 算法**：新建 `ingestion/embedding.ts` runEmbedding async 函数，4 provider 全保留：
  - debug-deterministic（FNV-1a 哈希）
  - openai-3-small（用注入的 client）
  - hf-tei-embedding（fetch 调 endpoint）
  - hf-transformers-js-embedding（dynamic import 本地推理）
- **apps/web 薄路由**：embedding/route.ts 383 → 102 行，含 PipelineError → HTTP status 的细粒度映射
- **apps/web providers.ts**：embedBatch/embedSingleText 改 re-export 自 rag-core；createEmbeddingClient 留下（仍读 env 创建 client）
- **依赖迁移**：openai + @huggingface/transformers 从 apps/web 转 rag-core（openai 在 apps/web 也保留，因为 providers.ts 直接用）
- **单测**：15 个新测覆盖 debug-deterministic 确定性 + 单位向量 / openai mock client + sort 修复 + missing_client / hf-tei mock fetch + 端点优先级 + 错误码 / empty_chunks / trace 字段

#### 验收

- pnpm test：63/63（12+10+11+14+15+1）
- pnpm -r typecheck/lint：4 包全过

#### 下一步

ingestion 收尾还差 storage（450 行，pgvector，3 method，注入 pg.Pool 实例的第一例）。完成后 ingestion 链全 done。

---

## 2026-05-26（会话 24 — feat-100.2 推进：chunk，RAG 最核心 stage，4/18）

### 已完成（chunk stage 抽取）

抽取 RAG pipeline 最核心的 chunk stage。4 种 method、复杂递归算法、跨 stage Chunk 类型统一。

#### 变更

- **shared-types**：新建 `pipeline/chunk.ts`（ChunkMethodId enum 4 method + zod ParamsSchema 5 字段 + Input/Output/Trace 接口 + **canonical `Chunk` 类型**）
- **类型统一**：`transform.ts` 把 `TransformInputChunk` 改为 `type TransformInputChunk = Chunk`，整个 pipeline 共用同一份 Chunk 定义
- **rag-core**：新建 `ingestion/chunk.ts`（350 行）实现 runChunk 同步纯函数：
  - fixed-size：滑动窗口 + overlap 安全下调
  - recursive：LangChain RecursiveCharacterTextSplitter 移植 + 中文优先 separators
  - markdown-heading：标题边界 + 超长章节 fixed-size 降级
  - markdown-heading-recursive：标题边界 + 超长章节 recursive 语义降级（hierarchical chunking）
- **apps/web 薄路由**：chunk/route.ts 535 → 69 行（减 87%）
- **单测**：14 个新测覆盖 4 method 主路径 + overlap 边界 + 章节降级 + sourceRef 绑定 + PipelineError 错误码

#### 验收

- pnpm test：48/48 全过（12+10+11+1+14）
- pnpm -r typecheck/lint：4 包全过

#### 下一步

ingestion 收尾还差 embedding + storage 两个，都涉及外部 I/O（OpenAI client / pgvector pg client）注入。先做 embedding（4 provider，I/O 注入第一例），再做 storage。完成后 ingestion 链就全 done。

---

## 2026-05-26（会话 23 — feat-100.2 推进：transform + nlp 工具迁移，3/18）

### 已完成

3 个 stage 完成。本次顺手把 6 个 route 共用的 `nlp.ts` 工具迁到 rag-core（杠杆操作：避免后续每个 stage 都重复处理 nlp 依赖）。

#### 变更

- **nlp.ts 迁移**：`apps/web/lib/nlp.ts`（153 行）→ `packages/rag-core/src/util/nlp.ts`。`@node-rs/jieba` 依赖随之转 rag-core。原 apps/web/lib/ 删除该文件
- **6 个 route imports 批量更新**：transform / citation / query-rewrite / retrieval / rerank / filter 全部把 `from "@/lib/nlp"` 改为 `from "@harness/rag-core"`（sed 一把完成，零行为改动）
- **rag-core export**：index.ts 新增 jieba / tokenize / tokenizeToSet / tokenizeForBM25 / extractKeywords
- **shared-types**：新建 `pipeline/transform.ts`（TransformMethodId enum + zod schema + InputChunk/Transformed/Trace 接口）
- **rag-core**：新建 `ingestion/transform.ts`（runTransform 同步纯函数，3 method 全保留）
- **apps/web 薄路由**：transform/route.ts 283 → 67 行
- **单测**：11 个新单测覆盖 none 透传 / heading-context 4 路径（标题+sourceRef / 单独 sourceRef / 单独 title / 去重 / 全空 warning）/ summary-keywords 2 路径（appendToChunk 真假）/ trace 字段

#### 验收

- pnpm test：34/34（12 idempotency + 10 preprocess + 11 transform + 1 smoke）
- pnpm -r typecheck/lint：4 包全过

#### 下一步

ingestion 链剩 chunk / embedding / storage 三个。chunk 是 RAG 最核心 stage，面试价值高。embedding/storage 含外部 I/O（OpenAI / pgvector），是注入模式的真正考验。

---

## 2026-05-26（会话 22 — feat-100.2 推进：preprocess 抽取，2/18）

### 已完成（preprocess stage 抽取）

按 idempotency 样板复制模式，第二个 stage 完成。preprocess 比 idempotency 复杂：5 method（其中 3 个 async）、4 个第三方库（pdf-parse / mammoth / turndown / is-html）、1 个外部微服务（pymupdf）。

#### 变更

- **依赖迁移**：`pdf-parse / mammoth / turndown / is-html` + `@types/pdf-parse / @types/turndown` 从 apps/web 迁到 packages/rag-core（grep 确认这些 lib 只在 preprocess 用过）
- **shared-types**：新建 `pipeline/preprocess.ts`，PreprocessMethodId enum（5 方法）+ zod ParamsSchema（7 个参数含默认值）+ Input/Output/Trace 接口。`pymupdfServiceUrl` 作为 Input 字段（路由层注入 env，rag-core 不读 env）
- **rag-core**：新建 `ingestion/preprocess.ts`，导出 `runPreprocess(input): Promise<PreprocessResult>`。5 method 完整搬过去，全部 fallback warnings 文案保留。pymupdf service URL 改为 Input 注入
- **apps/web 薄路由**：原 520 行 route.ts 改为 78 行（仅参数解析 + 加载 doc + buffer + 注入 pymupdfServiceUrl + 错误翻译）
- **单测**：10 个新单测（markdown-structure 标题 path / 清洗 / maxChars 截断 + plain-text 空行过滤 / removeBoilerplate + pdf-pages 非 PDF 降级 + pymupdf 连接拒绝降级 + metadata fileName 注入）

#### 验收

- `pnpm --filter @harness/rag-core test`：23/23（含 idempotency 12 + smoke 1 + preprocess 10）
- `pnpm -r typecheck/lint`：4 包全绿
- Playground 端到端（dev server 实测）：markdown-structure（39 标题 / 332 sourceRefs / 6ms）、plain-text（0 标题 / 2ms）、markitdown（路由到 MD 解析，4ms），与抽取前完全一致

#### 下一步

按 ingestion 完整组继续：transform → chunk → embedding → storage（4 个剩余 stage）。每个 stage 一个 PR。

---

## 2026-05-26（会话 21 — feat-100.2 启动：rag-core 基础设施 + idempotency 样板）

### 已完成（feat-100.2 in-progress，1/18 stage）

阶段 2.5 架构重构 Wave 2 启动。打造 rag-core 抽取的工具链 + 完成 idempotency 作为后续 17 个 stage 复制的样板。

#### 基础设施

- `packages/rag-core/vitest.config.ts`：vitest 配置（node 环境，匹配 `__tests__/*.test.ts`）
- `packages/rag-core/src/errors.ts`：`PipelineError(code, message, details?)` 统一错误类型 + `isPipelineError` 类型守卫。设计：rag-core 不感知 HTTP，路由层翻译 code → status
- `packages/shared-types/src/pipeline/idempotency.ts`：zod schema（`IdempotencyMethodId` enum、`IdempotencyParamsSchema` 带默认值）+ Input/Output/Trace/Result TypeScript 接口
- `packages/shared-types` 加 zod ^3.23.8 依赖
- `packages/rag-core/README.md`：「提取模式」文档，定义 5 条规则（函数签名、I/O 注入、错误处理、路由层职责、测试）
- 根 `package.json` 加 `test: pnpm -r test` 脚本

#### Idempotency 样板抽取

- `packages/rag-core/src/ingestion/idempotency.ts`：`checkIdempotency(input): IdempotencyResult` 纯函数。三种 hash 方法（sha256-content / normalized-sha256 / file-signature）+ versionPolicy（new-version / skip-existing / replace-existing）+ includeFileName 全部保留语义
- `apps/web/app/api/pipeline/idempotency/route.ts`：改为薄路由（解析请求 → 加载 targetDoc/otherDocs → 调 checkIdempotency → 包装 durationMs + 错误翻译）
- `packages/rag-core/src/ingestion/__tests__/idempotency.test.ts`：13 个单测（3 method 主路径 + versionPolicy 三态 + includeFileName 边界 + PipelineError 错误路径）

#### 关键修复：next.config.ts transpilePackages

**事故**：第一次 `pnpm dev` 启动后机器假死，需强制重启。

**根因**：apps/web 通过 pnpm symlink 引用 `@harness/rag-core`（TS 源码）。Next.js 默认不编译 node_modules 内的 TS。Turbopack 反复尝试解析未编译的 `.ts` → 子进程 spawn 风暴（pgrep 看到大量 postcss.js workers）→ 内存暴涨 → 系统假死。

**修复**：`apps/web/next.config.ts` 加 `transpilePackages: ["@harness/rag-core", "@harness/shared-types"]` + `outputFileTracingRoot`。修复后内存稳定 765MB / postcss 子进程 1 个。

**约定**：feat-100.2 起每新增一个 workspace 包，必须在 `transpilePackages` 登记，写入 next.config.ts 注释。

#### 验收

- `pnpm --filter @harness/rag-core test`：13/13 全过
- `pnpm -r typecheck`：4 包全过
- Playground 端到端：3 种 method 测试，trace 字段完整，POST /api/pipeline/idempotency 200 / 16ms，与抽取前完全一致

#### 下一步

复制 idempotency 模式到剩余 17 个 stage。建议批次：
1. **简单同步类**（hash/字符串处理）：preprocess（5种 parser）、transform（heading-context / summary-keywords）
2. **算法类**：chunk（3 method）、filter（mmr-diversity）、citation（snippet 截取）
3. **I/O 重类**（注入 client）：embedding（4 provider）、retrieval（pg+vec）、storage（pg）、rerank（HF/LLM）、generation（LLM）、evaluation
4. **新步骤**：query-rewrite、intent-recognition、context-management、multi-recall-merge、fallback、prompt-build

每个 stage 单独提一个 sub-PR（小步快跑、易回滚）。冻结窗口持续到全部完成。

---

## 2026-05-25（会话 20 — feat-100.1 完成：pnpm monorepo 骨架）

### 已完成

阶段 2.5 架构重构 Wave 1 落地。把 Next.js 单体改造为 pnpm workspace 骨架，不动算法、不删功能、保持端到端 pipeline 可用。

#### 变更

- 根新增：`pnpm-workspace.yaml`、`package.json`（workspace 级 scripts：dev / build / typecheck / lint / check:harness）、`.npmrc`（禁 hoist）
- 迁移：`git mv app apps/web`（保留全部文件历史）；删除 `apps/web/package-lock.json`（切 pnpm 用 pnpm-lock.yaml）；`apps/web/package.json` name `app` → `@harness/web`
- 新建 `apps/api/`（NestJS 最小骨架）：`package.json` (@harness/api) / `tsconfig.json` / `nest-cli.json` / `eslint.config.mjs` / `src/main.ts` / `src/app.module.ts` / `src/health.controller.ts`（GET /health 占位端点）
- 新建 `packages/rag-core/` 和 `packages/shared-types/`：各自 `package.json` / `tsconfig.json` / `src/index.ts`（仅 VERSION 常量占位，feat-100.2 起填实）
- `init.sh`：app/ npm 路径替换为 pnpm-workspace 路径，运行 `pnpm -r typecheck && pnpm -r lint`

#### 验收

- `pnpm install` 通过（13 分钟，含 NestJS + Sharp + onnxruntime 等原生模块）
- `pnpm -r typecheck`：4 个工作区包全过（apps/web / apps/api / packages/rag-core / packages/shared-types）
- `pnpm -r lint`：4 个包全过
- `pnpm dev` 启 web，浏览器 GET / → 200 OK，Next.js 16.2.6 Turbopack 411ms ready
- API 烟测：GET /api/documents 返回历史文档列表（包含 PRODUCT.md v10）；POST /api/pipeline/idempotency 返回正确 error envelope `{error:{code:"missing_document"...}}`
- `bash init.sh` 整体跑通，仅 session-handoff HEAD 滞后属预期

#### 下一步

feat-100.2 Wave 2：抽 `packages/rag-core` 纯库（把 ingestion / retrieval / generation 各 stage 的非 HTTP 部分从 `apps/web/app/api/pipeline/*/route.ts` 抽到 `packages/rag-core/src/`）。预计 1-2 周。**此阶段为冻结窗口起点**，需提前通知轨道 B 实验流仅调参不动算法核心代码。

#### ⚠️ 轨道 B 同步提醒（重要）

commit `83dfcbd` 已 fast-forward 合入 main。轨道 B（RAG 实验流）下次从 main rebase 时会面临 **`app/` → `apps/web/` 全量路径改动**——所有实验流分支上引用 `app/...` 的文件路径需手动改成 `apps/web/...`。建议轨道 B 在尽早完成一次 rebase（git mv 已保历史，`git log --follow` 仍可追溯），晚拖问题越大。

---

## 2026-05-25（会话 19 — Feature 编号约定调整：100+ 段位 = 架构/基础设施）

### 已完成

针对会话 17/18 引入的 feat-100~103（架构重构 4 个 Wave）平铺编号方式，回顾后调整为更符合现有惯例的结构：

#### 调整内容

1. **feat-100~103（平铺 4 项）→ feat-100 epic + feat-100.1~100.4**
   - 与现有 feat-002 / 003 / 004 / 010 / 011 / 012 / 013 的 epic + 子项模式一致
   - feat-010 dependencies 中的 `feat-103` 同步改为 `feat-100.4`
   - feature 总数从 50 → 51（新增 feat-100 epic）

2. **新引入「100+ 段位约定」**
   - **001~099 段位**：业务功能 feature，按时间顺序连续编号
   - **100+ 段位**：架构 / 基础设施 / 跨阶段重构类 feature
   - 写入 AGENTS.md「Feature 编号约定」段
   - 解决「编号顺序 vs 执行顺序反差」问题（如 feat-100 注册在 feat-013 之后，但实际执行在 feat-010 之前）
   - 后续如再有大型架构调整（迁框架、引入消息队列等），用 feat-101 / 102 ... 继续

#### 变更

- `feature_list.json`：feat-100 重组为 epic + 4 子项；feat-010 deps 同步更新
- `AGENTS.md`：新增「Feature 编号约定」小节；轨道并行段所有 feat-101/102/103 引用改为 feat-100.x
- `docs/ROADMAP_PHASE2_PLUS.md`：总览图 / Wave 章节标题 / 排期表 / 双轨并行图 / 同步规则 / 分支约定全部更新
- 一致性检查通过：51 features，0 issues

### 当前状态

- 仍在工作树：`claude/plan-agent-roadmap`，干净。
- 仅文档变更，无代码改动。
- 编号体系更清晰：业务 feature 在 001~099 连续编号；架构重构在 100+ 段位独立编号；执行顺序由 dependencies 决定，与编号顺序解耦。

---

## 2026-05-25（会话 18 — 双轨并行执行模型）

### 已完成

引入**双轨并行执行模型**，把 RAG 实验调优与主流程开发拆为两条独立轨道：

- **轨道 A 主流程**：架构重构 + Agent + Studio + 工程化（feat-100~103, feat-010~013）—— 在一个 session/worktree 推进
- **轨道 B RAG 实验**：feat-006/008 收尾 + 持续算法实验 —— 用户在另一个 session 推进

#### 关键决策

1. **实验代码合入策略：选择性合入**
   - 实验默认只产 `scripts/eval-matrix/results/run-XXX/` 报告
   - 确认指标提升（hitRate / citationCoverage / confidenceScore 不退化）的算法/参数改动才单独提小 PR 合入 main
2. **Wave 2 冻结窗口**
   - 主流程做 Wave 2（feat-101 抽 rag-core）期间约定 1-2 周
   - 实验流仅调参（chunk size / threshold / topK / 新 query 组合），不动算法核心代码
3. **分支约定**
   - main 唯一合并入口
   - 主流程：`claude/refactor-monorepo` 或类似
   - 实验流：`claude/experiments/<topic>`
4. **Feature 编号约定**
   - 实验流：feat-006.x / feat-008.x / feat-009.x
   - 主流程：feat-010~013 + feat-100+

#### 变更

- 更新 `AGENTS.md` 工作规则：新增双轨并行约定（轨道分工、Wave 2 冻结、rebase 节奏、编号约定）
- 新增 `docs/ROADMAP_PHASE2_PLUS.md` 末尾「双轨并行执行模型」章节（背景 / 模型图 / 同步规则 / 分支约定 / 编号约定 / 风险与缓解 / 同步触发点 / 实验流默认工作流）
- 同步 progress.md 和 session-handoff.md

### 当前状态

- 工作树：`claude/plan-agent-roadmap`，干净。
- 仅文档变更，无代码改动。
- 下一步：用户可在另一个 session 开启实验流分支（建议从 feat-006 / feat-008 收尾开始）；主流程可在当前 worktree 或新开 worktree 启动 feat-100。

---

## 2026-05-25（会话 17 — 架构重构作为阶段 2.5 插入）

### 已完成

本会话基于会话 16 的路线图，新增**阶段 2.5：架构重构**作为基座升级，先于阶段 3 执行。

#### 三个关键架构决策

1. **RAG 作为独立模块** → 抽到 `packages/rag-core` 纯 TS 库（无 HTTP/framework 依赖，可独立单测）
2. **前后端分离** → 独立 NestJS 后端（`apps/api`）+ Next.js 前端（`apps/web`），通过 REST + 共享 zod schema 通信
3. **Playground 降级为调试 UI** → 与 Marketing Studio 并列存在于 `apps/web/app/(playground)/` 路由组

#### 技术选型

- Monorepo 工具：**pnpm workspaces**
- 后端框架：**NestJS**（Module/Controller/Service 强分层 + 内置 DI + Swagger）
- 共享类型：**zod schema + 推导**（一份 schema 同时做后端校验/前端表单/TS 类型）
- 渐进迁移：**4 个 Wave** + 双跑期 + feature flag，避免一次性重写

#### 变更

- 更新 `docs/PRODUCT.md`：在阶段 2 和阶段 3 之间插入阶段 2.5 架构重构章节。
- 扩展 `feature_list.json`：新增 4 条 feature（feat-100~103，4 个 Wave）。
- 更新 `feature_list.json` 中 feat-010 / 011 / 012 / 013 系列的 description 和 dependencies，引用新架构路径（apps/api/src/, apps/web/, packages/rag-core/）。feat-010 dependencies 加入 feat-103。
- 大幅更新 `docs/ROADMAP_PHASE2_PLUS.md`：
  - 新增阶段 2.5 完整章节（目标结构图 / 技术选型 / 4 个 Wave 详细步骤 / 验收标准 / 简历亮点）
  - 修订阶段 3-5 所有关键文件路径，从 `app/lib/*` `app/components/*` `app/app/api/*` 改为 `apps/api/src/*` `apps/web/components/*` `packages/rag-core/src/*`
  - 更新排期估算：合计从 4 个月调整为 5-6 个月
- 关键架构调整：阶段 3 Pipeline Agent 从「客户端循环」改为「服务端 NestJS Service + SSE」（NestJS 后端无 serverless 超时限制）。

### 当前状态

- 仍在工作树：`claude/plan-agent-roadmap`，已 rebase 到 main 最新（含 section-citation + experiment-4 数据）。
- 仅文档变更，无代码改动。
- 下一步：先收尾阶段 2（feat-006 + feat-008），再启动 feat-100 monorepo 骨架。

### Harness 一致性检查（会话 17 末）

执行了系统性一致性检查，已修复：

- ✅ `feature_list.json` 顶层 `phase` 字段：`阶段 1` → `阶段 2：RAG 质量评估与调参能力（收尾）`
- ✅ `AGENTS.md` 阶段范围引用：`feat-015 / feat-016~020` → 对齐实际编号 `feat-012.x / feat-013.x`，并新增阶段 2.5（feat-100~103）说明
- ✅ 所有 50 个 feature 的 ID 唯一性、依赖完整性、status 合法性通过
- ✅ AGENTS.md 列出的 12 个必需资产文件均存在

**已知历史 debt（不是本次会话引入，留给后续 agent）**：
- `.interview/` 缺面试题的 done feature：feat-002.1 / feat-002.2 / feat-002.3 / feat-002.4 / feat-009
- 建议在启动下一个 feature 前补齐（AGENTS.md「面试题规则」要求每完成一个 feature 都要 3-5 道面试题）。

---

## 2026-05-25（会话 16 — 阶段 3-5 路线图规划）

### 已完成

本会话仅做规划与文档更新，不涉及代码实现。

- 规划阶段 3-5 完整路线图：Agent 自动化层 → Marketing Studio UX → 工程化与生产部署。
- 关键架构决策：**两种 Agent 模式共存**
  - Pipeline Orchestration Agent（feat-010）：Plan-and-Execute，复用 STAGE_DEPS 静态依赖图
  - Content Generation Agent（feat-011）：ReAct + 4 个工具，动态迭代直到 hook 评分达标
- 更新 `docs/PRODUCT.md`：阶段 2-5 章节重写以匹配新路线图（原阶段 3/4/5 已合并重构）。
- 更新 `AGENTS.md`：
  - 移除"阶段 1 不做 Auth/多租户"的硬约束，改为按阶段感知。
  - 在「必需资产」加入 `docs/ROADMAP_PHASE2_PLUS.md`。
- 扩展 `feature_list.json`：新增 19 条 feature 条目（feat-010 / 011 / 012 / 013 系列，含 epic 父项与子任务），全部 status=todo。
- 新建 `docs/ROADMAP_PHASE2_PLUS.md`：每个 feature 含用户故事 / 关键文件 / API 设计 / 验收标准 / 简历亮点。

### 当前状态

- 工作树：`claude/plan-agent-roadmap`（路径：`.claude/worktrees/plan-agent-roadmap`），从 `main` HEAD `14c8778` 切出。
- 仅文档变更，无代码改动；typecheck/lint 无需运行。
- 下一步：先收尾阶段 2（feat-006 + feat-008），再启动 feat-010 Pipeline Agent。

---

## 2026-05-20（会话 15）

### 已完成

- 设计 feat-008 自动化评估矩阵（Eval Matrix Runner）：
  - 确定 5 个测试维度（D1 Chunk / D2 Retrieval / D3 Transform / D4 Filter / D5 Query Rewrite）和 5 个固定维度。
  - 设计 12 个代表性 test case，覆盖基准、单维变化、多维叠加、预期最差配置。
  - 确定测试文档：`docs/PRODUCT.md`（3500 中文字符，三层 MD 结构）。
  - 确定 3 个固定测试 query（Q1 宽泛语义 / Q2 精确关键词 / Q3 语义模糊）。
  - 确定评估指标：第二类指标（无需 ground truth）—— hitRate / citationCoverage / confidenceScore / retrievedCount / avgScore / ideaCount / totalDurationMs。
  - 创建 `docs/EVAL_MATRIX.md`（完整产品设计文档）。
  - 创建 `.interview/feat-008_eval-matrix.md`（6 道面试题：组合爆炸、指标诊断、DB 隔离、多 query 设计、部分因子设计、失败处理）。
  - 更新 `feature_list.json`：新增 feat-008（status: planned）。

### 当前状态

- feat-008 设计已完成，尚未实现脚本代码。
- 待实现：`scripts/eval-matrix/` 目录下的 run-matrix.ts / collect-metrics.ts / report.ts / test-matrix.json。

---

## 2026-05-20（会话 14）

### 已完成

- 修复三个 pipeline 链路 bug：
  - `pipelineDeps.ts`：`evaluation` 未加入 `STAGE_DEPS`，导致 evaluation stage 拿不到上游 → 加入 `"evaluation": "generation"`。
  - `pipelineDeps.ts`：`citation` 位于 generation 之后，导致 prompt-build 取到 rerank 输出（无 contextText），生成内容为空 → 将 citation 移至 fallback 之后、prompt-build 之前（`"citation": "fallback"`，`"prompt-build": "citation"`）。
  - `pipelineStages.ts`：citation 的 UI 位置与依赖链不一致 → 移至 RETRIEVAL_STAGES（fallback 之后），group 改为 "retrieval"，module 改为 "生成前"。
- 补面试题：`.interview/feat-006_rag-quality-evaluation.md`（5 题）。

### 当前状态

- 所有 features 完成，pipeline 链路正确。
- 正确测试顺序：query-rewrite → retrieval → filter → rerank → citation → prompt-build → generation → evaluation。

---

## 2026-05-20（会话 13）

### 已完成

- 实现 `feat-006` RAG Quality Evaluation：
  - `prompt-build/route.ts`：`PromptBuildOutput` 加 `evidencePack?: EvidenceItem[]` passthrough。
  - `generation/route.ts`：四种方法输出接口（GenerationOutput/ProductPersonaOutput/SellingPointsOutput/ContentIdeasOutput）均加 `evidencePack` passthrough。
  - `pipelineStages.ts`：新增 evaluation stage（optional, defaultEnabled: true, group: generation）。
  - `stageRegistry.ts`：注册两种方法 `rag-metrics-only`（纯算法）和 `rag-metrics-with-faithfulness`（+LLM judge）；同时补全 `ParamDef` 的 `step?: number` 字段。
  - 新建 `evaluation/route.ts`：算法计算三指标（hitRate/citationCoverage/confidenceScore）+ LLM Faithfulness judge（JSON mode）；含 citedCount 去重修复、NaN guard、durationMs 缓存、JSON 解析失败抛出等质量修复。
  - 新建 `EvaluationOutputPanel.tsx`：三指标卡片（进度条 + 颜色编码）+ Faithfulness 区块（可折叠无支撑主张列表）+ Warnings 列表。
  - `PlaygroundShell.tsx`：evaluation stage 时渲染 EvaluationOutputPanel。
  - typecheck + lint + init.sh 全部通过（HEAD: f4d184e）。

### 当前状态

- `feat-006` 完成。所有计划内 features 已全部实现。
- 下一步：待定（所有 feat-001～feat-006 均已完成）。

---

## 2026-05-20（会话 12）

### 已完成

- 自动恢复 pipeline 状态（页面加载时从快照还原）：
  - `lib/snapshotDb.ts`：新增 `listAllSnapshots` 函数，返回所有 stage 的最新快照。
  - `app/api/snapshots/route.ts`：新增 `GET /api/snapshots`，返回所有快照列表（供页面加载恢复用）。
  - `PlaygroundShell.tsx`：mount 时 fetch `/api/snapshots`，如果当前会话没有任何 stepRuns，则将快照数据写入 stepRuns（status: "success"），恢复上次 pipeline 状态。
  - typecheck + lint 全部通过（commit `5a16074`）。

### 当前状态

- 自动恢复功能完成。
- 下一步：`feat-006` RAG Quality Evaluation（待开始）。

---

## 2026-05-20（会话 11）

### 已完成

- 实现 `feat-005` Marketing Generation：
  - `generation/route.ts` 新增三种结构化方法（JSON mode）：`product-persona`（产品画像：targetSegment/painPoints/coreNeeds）、`selling-points`（卖点地图：sellingPoints[]/differentiators[]）、`content-ideas`（内容 idea：ideas[]{title/angle/format/evidenceIds}）；targetAudience 参数注入所有三个方法的 system prompt；JSON 解析失败优雅降级；保留 `marketing-ideas` 向后兼容。
  - `stageRegistry.ts` 补充三种方法的 params（model/apiKey/baseUrl/targetAudience；content-ideas 额外加 ideaCount）。
  - 新建 `GenerationOutputPanel.tsx`：按 methodId 路由到三种卡片式渲染（PersonaSection / SellingPointsSection / ContentIdeasSection）；marketing-ideas 回退纯文本；EvidenceFooter + 折叠 MarkdownSummary。
  - `PlaygroundShell.tsx`：当 activeStage.id === "generation" 时切换至专属面板。
  - typecheck + lint + init.sh 全部通过。

### 当前状态

- `feat-005` 完成。
- 下一步：`feat-006` RAG Quality Evaluation。

---

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

## 2026-05-20（会话 8）

### 已完成

- UI 优化 #1：文档上传 tab 默认改为"上传文件"（原为"粘贴文本"）。`DocumentUploadPanel.tsx` `useState("file")`。
- UI 优化 #2：Embedding 批大小默认值 100 → 10（`stageRegistry.ts` + `route.ts` fallback 同步修正，已在上一次提交完成）。
- UI 优化 #3：页面刷新保持上次选中文档。`PlaygroundShell.tsx` 用 `localStorage.setItem/getItem("pipeline:selectedDocumentId")` 在选文档、删文档时同步写读；`useEffect` 初始化时恢复选中。
- UI 优化 #4：切换 method 不再重置表单内容。`StageConfigPanel.tsx` 用 `paramsMap`（`Record<methodId, params>`）分 method 存储表单值；切换 method 时保留已填字段，仅在该 method 首次出现时使用 defaults 初始化；同时兼容 main 分支的 `initialParams/onParamsChange` 跨 stage 持久化架构。

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

---

## feat-400.1 · Product Brief 事实层 slice 1（2026-07-14）

### 已完成
- **schema.ts**：新增 3 张表 `product_briefs`（一项目一份，整体 version + draft/confirmed）、`product_brief_fields`（字段级：group/key/value/source/evidence_chunk_ids/confidence/status/version，UNIQUE(brief_id,group,key)）、`product_brief_field_revisions`（编辑审计），已注册进 FEAT_200_DDL_BLOCKS。
- **product-brief 模块**：types（枚举常量 + 行类型 + REQUIRED_FIELDS/FACTUAL_FIELD_GROUPS）、service、controller、module，已注册进 app.module.ts。
- **事实门禁数据层化**：提取只写 candidate；confirm/edit 才 confirmed 且写 revision；upsertCandidateField 命中 confirmed 只标 stale 不覆盖；editField 事实型必填 reason；confirmBrief 前置门禁（missingRequired + unverifiedFacts 任一非空则拒绝）。
- **6 个 REST 端点**已同步到 docs/API_CONTRACTS.md。
- **.interview/feat-400.1_product-brief.md** 6 道面试题。

### 验证
- `tsc --noEmit`：EXIT 0。
- `eslint src/product-brief --max-warnings 0`：clean。
- `vitest run src/product-brief`：9/9 通过。
- 全量 `vitest run`：**208/208**（原 199 + 新 9，零回归）。
- 说明：未连真实 PG 验证 DDL 执行（本 slice 逻辑用 fake client 单测覆盖）；DDL 幂等（CREATE TABLE IF NOT EXISTS），下次 DbService.initSchema 自动建表。

### 下一步（feat-400.1 剩余 slice）
1. 文档/官网候选提取（LLM 抽字段 → upsertCandidateField，走 LlmService + Zod）。
2. 受限官网导入连接器（robots/sitemap/同域白名单/限速，禁社交抓取与通用爬虫）。
3. 前端审核工作台（分组展示候选/来源/置信度/状态 + 确认/编辑/拒绝 + issues 顶栏）。

---

## feat-400.1 · slice 2 LLM 候选提取 + 修复（2026-07-14）

### 已完成
- **ProductBriefExtractor**（`apps/api/src/product-brief/product-brief-extractor.ts`）：
  - 从 `rag_chunks` 加载项目全部 chunk（id + text），带字符预算截断（MAX_INPUT_CHARS=24k）。
  - 拼带 `[chunk_id: xxx]` 标注的输入块 → LLM（BYOK，走 project_settings，与 memory-distiller 一致）结构化提取。
  - Zod 校验输出；**丢弃幻觉出处**（evidence 只保留本次真实存在的 chunk id）；无 evidence → source=inferred 且 confidence 封顶 0.4；只收事实型分组。
  - 逐条 upsert 为 candidate（命中已确认字段只标 stale）。
- **POST /extract** 端点 + 模块 provider 注册（LlmModule @Global）。
- 事实门禁完整：detectIssues 会把 inferred 无 evidence 的候选事实标为 unverifiedFacts，阻断整份 Brief 确认。

### 修复（e2e 捕获的真实 bug）
- **ValidationPipe whitelist 剥掉 value 字段**：全局 `ValidationPipe({whitelist:true})` 会剥掉无 class-validator 装饰器的 DTO 字段，导致 `value` 恒为 undefined→存成 null。修复：`UpsertFieldDto.value` / `EditFieldDto.value` 加 `@Allow()`。单测覆盖不到（DTO 层），只有起服务 e2e 才暴露。

### 验证
- API `tsc --noEmit` EXIT 0；`eslint src` clean；`vitest run` **217/217**（原 208 + extractor 9）。
- **端到端**（起 API dev + 真 PostgreSQL）：`scratchpad/pb-e2e.mjs` **19/19** 全过，覆盖：空 Brief→3 缺失 / 加候选仍缺失 / 确认后清零+版本递增 / 已确认字段 upsert 只 stale 不覆盖值 / 事实型编辑缺 reason 被拒+带 reason 成功 / 确认整份 Brief / 未核实事实阻断确认 / extract 无文档优雅 404。
- 说明：extract 的 live-LLM 提取路径需 BYOK key 才能完整 e2e；本次以单测（parse/sanitize/幻觉出处过滤/字符预算）+ 无文档 404 覆盖。
- 顺带修复：`packages/shared-types` 缺 @types/node（offline install 补齐）+ apps/api 6 处 dead import + eslint 配置补 ignoreRestSiblings/varsIgnorePattern。apps/web 仍有 pre-existing react-hooks lint 债（与本 feature 无关，未动）。

### 下一步（feat-400.1 剩余）
1. 受限官网导入连接器（robots/sitemap/同域白名单/限速）。
2. 前端审核工作台（分组展示候选/来源/置信度/状态 + 确认/编辑/拒绝 + issues 顶栏 + 一键 extract）。

---

## feat-400.1 · slice 3 前端审核工作台（2026-07-14）

### 已完成
- **`apps/web/lib/api/product-brief.ts`**：Product Brief API 客户端（getBrief/extractBrief/upsertField/confirmField/editField/rejectField/confirmBrief + 类型），在 `lib/api/index.ts` 导出。
- **`apps/web/components/product-brief/ProductBriefWorkbench.tsx`**：审核工作台组件。按 7 个字段组展示【候选值 + 来源 + 置信度 + 状态】；每条支持 确认 / 编辑（事实型必填原因）/ 拒绝；顶部 issues 横幅（缺失关键字段 + 未核实事实 chip）；「从文档提取」一键 LLM 提取；「确认整份档案」按钮（有 issues 时禁用）；手动新增字段表单。
- **`app/(workspace)/projects/[id]/brief/page.tsx`** 路由 + **Sidebar「产品档案」入口**（FileText 图标，知识库与生成历史之间）。

### 验证
- web `tsc --noEmit` EXIT 0；新文件 `eslint` clean（mount effect 的 set-state 用 inline disable，与既有页面同款）。
- **浏览器端到端**（起 API + web + 真 PG，用 in-app browser 实操）：
  1. 注册新用户 → 侧栏出现「产品档案」入口 ✓
  2. 建项目 → 进产品档案：渲染 7 个分组 + issues 横幅列出 3 个缺失关键字段 chip（identity/name、identity/one_liner、positioning/core_value）+「确认整份档案」按钮禁用（tooltip 提示原因）✓
  3. 手动新增 identity/name=Idea-Maker → 出现「候选」徽章卡片（来源:用户·置信60%）✓
  4. 点「确认」→ 徽章变「已确认」(绿)、确认按钮消失、issues 横幅实时少一个 chip ✓ —— 门禁 UI→API→PG→刷新 全链路打通

### 说明
- extract 的 live-LLM 按钮已接线，实际提取需项目配好 BYOK 模型 key + 已 ingest 文档。
- apps/web 仍有 pre-existing react-hooks lint 债（EvalReport 等，与本 feature 无关，未动）。

### feat-400.1 剩余
- 受限官网导入连接器（robots/sitemap/同域白名单/限速）——最后一块。

---

## feat-400.1 · slice 4 受限官网导入连接器（2026-07-14）—— feat-400.1 收口

### 已完成
- **schema.ts**：新增 source_records / source_sync_jobs / source_pages / source_content_chunks 四表。
- **`sources/website-import.ts`**（纯安全层，可穷举单测）：normalizeRootUrl（补 https、拒非 http(s) scheme）、isSocialHost（社交黑名单）、isPrivateHost（SSRF：localhost/回环/私网段/link-local）、sameRegistrableDomain、isAllowedPath（首页+产品/定价/FAQ/帮助/文档/更新日志/关于白名单）、parseRobotsTxt + isAllowedByRobots、extractPageContent（title/meta/OG/JSON-LD/正文/同域链接，正则零依赖）、chunkText、classifyPageType。
- **`sources/sources.service.ts`**：validateTarget（社交/私网/非法 scheme → 400）+ runWebsiteImport（建 record/job → 读 robots → BFS 同域白名单抓取，限页 maxPages≤30 / 限深 maxDepth≤3 / 限速 400ms / 单页≤2MB / 只 text/html → 存 pages+chunks → 更新 job），fetchImpl 可注入。
- **controller + module**：POST /sources/import-website、GET /sources；注册进 app.module。
- **extractor 接入官网内容**：loadProjectChunks 现 UNION rag_chunks(document) + source_content_chunks(website)，sanitize 按出处 chunk 的 origin 定 source（document/website/inferred）。

### 修复（e2e 捕获）
- validateTarget 里 normalizeRootUrl 抛的普通 Error 没被包成 BadRequestException → 非法 scheme 返 500。改为 try/catch 包成 400。

### 验证
- API `tsc --noEmit` 0；`eslint src` clean；`vitest run` **279/279**（+62：安全层 + extractor website 分支）。
- **端到端**（起 API + 本地 fixture 官网 http://127.0.0.1:4599）：`scratchpad/sources-e2e.mjs` **14/14**：
  社交平台→400 / 非法 scheme→400 / 导入抓 2 页（首页+定价）/ robots 禁止的 /faq 被跳过 / 路径白名单拦 /admin / 跨域拦 external / pricing 页类型识别 + title 抽取 + 正文分片入库 / GET /sources 可回看。

### honest gaps（如实记录）
- 页面发现用"页内链接 BFS"而非解析 sitemap.xml（覆盖同样目标，但严格说规格提了 sitemap）。
- SSRF 只挡直连私网字面量，未防 DNS rebinding（公网域名解析到内网 IP）；生产需网络层再兜一道。
- 官网快照只存 content_hash + 清洗正文，未存不可变原始 HTML 快照（source_snapshots 表未建）。

### feat-400.1 状态
**全部 4 个 slice 完成，status=done。** 下一步可进 feat-400.2（Claim Map + 规则门禁 + 评测 Agent + 人工筛选）。

---

## feat-400.2 · Claim Map + 确定性门禁 + 决策器 + 队列（2026-07-14）

### 已完成
- **schema.ts**：新增 claims / content_variants / content_evaluations 三表。
- **claims 模块**：ClaimsService（deriveFromBrief 从已确认字段派生候选 Claim 按 source_field_id 去重；create/list；approve 时事实型 functional/outcome 无 evidence → 400；block）+ controller。
- **content-evaluation 模块**：
  - `deterministic-gate.ts`（纯函数，门禁核心）：unknown_claim / unapproved_claim / missing_evidence / **unsupported_number（extractHardFacts 抽价格/规格数字，须在引用 Claim 有据，防编造）** / banned_word / too_long / duplicate_claim。
  - `decision.ts`（纯）：门禁失败→blocked（模型高分覆盖不了）、无评测→human_review（不自动放行）、blocker→revise、关键维度达标→publish_candidate。
  - `evaluation-agent.ts`：受限上下文 LLM-as-judge + Zod，无 key/失败→null 优雅降级。
  - `content-evaluation.service.ts`：编排（存 variant→门禁→评测→决策→存 content_evaluations 可回放）+ human_review 队列 + 人工结论 + 回放列表。

### 验证
- API `tsc --noEmit` 0；`eslint src` clean；`vitest run` **297/297**（+18：门禁 12 + 决策 6）。
- **端到端**（起 API + 真 PG）`scratchpad/claims-e2e.mjs` **20/20**：派生 Claim、evidence 门禁批准/拒绝、内容评测四种路径（门禁过→human_review、未批准 Claim→blocked、编造价格→blocked、无 Claim→human_review）、队列、人工结论移出队列、评测回放。**一次通过零 bug。**

### honest gaps / 下一步（feat-400.2 剩余）
- 开发集/保留集**离线回归**未做（完成定义要求）。
- 评测 Agent 的 **live-LLM 完整 e2e** 需 BYOK key；本次以 parseScores 单测 + 降级路径覆盖。
- 前端 Claim Map + 评测队列 UI 未做。
- 硬事实一致性是启发式（只查带单位的价格/规格数字），非全 NLP 核对。

---

## feat-400.2 收尾（前端 A + 离线回归 B）+ feat-400.3 反馈学习 C（2026-07-14）

### A · 内容与卖点前端（feat-400.2 前端）
- `apps/web/lib/api/claims.ts` + `content-evaluation.ts` + `feedback-learning.ts` 客户端；`lib/api/index.ts` 导出。
- `components/content/ContentWorkbench.tsx`：卖点库（派生/批准/拒绝，事实型无证据提示）+ 写内容评测（硬规则检查结果 + 四态去向）+ 待人工队列 + 偏好更新建议。全大白话，**不用"门禁"改叫"硬规则检查"**。
- 路由 `/projects/[id]/content`；Sidebar 加"内容与卖点"入口。
- 浏览器验证：登录 → 内容页渲染 seed 的 4 条卖点；提交编造价格内容 → "硬规则检查：没通过 · 去向：已拦下 · 出现了没依据的数字/价格「199元」"。

### B · 内容评测离线回归（feat-400.2 完成定义"保留集回归"）
- `src/content-evaluation/golden/`：dev-set（8）+ holdout-set（6，冻结）；`golden-runner.ts` 跑硬规则+决策比对期望；`scripts/content-eval.ts` CLI（退出码 0/1/2）；`pnpm eval:content`。
- 纯函数、不连库/LLM，秒级。回归测试 golden-runner.test.ts 进 CI。实测 8/8 + 6/6。

### C · 反馈学习（feat-400.3）
- schema：content_feedback + update_suggestions（target_group CHECK 仅 style/constraint）。
- `edit-diff-classifier.ts`（纯）：7 类归类 + 类别→表达约束模板 + 聚合出建议。
- `feedback-learning.service.ts`：记录/聚合/接受（写 Brief 表达约束，双重保险不碰事实）/拒绝；已消费反馈不重复触发。
- controller + module + app.module 注册；前端"偏好更新建议"区。

### 验证
- api：typecheck 0、eslint clean、`vitest run` **308/308**；`pnpm eval:content` 0。
- web：typecheck 0、eslint clean（新文件）。
- 端到端：内容评测门禁 20/20；反馈学习 **16/16**（含红线断言：接受建议后事实字段值与数量一个没变；含 e2e 捕获并修复的"已接受建议同批反馈重复触发"dedup bug）。
- 浏览器：内容页四个区块（卖点/评测/队列/偏好建议）均渲染正确。

### 状态
feat-400.2、feat-400.3 均 **done**。剩：评测 Agent 的 live-LLM 完整 e2e 需 BYOK key；feat-400.4（Campaign 内容包）/ 400.5（HTML 海报）未开始。

---

## feat-400.4 · Campaign 内容包（2026-07-14）

### 已完成
- schema：campaigns（Campaign Brief）+ content_variants 加 campaign_id / source。
- `campaigns/campaign-generation.ts`（纯）：buildGenerationPrompt / parseVariants（Zod）/ groundVariants（引用只保留"允许∩已批准"，剔除幻觉+记 droppedClaimIds）。
- `campaigns.service.ts`：createCampaign、generateVariants（LLM→grounding→替换 generated）、addManualVariant、regenerateVariant、getCampaign（每角度实时硬规则检查+决策）、list。
- controller + module + app.module 注册。
- 前端 CampaignPanel（/campaign 页 + Sidebar"内容包"入口）：创建 Brief + 选可用卖点 + 生成 3 角度并排卡片（硬规则检查/去向/失败原因/单个重生成/手写）。全大白话。

### 验证
- api：typecheck 0、eslint clean、`vitest run` **315/315**（+7）。web：typecheck 0、campaign lint clean。
- 端到端 **14/14**（起 API + **假 OpenAI 兼容端点**，真跑 LLM 生成路径）：生成 3 角度 / grounding 剔除幻觉引用 / 引用真卖点角度硬规则检查通过 / 编造价格角度没过+已拦下 / 单个重生成 / 手写角度。
- 浏览器验证 /campaign：3 角度并排，'对比切入'（别家199我们9元）→硬规则检查没过·已拦下。

### honest gap
- 历史版本比较仅到"替换 generated"粒度，未存多版本快照（可后续加 variant 版本表）。
- 生成走真实 LLM 路径已用假端点 e2e 覆盖；接真 BYOK 模型只是换 baseURL/key。

### 状态
feat-400.4 **done**。Phase 4 剩 feat-400.5（后置视觉资产 + HTML→PNG 海报，锦上添花）。

---

## 全真 LLM 链路验证（真 GLM glm-4-flash，2026-07-14）

用户提供真实 GLM key 做全真链路验证（临时 .env，跑后删除，key 不入库）。

### 环境限制
- **bloomnote.fun 本环境不可达**（proxy/fake-IP，DNS→198.18.0.8，direct+proxy 均 000）。官网导入的"真实外网抓取"无法在此验证；改用直接种入 sample 官网内容 chunk，模型调用全真。
- 真 GLM **可达**（direct 401 空请求 = 触达；带 key 200）。

### 真 GLM 端到端结果（真 API + 真 PG + 真 glm-4-flash）
- 抽取：真 GLM 从 sample 内容抽出 **7 个候选事实字段**（name/one_liner/category/features/pricing/platforms/core_value，source=website，带 evidence）。
- 派生卖点：6 个；批准 4 个。
- 生成：真 GLM 出 **3 个角度**，各自实时硬规则检查通过（引用的价格/数字来自已批准卖点 → 不误拦）。
- 判分：真 GLM 返回结构化评分 {factualFaithfulness:5,...} → publish_candidate。

### 🐞 真链路暴露并修复的真实 bug（mock 掩盖了它）
- **glm-4-flash 把 JSON 多包一层数组**：`[{"fields":[...]}]` / `[{"variants":[...]}]` / `[{...scores}]`，而假端点永远返回拆好的对象。导致抽取/生成解析后 Zod 判空 → **extracted=0 / generated=0**。
- 修复：`parseFields` / `parseVariants` / `parseScores` 三处统一加"数组拆包"；补 3 条回归单测。修复后真 GLM 链路全跑通。
- 全量 **318/318**、typecheck+lint clean。

### 结论
- 需要大模型的环节（抽取/生成/判分）**已用真实 glm-4-flash 验证**，非 mock。
- 唯一未真验的是"抓真实外网官网"（环境不可达），但抓取机制+安全规则已用本地 fixture e2e 覆盖。

---

## 全真官网导入验证（真抓 bear.app/zh/，2026-07-14）

bloomnote.fun 本环境不可达，改用真实可达的 bear.app/zh/ 验证"真实外网抓取"这条链路。

### 🐞 真实本地化站点暴露并修复的 bug
- 路径白名单是英文中心的（`^/(pricing|faq|...)`），**入口 `/zh/` 和 `/zh/faq` 都不匹配** → 会 fetch 0 页。本地 fixture 用的是 `/`，掩盖了这个 gap。
- 修复：isAllowedPath / classifyPageType 加"语言前缀剥离"（/zh/、/en-us/ 等）；BFS 里用户提交的入口 root 永远允许抓。补 7 条回归单测。

### 真实结果（真抓 + 真 GLM）
- 真抓 bear.app/zh/：**6 个真实页面**（熊掌记首页 / blog / community 子域 / /zh/faq / faq 子页 / 教育优惠页），0 跳过，真实标题+正文入库。同域含子域、robots、语言前缀白名单全部生效。
- 真 GLM 抽取 23 个真 chunk → 保守抽出 identity/name=熊掌记（bear.app 是营销文案页、非规格页，事实红线正确地只留有证据的名称，没瞎编价格/功能）。
- 真 GLM 生成 3 个真角度（关于熊掌记），硬规则检查通过。

### 全量
325/325、typecheck+lint clean。servers 停、含真 key 的 .env 已删。

### 未尽
- bloomnote.fun 仍因环境网络不可达未验；机制已用 bear.app 真实覆盖。

---

## feat-400.5 · 视觉资产 + 受限模板海报（2026-07-14）—— Phase 4 收官

### 已完成
- schema：visual_assets（logo/截图/参考海报/字体，uploaded→approved）+ posters。
- assets 模块：multipart 上传（sharp 取尺寸 + sha256）、approve、list、readApproved（base64 内嵌供海报用）。
- posters 模块：`poster-render.ts` 纯函数（2 个受限 SVG 模板 + xmlEscape 防注入 + WCAG 对比度 + 溢出/颜色/只用已批准 Claim与资产 校验）；PostersService（校验通过才 sharp 光栅化真实 PNG 落盘）；controller（templates/render/list/:id/png）。
- **偏离规格（已记录）**：规格写 Playwright Chromium + HTML/CSS，本环境无 Playwright（有 sharp），改用『受限 SVG 模板 DSL + sharp 光栅化』——更轻、更受限（无浏览器、模型不产 HTML/CSS）、产出真实 PNG。

### 验证
- api：typecheck 0、lint clean、`vitest run` **350/350**（+25）。
- 端到端 **14/14**（真 multipart 上传 PNG → sharp 解析尺寸 → 批准 → 真 SVG 模板 sharp 渲染 **800x800 真实 PNG**（magic 89504e47）→ 下载 image/png；未批准 Claim → unapproved_claim 拦下；对比度不足 → low_contrast 拦下）。
- **肉眼确认**渲染海报版式正确（靛蓝底 + 熊掌记标题 + 已批准 claim 折行）。

### honest gap
- 字体资产仅登记不深度内嵌（sharp/resvg 字体支持有限）。
- 参考海报/截图资产仅存储，未做"参考版式套用"。
- 依赖：apps/api 新增 sharp@0.34.5（离线从 pnpm store 链接）。

### Phase 4 状态
**feat-400 全闭环 done**（400.1~400.5 全部完成）。sharp 已加入 apps/api 依赖。

---

## apps/web lint 清理 + feat-400.5 海报前端（2026-07-14）

### apps/web lint 债清零
- `Tabs` 组件的 `children`（其实是 panels 映射，非 React children）→ 改名 `panels`，修 react/no-children-prop。
- `EvalReport.tsx` 两处数据加载/定时器 effect → 加 react-hooks/set-state-in-effect 局部 disable（惯用法）。
- `useEventSourceWithReplay.ts` 删一条失效的 exhaustive-deps disable。
- 结果：`apps/api lint: Done` + `apps/web lint: Done`（init.sh 仅剩 session-handoff.md HEAD 滞后的文档提示，非代码问题）。

### feat-400.5 海报前端
- lib/api：assets.ts（multipart 上传，原生 fetch）+ posters.ts（含 auth 化 blob 拉 PNG 做预览）+ client.ts 导出 apiBaseUrl/authToken。
- PosterStudio.tsx（/poster 页 + Sidebar“海报”入口）：上传/批准资产 → 选模板/填标题/选已批准卖点/选 Logo/调底色字色 → 出图 → 成功则内嵌 PNG 预览 + 下载；失败则大白话列排版问题。
- 验证：web typecheck+lint clean；**浏览器端到端**：填“熊掌记”+选已批准卖点 → 出图成功 800×800 → 真实 PNG 预览内嵌显示（靛蓝底 + 标题 + 卖点折行）。auth 化 blob 预览链路跑通。

### 全绿
apps/api：typecheck 0 / lint 0 / 350 测试。apps/web：typecheck 0 / lint 0。Phase 4 全部功能（含前端）完成。
