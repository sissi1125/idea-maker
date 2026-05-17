# 会话交接

## 最后更新

2026-05-18

## 项目

Marketing RAG Playground：一个可调试的 RAG 驱动产品运营 idea 生成系统。

## 当前状态

- Harness 基座已经创建。
- 产品阶段规划和当前阶段边界已经文档化。
- Harness 文档主体已改为中文。
- `feat-002` 和 `feat-003` 已细化为按 RAG stage 逐步交付的 feature 列表。
- 已新增 Playground 可用性门禁：`feat-002.1` 后，每个 stage 交付前必须验证 Playground 仍然可用。
- 已补充 Document Upload & Library：上传文档入库保存，下次进入页面自动加载并可选择历史文档版本。
- Git repository 已初始化，当前分支为 `main`。
- Harness 基座已提交：`44306a5 Initialize harness foundation`。
- 尚未脚手架应用代码。
- 当前 working tree 应保持干净；如果后续修改文档或代码，结束前需要更新本文件和 `progress.md`。
- `AGENTS.md` 已新增 git/lifecycle 状态同步约束：发生 `git init`、commit、branch/tag 变化、应用脚手架完成、dev server 启停方式变化、feature 完成或阻塞后，必须同步 `progress.md` 和本文件。

## 下一步

实现 `feat-002.1`：脚手架 Next.js TypeScript app，并构建第一个可用的 Playground 页面：

- 左侧：pipeline steps。
- 中间：选中 step 的 method 和 params。
- 右侧：output preview 和 trace。

随后按 `docs/RAG_PIPELINE_PLAYGROUND.md` 逐个实现：先 Playground 基础能力和 Document Upload & Library，再 idempotency、preprocess、chunk、transform、embedding、storage。

## 重要边界

- 阶段 1 是 Playground，不是 SaaS。
- Embedding、rewrite、rerank 必须走显式 provider 选择；缺少配置时返回明确错误码，不静默 fallback。
- 每个生成的 selling point 和 idea 都必须包含 evidence references。
- Playground 搭建后，每个 stage 交付不能只交付 API；必须同时验证 UI 可打开、可切换、可运行、可查看 output/trace。
- RAG pipeline 的第一个输入来自已选择的 document version；未选择文档时，ingestion stages 必须展示阻塞原因。
- 任何 git/lifecycle 状态变化后，最终回复前必须先同步 `progress.md` 和本文件。
- 结束较大开发会话前，更新 `feature_list.json`、`progress.md` 和本文件。
- 项目文档、进度记录、交接说明和面向后续 agent 的说明默认使用中文。

## 验证

运行：

```bash
./init.sh
```

应用脚手架存在后，扩展 `init.sh`，加入 install、lint、typecheck、test 和 build 命令。
