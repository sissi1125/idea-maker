# 验证说明

## 当前 Harness 检查

运行：

```bash
./init.sh
```

当前检查会确认必需 harness 文件存在，并验证 `feature_list.json` 是合法 JSON。

## 后续应用检查

Next.js app 存在后，`init.sh` 应运行：

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

使用仓库中已经采用的 package manager。

## 阶段 1 人工验收

- `localhost:3000` 能打开 RAG Pipeline Playground。
- 页面进入后自动加载已上传文档列表。
- 用户可以上传 MD/TXT/PDF 或粘贴文本创建文档，并在上传后立即选择该文档。
- 刷新页面后，已上传文档仍可选择，选择后能作为 pipeline inputRef。
- 左侧面板列出 ingestion、retrieval 和 marketing generation steps。
- 选择 step 后，中间面板显示 method 和 params。
- 运行 step 后，右侧面板产生 output 和 trace。
- Mock embedding 路径不需要网络和 API keys 即可运行。
- Embedding provider 选择 OpenAI、HF TEI、HF Transformers.js 或 debug deterministic 时，输出 provider、model、dimension、latency 和错误码。
- Retrieval 链路按 query rewrite、retrieval、filter、rerank、citation 分阶段展示 query、topK、threshold、matched chunks、scores、source refs 和 provider trace。
- Product profile、selling points 和 ideas 包含 evidence chunk IDs。
- Evidence 较弱或缺失时，系统返回 warning，而不是自信地产生无依据声明。

## Stage 交付门禁

`feat-002.1` 搭建 Playground 之后，每个 RAG stage 或 Playground 子功能交付前都必须验证 Playground 可用。交付证据至少包含：

- `localhost:3000` 可访问，页面无空白和阻断性错误。
- 左侧 stage 列表可切换，当前 stage 高亮正确。
- 已完成的上游 stages 仍可查看配置、output 和 trace。
- 新增 stage 可以选择 method、编辑 params、执行 run，并展示 success/error、duration、warnings、error code 和 trace。
- 下游 stage 在缺少 inputRef 时展示阻塞原因，而不是静默失败。
- 文档库可加载已上传文档；没有选择 document version 时，ingestion stages 显示阻塞原因。
- 验证结果写入 `progress.md`，对应 feature 的 evidence 写入 `feature_list.json`。

## 阶段 3 MVP 每周末验收（feat-200.1~8）

每个 Week 完成时必须跑完以下 5 步，结果写入 `progress.md` 和当周 feature 的 evidence 字段：

1. **Scope 验收（防止越界）**：当周只动当周范围内的代码；非当周功能（即使代码框架已有）不实现。检查 git diff 不包含未来 Week 的目录。
2. **端点 / 页面验收**：用 Postman（Week 1-4 后端周）或浏览器（Week 5-8 前端周）跑通当周的核心用例。
3. **测试验收**：`pnpm --filter @harness/api test:e2e` 后端 e2e 通过；前端用 Playwright（Week 6 起）跑 smoke test。
4. **类型 / Lint 验收**：`pnpm -r typecheck && pnpm -r lint` 全过。
5. **成本追踪验收（Week 3+）**：mock LLM 调用回 `usage.total_tokens`，确认 `cost_breakdown` 数值与累计逻辑正确。

### 每周验收清单

| Week | 验收清单 |
|------|---------|
| 1 (feat-200.1) | Postman 跑通 `/auth/{login,register,me}` + `/projects` CRUD + `/projects/:id/settings`；`TracingInterceptor` 在每个请求注入 traceId 可见 |
| 2 (feat-200.2) | 上传 PDF，前端用 curl 轮询 SSE 进度从 0→100；ingestion_jobs 表有完整状态记录 |
| 3 (feat-200.3) | mock LLM key 跑通一次 `/projects/:id/generate`，返回 JSON 含 `pipeline_trace`（intent/retrieval/stages[]/evaluation）+ `cost_breakdown` |
| 4 (feat-200.4) | 上传后自动触发 intro + compete 两张卡片生成；feedback 写入后能 GET 出来；cost_summary 按日聚合正确 |
| 5 (feat-200.5) | 浏览器走通"登录 → 看项目列表 → 建项目 → 切换项目"；zustand store 持久化 `currentProjectId` |
| 6 (feat-200.6) | 端到端跑通"传文档 → 自动卡片 → 提问 → 看 PipelineTrace → 看结果"；4 阶段进度可视化正确 |
| 7 (feat-200.7) | 反馈后能在历史看评分；笔记加入库后能按 tag/channel 筛选；Settings BYOK 加密存储且日志不泄露 |
| 8 (feat-200.8) | MVP 7 个成功指标全勾选；平台规则 violations 提示正确；部署到 Fly.io 测试环境可公网访问 |

### Scope Control 红线（每周末检查）

- ❌ 当周不允许引入 Phase 3.5 真 Agent 概念（LLM 决策、ReAct 循环、自评估迭代）
- ❌ 当周不允许把 Phase 4 Studio / Phase 5 Auth 替换 / 多租户 提前
- ❌ 不允许在 RAG 算法层做改动（属于 B-experiment 轨道，需独立 PR）
- ✅ 仅当周 feat-200.N 描述内的范围；提前为下周写的代码（如 stub 接口）需在 PR 说明中标注"Week N+1 占位"

## RAG 质量检查

数据路径存在后，跟踪这些指标：

- Chunk 后的 chunk count 和 token estimate。
- 基于 SHA-256 的重复文档检测。
- 针对 curated test queries 的 retrieval hit rate。
- 生成卖点和 ideas 的 evidence coverage。
- 抽查 source refs 的 citation correctness。
- 每个 pipeline step 的 latency。
- Provider 错误码覆盖：`provider_missing_api_key`、`provider_unavailable`、`provider_model_not_found`、`provider_not_configured`。
