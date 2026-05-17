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
- `feature_list.json` 中 status 为 `epic` 的条目只用于聚合子任务，不作为直接执行对象；实际开发从依赖已满足的最小子 feature 开始。

## 必需资产

- `docs/PRODUCT.md`：产品目标、目标用户、用户流程、项目阶段规划。
- `docs/RAG_PIPELINE_PLAYGROUND.md`：RAG pipeline 分阶段执行和 Playground 功能拆分。
- `docs/ARCHITECTURE.md`：系统边界、数据模型、pipeline 流程。
- `docs/API_CONTRACTS.md`：REST endpoint 请求/响应契约。
- `docs/VERIFICATION.md`：质量门禁和人工验收清单。
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

## 会话结束前

1. 在 `progress.md` 记录已完成工作。
2. 更新 `feature_list.json` 里的相关 feature 状态。
3. 刷新 `session-handoff.md`，写明当前分支/状态、阻塞和下一步。
4. 让仓库保持可重启状态，方便下一个 agent 接手。
