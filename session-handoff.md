# 会话交接

## 最后更新

2026-05-18（会话 4）

## 项目

Marketing RAG Playground：一个可调试的 RAG 驱动产品运营 idea 生成系统。

## 当前状态

- `feat-002.1` ～ `feat-002.5` 全部完成（`status: done`）。
- 文档持久化：`app/data/documents.json`（本地 JSON，dev 环境，后续替换为 PostgreSQL）。
- 选中文档后 pipeline 解锁，stage 方法配置和 run button 可用。
- 待 commit：feat-002.5 新增文件（docStore.ts、API routes、DocumentUploadPanel）+ harness 文件更新。

## 下一步

1. Commit feat-002.5。
2. 实现 `feat-002.6` Pipeline 上下文与产物传递：
   - 上游 stage 成功 output 作为下游 inputRef。
   - 下游缺少 inputRef 时展示阻塞原因（而非 BlockedNotice on 文档缺失）。
   - 上游重跑后，下游提示"上游 input 已变化，请重新运行"。
3. 随后实现 feat-003.x RAG ingestion stages API（需要数据库：PostgreSQL + pgvector）。

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
