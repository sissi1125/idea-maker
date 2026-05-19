# AGENTS.md

Marketing RAG Playground 是一个可调试的 RAG 驱动产品运营 idea 生成系统，面向独立开发者、一人公司和小团队产品运营。

## 启动流程

写代码前：
1. 阅读本文件。
2. 阅读 `docs/PRODUCT.md`，确认产品阶段规划和当前阶段边界。
3. 阅读 `docs/ARCHITECTURE.md`，理解目标系统形态。
4. 修改 API 行为前，阅读 `docs/API_CONTRACTS.md`。
5. 当依赖或验证命令存在时，运行 `./init.sh`。
6. 查看 `feature_list.json` 和 `progress.md`，确认当前状态。

## 项目定位

本项目面向**求职简历与学习**，目标是产出一个完整的、可演示的 RAG 系统作为作品集项目，并深化对 RAG 各阶段原理的理解。所有技术决策和代码风格应体现工程能力和可解释性。

## 代码注释规则

- **所有方法实现必须加注释**，解释该方法做了什么、为什么这样做、关键步骤的逻辑依据。注释面向"正在学习 RAG 的读者"，而不仅仅是协作者。
- 函数级注释说明输入/输出语义和关键算法选择。
- 非显而易见的技术决策（如为什么用 SHA-256、为什么用 RRF、为什么按这个顺序 chunking）必须有注释解释原理。
- API route 文件顶部写明该 stage 在 RAG pipeline 中的作用和位置。

## 面试题规则

- **每完成一个功能点（feature），以面试官身份提出 3～5 个相关项目面试题及答案**，涵盖：该 stage 的核心原理、实现中的技术选型、常见陷阱、可扩展性。
- 面试题写入 `.interview/<feat-id>_<topic>.md` 文件（每个 feature 独立一个文件），同时 commit 进代码库。
- 面试题应结合本项目的实际代码和设计决策，而非泛泛而谈。

## 外部服务

- `services/pymupdf/`：Python FastAPI 微服务，提供 pymupdf PDF 精确提取。
  - 本地启动：`docker compose up pymupdf`（宿主机端口 8001）
  - Next.js 通过环境变量 `PYMUPDF_SERVICE_URL` 调用（默认 `http://localhost:8001`）
  - **不要在 Next.js 侧实现假的 pymupdf 逻辑**；若服务未启动，返回 `provider_unavailable` 错误。

## 技术选型说明（需求变更记录）

以下是与初始规划相比发生变更的技术决策，记录原因防止后续 agent 回退：

| 决策 | 初始规划 | 实际实现 | 变更原因 |
|------|---------|---------|---------|
| API 路径前缀 | `/api/rag/*` | `/api/pipeline/*` | pipeline 比 rag 更准确，涵盖 retrieval 和 generation |
| 文档存储 | PostgreSQL | 本地 JSON（dev 阶段） | 快速迭代优先，接口已封装，迁移只改内部实现 |
| UI 组件库 | shadcn/ui | 自写组件 | Tailwind v4 与 shadcn/ui 兼容问题，无需引入 |
| PDF 解析（Node.js） | 无规划 | pdf-parse v1 | pdf-parse v2 在 Next.js server 端需要 web worker，v1 无此依赖 |
| DOCX/HTML 解析 | 无规划 | mammoth + turndown | markitdown 是 Python 库，JS 侧用等价 npm 包替代 |
| pymupdf | 直接调用 | Python 微服务 | pymupdf 是 Python 库，Node.js 不能直接调用，必须进程间通信 |
| 二进制文件存储 | 未规划 | base64 in JSON | JSON 不支持 binary，base64 是标准 text 编码方案 |

## 工作规则

- 项目文档、进度记录、交接说明和面向后续 agent 的说明默认使用中文；代码标识符、API 路径、字段名和第三方专有名词按工程约定保留英文。
- 一次只做一个 feature，并把改动限制在当前 feature 范围内。
- 当前阶段是“阶段 1：可调试 RAG Playground 闭环”，不是 SaaS 产品；除非用户明确要求，不做登录、计费、多租户后台、Workflow Studio 或内容 CMS。
- 每个生成的运营结果都必须能追溯到 evidence chunk IDs。
- 优先实现确定性、可 mock 的路径，尤其是 embedding 和 LLM 调用。
- 每个 pipeline step 都必须暴露 method、params、input、output、timing、status 和 trace。
- 不要把 RAG 内部过程藏成黑盒；本项目核心价值是可调试。
- `feat-002.1` 搭建 Playground 后，每个后续 stage 交付前必须验证 Playground 仍然可用：页面可打开、stage 可切换、已有 stage 不回归、新增 stage 的配置/运行/output/trace 可见。
- 结束较大开发会话前，更新 `feature_list.json` 和 `progress.md`。
- 任何 git/lifecycle 状态变化后必须同步 `progress.md` 和 `session-handoff.md`，包括 `git init`、commit、branch/tag 变化、应用脚手架完成、dev server 启停方式变化、feature 完成或阻塞。
- 发生 git/lifecycle 状态变化时，必须先完成状态文档同步并验证，再发送最终回复。
- `feature_list.json` 中 status 为 `epic` 的条目只用于聚合子任务，不作为直接执行对象；实际开发从依赖已满足的最小子 feature 开始。

## 必需资产

- `docs/PRODUCT.md`：产品目标、目标用户、用户流程、项目阶段规划。
- `docs/RAG_PIPELINE_PLAYGROUND.md`：RAG pipeline 分阶段执行和 Playground 功能拆分。
- `docs/ARCHITECTURE.md`：系统边界、数据模型、pipeline 流程。
- `docs/API_CONTRACTS.md`：REST endpoint 请求/响应契约。
- `docs/VERIFICATION.md`：质量门禁和人工验收清单。
- `docs/ORCHESTRATION.md`：Pipeline Step Orchestration 架构设计（feat-003.7，步骤分类、依赖解析、UI 设计）。
- `.interview/`：每个 feature 的面试题目录（`<feat-id>_<topic>.md`，随 feature 同步更新）。
- `feature_list.json`：功能状态、依赖和证据记录。
- `progress.md`：跨会话进度记录。
- `session-handoff.md`：下一次 agent 会话的重启上下文。
- `init.sh`：标准项目启动和验证入口。

## Feature 状态

`feature_list.json` 只允许使用这些状态：

- `epic`：父级聚合项，不直接执行。
- `todo`：可执行但尚未开始。
- `in-progress`：正在实现。
- `blocked`：被明确阻塞。
- `done`：已完成并记录 evidence。

## 完成定义

一个 feature 完成时必须满足：
- [ ] 实现符合选定 feature 的范围。
- [ ] API/schema 变更已同步到 `docs/API_CONTRACTS.md`。
- [ ] 相关 pipeline trace/evidence 行为可见或已测试。
- [ ] 如果 Playground 已搭建，必须完成 Playground 可用性验证并记录证据。
- [ ] 验证命令通过，或阻塞原因已记录。
- [ ] `feature_list.json` 状态和 evidence 已更新。
- [ ] `progress.md` 记录了改动、验证结果和下一步。
- [ ] 如果发生 git/lifecycle 状态变化，`progress.md` 和 `session-handoff.md` 已同步真实状态。

## 会话结束前

1. 在 `progress.md` 记录已完成工作。
2. 更新 `feature_list.json` 里的相关 feature 状态。
3. 刷新 `session-handoff.md`，写明当前分支/状态、阻塞和下一步。
4. 如果发生 git/lifecycle 状态变化，确认 `progress.md` 和 `session-handoff.md` 与真实状态一致。
5. 让仓库保持可重启状态，方便下一个 agent 接手。
