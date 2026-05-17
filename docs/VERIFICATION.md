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

## RAG 质量检查

数据路径存在后，跟踪这些指标：

- Chunk 后的 chunk count 和 token estimate。
- 基于 SHA-256 的重复文档检测。
- 针对 curated test queries 的 retrieval hit rate。
- 生成卖点和 ideas 的 evidence coverage。
- 抽查 source refs 的 citation correctness。
- 每个 pipeline step 的 latency。
- Provider 错误码覆盖：`provider_missing_api_key`、`provider_unavailable`、`provider_model_not_found`、`provider_not_configured`。
