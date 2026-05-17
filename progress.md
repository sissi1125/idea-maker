# 进度记录

## 2026-05-18

### 已完成

- 建立 Marketing RAG Playground 的 harness 基座。
- 记录产品范围、架构、API contracts、验证门禁、feature 状态和 session handoff 机制。
- 将 harness 文档主体改为中文，并在 `AGENTS.md` 加入默认中文维护规则。
- 将 `docs/PRODUCT.md` 从单一阶段范围说明调整为项目整体多阶段规划。
- 按“每次执行一个 RAG pipeline stage + 对应 Playground 功能”的方式细化 `feat-002`、`feat-003` 和 retrieval 相关后续 feature。
- 增加 Playground 可用性门禁：`feat-002.1` 后，每个 stage 交付前必须验证 Playground 仍然可用。
- 补充 Document Upload & Library：上传文档后保存原文和解析前 metadata，页面再次进入时自动加载已上传文档并可选择 document version 作为 pipeline 输入。

### 当前状态

- 仓库尚未初始化为 git repository。
- 暂无应用代码。
- Harness 文件已经定义目标 Next.js、TypeScript、RAG、retrieval 和 marketing generation 边界。

### 下一步建议

启动 `feat-002.1`：脚手架 Next.js Playground shell；随后完成 Document Upload & Library，再按 `docs/RAG_PIPELINE_PLAYGROUND.md` 的顺序逐个 stage 添加 UI 和 API。

### 验证

- 文件创建或修改后运行 `./init.sh`，验证必需 harness 文件和 JSON 结构。
- Playground 搭建后，每个 stage 交付前按 `docs/VERIFICATION.md` 的 Stage 交付门禁记录验证证据。

### 风险 / 备注

- 阶段 1 必须保持 provider 选择显式；用户选择真实 provider 时，不做静默 fallback。
- Storage 主线采用 PostgreSQL + pgvector，adapter 边界仍需清晰，方便后续扩展。
