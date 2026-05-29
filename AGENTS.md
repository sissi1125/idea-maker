# AGENTS.md

**Idea-Maker**：面向独立开发者和小团队的**营销 idea 生成系统**。核心价值：**透明可观测 RAG + 成本追踪 + 反馈学习**。

当前阶段：**Phase 3.5 真 Agent（feat-300）**。架构详见 `docs/agent/ARCHITECTURE.md`。

## 启动流程

1. 本文件（工作规则）
2. `docs/PRODUCT.md` — 产品定位与阶段规划
3. `docs/agent/ARCHITECTURE.md` — Phase 3.5 Agent 架构（当前阶段）
4. `feature_list.json` — 确认当前 feature 的 dependencies 和 scope
5. `session-handoff.md` — 上次会话状态
6. `./init.sh` — 验证环境

## 中文优先

本系统处理中文内容，所有文本处理默认以中文为第一优先级：

- **分词**：必须用 `@node-rs/jieba`，禁止空格切分
- **Embedding 默认模型**：`text-embedding-v4`（Qwen）或 `BAAI/bge-m3`，禁止 `-en-` 后缀模型
- **Reranker 默认模型**：`BAAI/bge-reranker-v2-m3`
- **chunk separators**：必须包含 `"。" "！" "？" "；"`
- **LLM prompt**：默认中文

新增文本处理逻辑时 Code Review 必查：该实现对全中文段落（无空格、无英文）是否正确？

## 代码规范

- 所有方法实现必须加中文注释，解释原理和技术选型，面向"正在学习 RAG 的读者"
- 每完成一个 feature，在 `.interview/<feat-id>_<topic>.md` 写 3-5 道面试题及答案
- 一次只做一个 feature，改动限制在当前 feature 范围内
- 每个生成结果必须能追溯到 evidence chunk IDs
- 不要把内部过程藏成黑盒，核心价值是可调试

## Feature 状态

`feature_list.json` 只允许：`epic` / `todo` / `in-progress` / `blocked` / `done` / `superseded`

## 完成定义

- [ ] 实现符合当前 feature 的 scope
- [ ] `pnpm -r typecheck` + lint 通过
- [ ] API/schema 变更同步到 `docs/API_CONTRACTS.md`
- [ ] `feature_list.json` 状态和 evidence 已更新
- [ ] `progress.md` 记录了改动、验证结果和下一步

## 会话结束前

1. 更新 `progress.md`（已完成工作 + 验证结果）
2. 更新 `feature_list.json` 相关状态
3. 刷新 `session-handoff.md`（当前分支/状态、阻塞、下一步）

---

## Phase 3.5 真 Agent 开发规范（feat-300）

> 架构详见 `docs/agent/ARCHITECTURE.md`。以下只列影响每个 PR 决策的硬规则。

- **边界**：`pipeline-orchestrator/` 保持不动；feat-300 新建 `agent/` 模块，不允许在代码里写死 tool 调用顺序
- **可观测**：`onStepFinish` 必须写 `agent_steps` 入库，不允许有 invisible step
- **安全阀**：budget_usd + max_steps 超限必须触发 fallback，不能让 agent 无限跑
- **技术栈**：LLM 调用统一走 `LlmService`（ai-sdk），不允许直接 fetch；不引 LangGraph 进生产代码
- **改 prompt / tool description 后**：必须跑 `pnpm eval` 验证不退化
