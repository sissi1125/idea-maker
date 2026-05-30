# feat-300.3 面试题：AgentRunner ReAct 主循环 + 工程化细节

> 本期把 feat-300.1（schema）+ 300.2（tools）真正跑起来。10 个 ⚠️ 易忽略点在
> docs/agent/feat-300.3-plan.md §3 中明列，每点都是面试差异化加分项。
>
> 下面 10 道题对应该规划，按重要程度排序。

---

## Q1：ReAct 原理与 Chain-of-Thought 的本质区别？

**考点**：理解 agent 与 prompting 技巧的边界。

参考答案：
- CoT（Yao Wang 2022）= **只在 prompt 中加"let's think step by step"**，LLM 输出仍是一次性的纯文本，没有外部交互。"想"是单向的、自闭的。
- ReAct（Yao 等 2022 同年）= **Reasoning + Acting 交错循环**：LLM 输出 "Thought → Action（选择 tool + 参数）→ Observation（tool 返回）→ Thought ..."，直到自主停止。"想"和"做"互相反馈。
- **决定性差异**：CoT 的 LLM 不知道外部状态；ReAct 的 LLM 拿到 observation 后会调整下一步。这是"是否真 agent"的分界。

**项目里的体现**：我们用 ai-sdk 的 `generateText({ maxSteps, tools, toolChoice: 'auto' })` 自动跑 ReAct loop，`onStepFinish` 拿到每一步的 reasoning + tool calls + observations。

---

## Q2：为什么需要 AbortController？前端关 EventSource 不就够了吗？⚠️

**考点**：长任务取消的工程深度。

参考答案：
- **前端关 EventSource 只关了 SSE 通道**——后端 generateText 仍在跑，token 仍在烧。用户以为停了，账单还在涨。
- AbortController 是真正的中断信号：
  - 进程内 `Map<runId, AbortController>` 维护活跃 run
  - `DELETE /runs/:id` 端点查 map → `controller.abort()` → ai-sdk 的 `abortSignal` 触发 → 主循环里 catch AbortError
- agent_runs.finish_reason 加 `'aborted'` 状态（DDL DROP + ADD CHECK 实现兼容老库的迁移）
- **多实例风险**：进程内 map 跨实例无效，未来需 Redis pub/sub 或粘性路由

**项目里的体现**：`AgentRunnerService.abort(runId)` 暴露给 controller；handleError 里的 `isAbortError` 检测 err.name === 'AbortError'。

---

## Q3：SSE 心跳保活为什么必须有？怎么实现？⚠️

**考点**：SSE 在反向代理下的现实问题。

参考答案：
- SSE 默认无活动 60s 被反向代理（Cloudflare/Nginx/Fly.io）切断。ReAct 一步可能 10s，多步中间静默期超过代理超时。
- 实现：每 15s 发一个 keepalive 帧。
- 我们用 RxJS `interval(15_000)` + `merge` 业务流；客户端按 `type='keepalive'` 选择性忽略。
- **比 WebSocket 简单**：WebSocket 协议有 ping/pong 内置帧；SSE 必须应用层做。
- 用 SSE comment（`: heartbeat\n\n`）更轻但 NestJS @Sse 不直接支持，类型化帧效果等价。

**项目里的体现**：`AgentSseService.subscribe(runId)` 内部 `merge(...event流, keepalive$)`。

---

## Q4：分级存储（Spill）的工程价值？设计原则？⚠️

**考点**：能否系统化思考 LLM/messages 的 token 经济。

参考答案：
- messages 数组每条都被 LLM 重读，token = 钱 + 延迟。但 trace 完整记录是产品卖点。
- **二者矛盾通过分级存储解决**：
  - messages 存"决策足够的预览"（preview 500 字 + summary）
  - 磁盘存全文（trace 回放 + eval + admin 查看用）
- **类比 OS swap / CPU 多级缓存**——按访问频率分层
- 双轨语义：LLM 视角无 path（避免"有路径却用不了"的认知负担），agent_steps 视角带 path
- **不预留 read_spill tool**（YAGNI）：本期 LLM 只看 preview，未来 eval 发现质量下降再加

**项目里的体现**：`SpillStorage` 8KB 阈值；`spillIfLarge` helper 在 tool 层包一层；`__trace` 隐藏字段由 AgentRunner.onStepFinish 剥到 `agent_steps.output._spill`。

---

## Q5：Per-step duration 为什么 ai-sdk 不直接给？怎么测？⚠️

**考点**：可观测性不是免费的，要主动测。

参考答案：
- ai-sdk 的 `onStepFinish(step)` 给 step 元数据（text/toolCalls/toolResults/usage）但 **不带 duration**——因为 SDK 不知道你想从哪个时间点开始算。
- 自测：AgentRunner 维护 `lastStepEndedAt: number`，每次 onStepFinish 算 `now - lastStepEndedAt`。
- **写到 agent_steps.duration_ms 字段**，前端 trace 时间轴可显示。
- 第一步用 `runStartedAt` 当起点。
- 不用 `step.experimental_providerMetadata`：字段不稳定 + 各 provider 差异大。

---

## Q6：DB 连接生命周期：长任务怎么管 pg 连接？⚠️

**考点**：连接池调优 + 资源稀缺意识。

参考答案：
- Agent run 跑 30s，期间 8 个 tool 都靠 pgClient。两个方案：
  - **A. 整 run 持有一个连接（我们选了 A）**：简单、事务边界明确；要求 pool size ≥ 最大并发 run（POOL_MAX env 调到 20）
  - B. 每个 tool 调用借/还连接：资源效率高；要求 8 个 tool 全部重构（成本大）
- **A 的实现**：Controller 用 `DbService.withClient(pgClient => runner.run(pgClient, input))` 包整个 run。
- 进阶问题：**pgBouncer session mode vs transaction mode**——transaction mode 在 session 中间 ROLLBACK 后会复用连接给别人，prepared statement / temporary table 等会丢，不能用。session mode 安全但池利用率低。

---

## Q7：错误脱敏 vs 完整日志的边界在哪？⚠️

**考点**：用户体验 + 安全 + 运维三角的平衡。

参考答案：
- **对外（response / SSE 帧）**：白名单异常类（`BudgetExceededError` / `AbortError`）保留语义；其他归一为 `Internal error: <eventId>`，eventId 是 8 位随机短码。
- **对内（Logger）**：完整 stack + 原始 error.message 写日志，便于运维查。
- **优势**：用户报错时说 "我看到 Internal error: a1b2c3d4"，运维 grep 日志反查根因。
- 错误信息可能含 BYOK key、SQL fragment、内部 path——不脱敏直接漏给前端是合规事故。
- **黑名单 vs 白名单**：必须用白名单（已知安全才透传），不能黑名单（永远漏过新型敏感字段）。

**项目里的体现**：`AgentRunnerService.handleError` 走 isAbortError / BudgetExceededError 分类，其他 → `Internal error: ${eventId}`。

---

## Q8：Prompt 集中管理的设计动机？definePrompt 为什么是函数？⚠️

**考点**：把 prompt 当源码工程化的意识。

参考答案：
- **现状反例**：prompt 散落在 8 个 tool 文件 + runner + context-manager 里，改一处忘了另一处 → 行为分叉。
- **集中后收益**：
  1. **eval 复用**：feat-300.5 离线 eval-runner import 同一个 `criticReviewSystemPrompt`，行为 1:1 不漂移
  2. **版本化**：每个 prompt 带 `id + version`，agent_steps trace 里记录 promptId/promptVersion，"那次跑用的是哪版"一眼可查
  3. **未来可编辑**：`definePrompt` 现在是恒等函数，未来要 DB override 只改一处包装，调用方零改动（**这是最重要的——预留拦截点是 1 行换 50 行重构成本**）
- 函数而非字符串：注入物（memory / rules / 上文摘要）按入参动态拼
- 不引模板引擎（Mustache/Handlebars）：TS 模板字符串可读、可 IDE 跳转、git diff 清晰

**项目里的体现**：`apps/api/src/agent/prompts/` 8 个 .prompt.ts + 1 个 compose.ts（组合器）。

---

## Q9：Budget cap 实现的关键工程点？

**考点**：成本控制的工程实现。

参考答案：
- 数据流：`onStepFinish(step)` → `CostTracker.add(step.usage)` → if `over(budget)` throw `BudgetExceededError`
- `BudgetExceededError` 独立异常类（不是 generic Error）便于 `instanceof` 分支
- 价格表硬编码（MVP）：`PRICING: Record<modelName, { inputPer1k, outputPer1k }>`，CNY→USD 7.2 汇率注释里标
- 未知 model 走 fallback 价格 + warn 日志，**不抛错**（agent 仍能跑完，成本估算偏差但不影响功能）
- 后缀匹配：`gpt-4o-mini-2024-07` 也命中 `gpt-4o-mini`
- catch BudgetExceededError 后走 fallback：扫 agent_steps 里 search_kb/search_web 的 chunks 拼 markdown，**不再调 LLM**（不能违反"超 budget 就别再烧"的初衷）

---

## Q10：Context compression 与 Memory 的本质区别？

**考点**：作用域和持久化的双维度区分。

参考答案：

|  | 上下文管理（ContextManager） | Memory（L2，agent_memory 表） |
|---|---|---|
| **作用域** | 单次会话内的工作记忆 | 跨会话的长期偏好 |
| **载体** | messages 数组（内存） | agent_memory 表（持久化） |
| **更新时机** | 对话进行中自动触发（每轮检查阈值） | feedback 后 distill 触发（feat-300.4） |
| **内容** | 本次对话说了什么 | 用户一贯喜欢什么 |
| **生效方式** | 摘要追加到 system prompt 末尾 | 4 类（preference/style/taboo/audience）注入到 system prompt 中段 |

**触发阈值**：OR 语义——token > 8000 **或** messages 数 > 12 任一即压缩，防止"少量超长 messages"与"大量短 messages"两种边界都失控。

**Token 估算**：字符近似（中文 1.5、英文 4 字符/token + 4 token/条 overhead），0 依赖，对触发判断够用——10% 误差不影响阈值判断。

---

## 自查清单

- [x] 8 个任务模块全部建好：types / cost / context / memory / repo / sse / runner / controller
- [x] DDL 加 'aborted' + 兼容老库迁移
- [x] Prompt 集中管理（10 个 prompt 文件 + composer + index）
- [x] Tool 截断常量 + spill 二层防御
- [x] AbortController + per-step duration + 错误脱敏 + SSE 心跳
- [x] 单测覆盖 158 用例：done / budget / max_steps / abort / error / compression 全路径
- [x] AgentModule 注册依赖 + AppModule 引入
- [x] 面试题 10 道（含 ⚠️ 8 个易忽略点）
- [x] **TODO 全部 done**：PlatformRulesService 集成（TODO a）/ cost_summary 聚合（TODO b）/ project name 注入（TODO c）
- [ ] **延后**：pg.Pool 改造（TODO d，运维侧，等流量起来再做）
