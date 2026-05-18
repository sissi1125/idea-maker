# 会话交接

## 最后更新

2026-05-18（会话 3）

## 项目

Marketing RAG Playground：一个可调试的 RAG 驱动产品运营 idea 生成系统。

## 当前状态

- `feat-002.1`、`feat-002.2`、`feat-002.3`、`feat-002.4` 已完成（`status: done`）。
- 应用在 `app/` 目录（untracked），待 commit。
- 三栏 Playground 工作台可正常运行：stage 切换、method selector、params 表单、run button、output/trace 面板均已实现。
- 所有 13 个 stages 的 methods + params schema 已在 `app/lib/stageRegistry.ts` 定义。
- TypeCheck 通过（无报错）。
- run button 调用 `/api/pipeline/{stageId}` POST；API 路由尚未实现，返回 network_error（符合预期）。

## 下一步

1. Commit 当前变更（feat-002.1 ～ feat-002.4 完成）。
2. 实现 `feat-002.5` Document Upload & Library：
   - 支持 MD/TXT/PDF 上传或粘贴文本。
   - 保存 fileName、fileSize、mimeType、hash、version、createdAt 等 metadata。
   - 页面加载时自动显示已上传文档列表；用户选择 document version 后解锁后续 stages。
3. 实现 `feat-002.6` Pipeline 上下文与产物传递。
4. 随后实现 feat-003.x RAG ingestion stages（需要数据库：PostgreSQL + pgvector）。

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
