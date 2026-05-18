# 进度记录

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
