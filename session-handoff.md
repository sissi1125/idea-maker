# 会话交接

## 最后更新

2026-07-19（**通用 RAG 写库 P1 已完成待提交；下一步后台任务可靠性**）

## 当前状态

- 当前分支：`main`，当前 HEAD：`2c3f9a0`，工作树在本轮交接修正前干净并与 `origin/main` 对齐。
- `8ff2318` 已快进推送 `origin/main`；部署修复 `eb1f57f` 让 workflow 在 API healthy 后恢复 stopped cloudflared。Vercel Production、CI、后端镜像/ECS 部署均成功，生产 Web 与 API `/health` 均返回 200。
- PostgreSQL P0 已在 `bdc8dd0` 完成：生产业务 `DbService` 使用进程级 `pg.Pool`（默认 max=10、idle=30s、connect timeout=5s）；ingestion storage 复用池，Agent 每条 SQL 借还连接，等待 LLM 时不占池槽。全仓 typecheck/lint、633 tests 和 API build 通过；真实 PG 在 max=2 下验证并发限流与连接复用。
- 官网批处理 P0 已在 `2c3f9a0` 完成：Embedding 默认 16 条/请求，官网 `rag_chunks` 默认 50 行/INSERT；64 chunks 的请求数由 64 降至 4，真实 pgvector 200 行写入由 200 条 SQL 降至 4 条。
- 通用 RAG Storage P1 已完成：默认 50 行/INSERT（可配置 1..500），同 document advisory lock，Dimension Guard/版本选择/replace 删除/全部批次统一事务。真实 pgvector 200 行 SQL 200→4，中位耗时 50.16ms→4.58ms（10.95x）；全仓 640 tests、typecheck/lint、API build 通过。
- 下一步：后台任务并发限制、租约、心跳、过期任务回收和启动恢复，必须作为独立 feature/commit 实现，并保持 ingestion 轮询与 Agent SSE 对外行为不变。
- 旧 Playground 动态 connectionString 路径继续使用隔离专用 Client，避免不同数据库混入生产 Pool；API/schema 无变化。
- 最新修复：“确认全部信息”现在会在事务内确认全部 candidate/stale 子字段、逐条写 revision，再确认 Brief；完成后右上角按钮替换为“全部信息已确认”。浏览器/API/PG 验证 4/4 字段 confirmed、4 条 revision、Brief confirmed v2，隔离数据已清理。
- 本轮新增：内容资产标题/Tab 固定且仅当前内容区滚动；资料库已有官网直显、编辑时才展开输入；内容任务展示卖点并支持删除；AI 对话/经典生成 Evidence hover 显示原 chunk；Brief/Claim/图片显示来源，Claim 与海报消费按来源排序。
- 运行态 schema 已确认包含 `claims.origin` 与 `visual_assets.origin`。API 契约已补 Campaign DELETE、`replaceExisting`、Claim/Asset origin 和 Agent context evidence。
- 浏览器 E2E 已完成桌面/375px Tab 稳定性、官网已有值编辑、卖点批准→任务创建→标签展示→任务删除、卖点/图片来源徽标；测试官网 fixture 和测试任务已清理，临时批准的原卖点已恢复为待审核。
- 最新验证：626 tests、API/Web production build、顺序 typecheck/lint、`git diff --check` 均通过。
- 唯一验收阻塞仍是项目 `key_missing`：拿到 LLM Key 后依次补跑 Brief extract、Campaign generate、Agent generate→critic/refine，并在真实结果上复验 Evidence hover。

- 当前分支：`codex/feat-402-ui-productization`，基线 `b44c611`，feat-402 改动未提交。
- 已完成 Login、设计 token、一级导航、项目总览、产品资料、产品信息、结构化内容创作、AI 对话、内容资产和移动导航重构；第二轮删除珊瑚红与旧绿色/斜体，引入自托管 Instrument Sans，产品信息改为统一标题和审计行；后端业务模型未改。
- 内容创作新增前端显式状态投影（drafting/ready/generating/reviewing/accepted/failed）和四步可视轨道，复用现有 Campaign/Variant/job 数据，没有新增 schema。
- 第三轮参考 Hyperbound 的浅灰白 + 蓝色点缀、8-14px 圆角和轻阴影；字体切为自托管 Noto Sans SC。产品工作区 Select 已统一为共享组件。
- 总览四步改为带说明的 ProjectGuide，并与建议下一步成为同一视觉整体；内容创作移除项目级四步，仅保留内容任务状态轨道。
- 一级导航已改为「资料库 / 产品档案」；产品档案分为产品信息、产品卖点、视觉资产三个同级 Tab，信息内保留 4 项 sticky 锚点。
- 产品卖点复用 Claim Map，支持平台生成以及用户新增、编辑、删除；视觉资产保留 Logo/主图/氛围素材/功能截图与对应卖点 Select，并增加末尾上传卡片、直接批量上传和图片删除。
- 后端仅补充 Claim PATCH/DELETE、资产 DELETE；既有 `claim_id`/标签 PATCH 与旧枚举兼容，RAG/Brief/Campaign/生成模型未改。
- 新增共享 `ConfirmDialog`，项目/卖点/图片删除均已移除浏览器原生 confirm；支持遮罩、Esc、滚动锁定和 alertdialog 语义。
- 产品档案三个一级分类已收敛为横向下划线 Tab，产品信息专属工具栏不再污染卖点/视觉资产。
- 内容资产 5 个横向 Tab 已从“跳转入口”修正为真实聚合视图：默认直接渲染笔记库，其他 Tab 原位挂载内容包、海报、生成记录和评估报告，URL 保持 `/assets`；Tab 固定宽度并在窄屏内部横向滚动。
- 本地 E2E 已验证三级 Tab、卖点新增→编辑→删除、上传卡片唤起 `multiple=true` 文件选择器、图片上传→删除、标签回显；测试项目仍保留原有 1 张 E2E 图片和 1 条情感型测试卖点。
- 最新 E2E 验证自定义删除弹窗取消后资产仍为 1、浏览器无原生 dialog；内容资产默认笔记库；375px 产品档案与内容资产均无页面横向溢出。
- 内容资产最新浏览器 E2E 逐项确认 5 个 Tab 均原位渲染真实内容；375px Tab 容器 333px/scrollWidth 418px，document scrollWidth 375px。
- 本地“数据库未配置”已修复：清理同 worktree 多个竞争 3001 的 ts-node-dev，只保留一个 API；Git 忽略的 `apps/api/.env` 已补本地 PG/JWT/CORS。health 与真实登录均 200。
- 验证：全仓 typecheck/lint、626 tests、API/Web build 通过；本地 PostgreSQL + pgvector + NestJS API + Next Web 正在运行。
- 浏览器真实 E2E 已完成注册、建项目、上传中文 Markdown、ingestion/pgvector 入库、产品信息、内容创作、AI 对话和内容资产；第二轮复验统一 h1、字体、状态轨道及 375px 无溢出/重叠。
- E2E 修复：ingestion 实际终态 `succeeded` 与前端 `completed` 契约不一致导致无限轮询，现兼容两者。
- 阻塞：worktree 无真实 LLM/Embedding 凭据，外部模型完整链路未验；生产 API health 当前 Cloudflare 530。完成这两项前 `feat-402` 保持 in-progress。

- 当前分支：`main`，已提交 HEAD：`840a735`（main 回归修复已在 `origin/main`）；feat-401 改动尚未提交。
- **feat-401 完成**：Confirmed Product Brief 是 Agent 唯一事实裁决层；Approved Claims 是允许表达；RAG raw chunk 不进模型，只保留 field/claim chunk IDs 做 provenance。outer Agent 与 generate/refine/critic 共用服务端 Grounding。
- **交付门禁**：无 Brief 不调用 nested LLM；citation、无依据价格规格、平台规则均由代码校验；critic JSON mode 兼容 GLM，passed 后 runtime 交付被评审的精确 draft，防 outer 转述删引用。仅禁词失败可确定性删除并记录。
- **真实 eval**：Bloomnote 专用 `gold-product-brief-grounding-006` 1/1 passed，faithfulness=4、completeness=5、style=4、overall=4.333；旧通用 golden 与项目 Brief 不匹配，不能混作同一基线。
- **main 回归修复**：① AgentContextPanel 用 request key 派生 loading/error，消除 effect 同步 setState lint；② AgentRunner 测试 mock 补 `saveContextSnapshot` 并新增快照调用断言；③ init.sh 对中文标点前的变量使用 `${...}`，避免 Bash/locale 把全角逗号吞入变量名。
- 本机 PostgreSQL、Web（3000）和 API（3001）正在运行；有效智谱配置已放入 Git 忽略的 `apps/api/.env`，直连认证 HTTP 200。真实 Agent 已完成 `generate_draft` tool call → tool result → reasoning → done，全程步骤可见。
- **Agent 模式本轮修复**：① SSE error 通知对话页结束 running，② 认证失败映射为脱敏可操作的 `llm_auth`，③ cost/finish/error/steps 按 `runId` 隔离，连续重试不残留旧状态。浏览器连续两次 E2E 已确认失败能正确收尾，不再卡住。
- **本轮审查修复**：① 官网/图片导入每跳重定向 + DNS 私网校验，② Agent 全部 run 读取/SSE/abort 端点加 owner 校验，③ Campaign 生成/重生成接入评测并持久化决策，④ Claim evidence 存在性和项目归属校验，⑤ 上传大小/像素限制，⑥ 官网重导去重并替换变更 chunk，⑦ API `.env` 路径与 `init.sh` HEAD 检查修复。
- 验证：`pnpm -r build`、`pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test`（604 tests）和 `./init.sh` 均通过；浏览器已验证“查看上下文”加载真实 prompt/messages，真实 GLM Agent 再次 `done`。
- **本轮做完的事**：
  - 修 bug：① AgentRunner 默认模型回退 `LLM_MODEL`（原写死 gpt-4o-mini → GLM「模型不存在 06bb0562」）② name 不再成为卖点（deriveFromBrief 跳过 identity 里 name/category/website/url）③ 官网导入 0 资产 → 加 favicon 兜底（SPA 无 og:image 时抓 apple-touch-icon/favicon）④ 抽取/生成/判分全加 abortSignal 超时 ⑤ **rag-core is-html ESM 冷启动崩溃** → 内联正则替换 is-html（否则生产 Docker 也会崩）⑥ embedding 256≠1024 → 改裸 fetch 强制 `dimensions:1024` + NULL 兜底。
  - **Q3 官网进统一 RAG**：官网正文 → 1024 维 embedding → `rag_chunks`（project_id 隔离）→ 对话/search_kb 可检索。已本地 fixture 验证 2 段入库、维度正确、project_id 隔离。（用户明确：原始 HTML 快照不做。）
  - 功能：内容包「采纳」出口 + 「一键出海报」（campaign/claim → autoRender，有官网主图用 hero-image 模板）；视觉资产缩略图/上传/批准；产品逻辑归位（官网导入挪到「知识库」，视觉资产留「产品档案」）。
  - UI 换肤：`.field` 主题化输入 + 品牌色工具类 + `.card:hover`（用户仍嫌丑，未换 antd —— 见待办）。
- 验证现状：rag-core tc + 239 单测；api tc + lint + 354 单测；web tc + lint —— 全绿。
- **feat-400（Product Brief 产品闭环）全部 5 个子功能 + 前端界面完成**：
  - 400.1 产品事实档案（字段级 evidence/状态机/版本）+ 受限官网导入（robots/同域/白名单/限速/SSRF）+ LLM 候选提取
  - 400.2 Claim Map + 确定性硬规则检查 + 评测 Agent + 决策器四态 + 人工队列 + 开发集/保留集离线回归
  - 400.3 反馈学习（编辑归类 → 更新建议，不自动改事实）
  - 400.4 Campaign 内容包（Brief → 3 可比较角度 + grounding + 并排硬规则检查）
  - 400.5 视觉资产 + 受限 SVG 模板海报（sharp 光栅化 PNG，替代 Playwright）
  - 前端页：产品档案 / 内容与卖点 / 内容包 / 海报（全大白话，不用"门禁"字眼）
- 验证现状：后端 **350 单测**通过；api + web **typecheck + lint 全绿**（apps/web 旧 react-hooks lint 债已清）；生产构建链 nest build + next build 通过。
- **真链路验证**（用户提供真 GLM key + 真域名）：真抓 bear.app/zh/（6 页）、真 GLM glm-4-flash 抽取/生成/判分、真 sharp 渲染 PNG 海报。过程抓修 3 个 mock 掩盖的真实 bug：GLM 数组包裹 / ValidationPipe 剥 value / 本地化路径前缀。
- 工程：apps/api 新增 `sharp@0.34.5`（lockfile 已含 linux 二进制）；`docker-compose.named-tunnel.yml` 加 `api_uploads` 持久卷（文档/资产/海报落盘持久化）。
- 遗留风险：BYOK 仍以明文保存在 `project_settings.encrypted_api_key`；需要独立实现 AES-GCM、密钥轮换与历史数据迁移。多租户项目访问已在本轮补齐 Agent 端点校验，但仍应做一次跨用户 API 回归。

## 待办 / next

- **Agent 后续**：在有真实产品文档的项目复验 `search_kb → generate_draft → critic/refine` 多工具路径；当前无文档测试项目已验证单工具成功路径。
- **真实 E2E（下一步）**：配置 `apps/api/.env` 后，用隔离 PostgreSQL 运行 Product Brief 专用 smoke：官网导入→Brief 确认→Claim evidence/审批→Campaign 评测→人工决策→海报。
- **确认后 commit 本轮改动**（用户说"确认后 commit"，尚未 commit）。
- **UI：换 antd**（用户两次反馈「太丑」，本轮只做了 CSS 换肤没换组件库；antd + React 19 需确认 `@ant-design/v5-patch-for-react-19` 兼容）。
- **部署**：本轮改动 commit 后再走 —— ① PR 合 `main` → Vercel 部署前端 ② SSH ECS `git pull && docker compose -f docker-compose.named-tunnel.yml up -d --build`。注意 rag-core is-html 修复对生产冷启动是必需项。DB 无需手动迁移（CREATE TABLE IF NOT EXISTS），无新增必填 env。
- Phase 4 后可选：跨用户授权 + BYOK 加密 + 数据隔离（企业化前置）；海报模板扩充 / 字体深度内嵌。

## 本次变更摘要（feat-400 Phase 4 收官）

【新增后端模块】product-brief / sources / claims / content-evaluation / feedback-learning / campaigns / assets / posters（含各自 service/controller/module + 纯函数核心 + 单测）
【schema】新增 product_briefs/fields/revisions、source_records/pages/content_chunks/sync_jobs、claims、content_variants(+campaign_id)、campaigns、visual_assets、posters、content_feedback、update_suggestions
【前端】lib/api 各 client + 4 个页面（brief/content/campaign/poster）+ Sidebar 入口；Tabs children→panels 修 lint
【工程】sharp 依赖 + compose 持久卷 + apps/web lint 清零

**进度**：feat-400 done，代码已 commit+push，待合并部署。

---

## 上一次更新（Phase 3.5 真 Agent 计划）

【Phase 3.5 计划（头脑风暴 + 计划制定）】
- 架构方向确认：全面 ReAct（非 Plan-and-Execute），rag-core stages 降级为 tools
- 技术栈确认：Vercel ai-sdk（LLM/tool 抽象）+ 自建 agent loop / memory / eval
- 旧方案 feat-010.x / feat-011.x 标为 superseded，由 feat-300.1~300.7 取代

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
