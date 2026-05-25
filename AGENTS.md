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

## 中文优先原则（Chinese-First）

**本系统面向中文内容处理，所有 RAG 方案默认以中文为第一优先级。** 每次涉及文本处理的决策，必须先问"这个方案对中文是否正确"，而不是假设 ASCII/英文规则天然适用。

**具体规则：**

| 操作 | 中文要求 |
|------|---------|
| **分词 / tokenization** | 必须使用 `@node-rs/jieba`，禁止空格切分（中文无空格）|
| **句子边界 / sentence boundary** | 以 `。！？…\n` 为切分点，不以空格为切分点 |
| **chunk separators** | 默认 separators 必须包含 `"。"` `"！"` `"？"` `"；"`，不能只有 `"\n"` 和 `" "` |
| **token 计数** | 中文 1-2 字符 ≈ 1 token（tiktoken cl100k），不能用 `chars/4`（英文规则）|
| **Embedding 模型默认值** | 默认使用 `text-embedding-v4`（Qwen，中文优化），不使用 `text-embedding-3-small`（OpenAI，英文优先）|
| **本地 Embedding 默认值** | HF 模型默认用 `BAAI/bge-m3`（多语言）或 `BAAI/bge-small-zh-v1.5`，禁止使用 `-en-` 后缀模型 |
| **Reranker 模型默认值** | 默认使用 `BAAI/bge-reranker-v2-m3`（多语言），不使用 `bge-reranker-base`（英文优先）|
| **停用词表** | 中文停用词表需 ≥ 500 词，覆盖产品文档高频无实义词（通过、支持、提供、功能…）|
| **keyword joining** | 中文 token 拼接用 `""`（无间隔），不用 `" "`（英文词间距）|
| **LLM 提示词** | 评估、查询改写、生成的 system prompt 默认用中文 |

**新增文本处理逻辑时，Code Review 必须包含一条：** "该实现对全中文段落（无空格、无英文）是否正确？"

---

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
- **阶段感知**：当前阶段以 `feature_list.json` 顶部的 `phase` 字段为准。各阶段范围参考 `docs/PRODUCT.md` 和 `docs/ROADMAP_PHASE2_PLUS.md`：
  - 阶段 1（已完成）：RAG Playground 可调试闭环（feat-001 ~ feat-005、feat-007、feat-009）。
  - 阶段 2（收尾）：完成 feat-006 / feat-008（RAG 质量评估与 Eval Matrix）。
  - 阶段 2.5（架构重构）：feat-100 epic + feat-100.1 ~ feat-100.4（pnpm monorepo + NestJS 前后端分离）。
  - 阶段 3：Agent 自动化层（Pipeline Agent + Content Agent）—— feat-010.x / feat-011.x 系列。
  - 阶段 4：Marketing Studio UX —— feat-012.x 系列（含 4 个子项）。
  - 阶段 5：工程化（Auth / 多租户 / BYOK / Drizzle / 部署）—— feat-013.x 系列（含 5 个子项）。
- **Feature 编号约定**：
  - **001~099 段位**：业务功能 feature，按时间顺序连续编号。
  - **100+ 段位**：架构 / 基础设施 / 跨阶段重构类 feature。逻辑上跨越多个业务阶段、且执行顺序与编号顺序可能不一致时使用（如 feat-100 注册顺序在后但执行顺序在 feat-010 之前）。后续如再有大型架构调整（迁框架、引入消息队列等），用 feat-101 / 102 ... 继续。
- 跨阶段实现需要先核对当前 phase，**不要把后续阶段功能提前塞进当前阶段**（如：阶段 3 期间不实现 Auth）。
- **双轨并行**（详见 `docs/ROADMAP_PHASE2_PLUS.md#双轨并行执行模型`）：
  - **轨道 A 主流程**：架构重构 + Agent + Studio + 工程化（feat-100.x 架构 + feat-010~013 业务），分支 `claude/refactor-monorepo` 或类似。
  - **轨道 B RAG 实验**：feat-006/008 收尾 + 持续算法实验，分支 `claude/experiments/<topic>`，**默认只产报告**（写入 `scripts/eval-matrix/results/run-XXX/`），有效优化单独小 PR 合入 main。
  - **Wave 2 冻结窗口**：主流程做 Wave 2（feat-100.2，抽 packages/rag-core）期间约定 1-2 周，**实验流仅调参不动算法核心代码**。冻结开始/结束必须写入 `session-handoff.md`。
  - **rebase 节奏**：主流程每个 Wave 开始前 rebase main，拉取实验流合入的最新算法。
  - **轨道编号区分**：实验流用 feat-006.x / feat-008.x / feat-009.x（业务段位）；主流程业务用 feat-010~013（业务段位），主流程架构用 feat-100.x（100+ 架构段位）。禁止混用。
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
- `docs/ROADMAP_PHASE2_PLUS.md`：阶段 3-5 的详细路线图与每个 feature 的实施计划（用户故事 / 关键文件 / API 设计 / 验收标准）。
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

## 交付前代码审查（Code Review Checklist）

**每次交付 feature 前必须执行以下审查。** 逐条检查，不符合项必须修复后才能标记 feature 为 done。

### 1. 库优先原则（No Hand-Rolled Libraries）

以下操作**禁止手写实现**，必须使用成熟第三方库：

| 操作类型 | 禁止 | 应使用 |
|---------|------|-------|
| 中文分词 / tokenization | 正则 bigram、空格切分 | `@node-rs/jieba`（已安装）|
| Token 数量估算 | `chars / 4` | `js-tiktoken` |
| 停用词过滤 | 手写 Set（< 100 词）| `stopword`（`zho`/`eng`）|
| BM25 算法 | 手写循环 | `wink-bm25-text-search` 或 `pg_bm25` |
| Markdown → 纯文本 | 多层 regex | `remark` + `strip-markdown` |
| 句子切分 | lookbehind regex | `sbd` |
| API 入参校验 | 手写 `if typeof` | `zod` |
| HTML 检测 | `/<[a-z]/i.test()` | `is-html` |
| 文本相似度（MMR）| 手写 Jaccard | 直接用 pgvector 余弦相似度 |

审查时逐一检查改动文件：**新增的文本处理逻辑是否用了上表中的库？**

### 2. TypeScript 编译通过

```bash
cd app && npx tsc --noEmit
```

无 error，warnings 有合理解释。

### 3. 无静默失败

- `catch` 块不允许只写 `return fallback`，必须同时 `push` 到 `warnings[]` 或 `console.error`
- 异步函数的错误路径必须有可观测的输出（warnings / trace / HTTP 4xx/5xx）

### 4. 停用词和分词一致性

- 若新增了分词或停用词逻辑，检查 `transform/`、`query-rewrite/`、`rerank/` 是否已统一，不允许三处维护三份不同的列表

### 5. 参数类型安全

- `params` 里用到 `Number(x)`、`String(x)`、`Boolean(x)` 的地方，确认 `x` 是非 NaN 的合法值，或加了 `zod` 校验

---

## 完成定义

一个 feature 完成时必须满足：
- [ ] 实现符合选定 feature 的范围。
- [ ] **交付前代码审查（上方 Checklist）已全部通过。**
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
