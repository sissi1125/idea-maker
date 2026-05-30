# feat-300.3 实施规划：AgentRunner（ReAct loop + 可观测 + 错误处理）

> 本文记录 feat-300.3 启动前的完整设计决策与实现细节。
>
> **特别标注「易忽略点」段落 ⚠️ —— 这些是面试常考的工程细节**，而不是显眼的功能模块。

---

## 1. 范围与目标

把 feat-300.1（Schema + LLM 层）和 feat-300.2（8 个 Tools）真正"跑起来"。新增：

- **AgentRunner** — ReAct 主循环：generateText + maxSteps + onStepFinish + budget + 错误处理
- **ContextManager** — 滑动窗口 + 摘要压缩
- **MemoryReader** — 从 agent_memory 表读取，注入 system prompt
- **AgentRunsRepository** — agent_runs / agent_steps 表 CRUD
- **CostTracker** — token → USD 累计 + budget 闸门
- **SpillStorage** — 超阈值落盘机制 ⚠️
- **AgentSseService** — EventEmitter2 包装 SSE 推流（含心跳 ⚠️）
- **AgentController** — POST run / GET stream / GET runs / DELETE abort（含 Abort 机制 ⚠️）
- **Prompt 基础设施** — `definePrompt` + 8 个集中管理的 prompt 文件 ⚠️

不在本期：前端 AgentTracePanel（feat-300.6）/ MemoryDistiller（feat-300.4）/ Eval（feat-300.5）/ read_spill tool。

---

## 2. 已确认的设计决策

| 决策 | 选项 | 理由 |
|---|---|---|
| 输入形态 | 多轮 `messages[]` | ContextManager 真正发挥作用，前端可做完整会话 |
| MemoryReader | 本期真实现 | agent_memory 表已建，读出来即用；distiller 留 300.4 |
| Token 估算 | 字符近似（中文 1.5、英文 4） | 0 依赖，10% 误差对 budget 决策无影响 |
| Budget fallback | 拼已搜到的 chunks | 零额外 LLM 调用，与"超 budget 就别再烧"初衷一致 |
| Generations 联动 | 每次 run 创建 generation 行，source='agent' | 复用现有"生成历史"前端，generations.agent_run_id 关联 |
| 价格表位置 | 硬编码 const PRICING | MVP 友好，LLM 价格不频繁变动 |
| Prompt 重构时机 | feat-300.3 一起做 | 顺手搬迁，避免回头路 |
| Prompt 版本字段 | 带 + 写入 trace | 调试"哪次跑用哪版 prompt"一眼可见 |
| Prompt 可编辑性 | 现在不建，只留 `definePrompt` 拦截点 | YAGNI，未来加 DB override 只动一处 |
| Spill 阈值 | 8KB | 保守，配合 tool 自带截断 |
| read_spill tool | 不预留 | LLM 看 preview 决策，需要再加，半天工作量 |

---

## 3. ⚠️ 易忽略点（面试重点）

### 3.1 Abort 机制 —— "停止"按钮的工程实现

**问题**：用户点"停止"，怎么真正中断 ReAct 循环？

**实现**：
- AgentRunnerService 内部维持 `Map<runId, AbortController>`
- 启动 run 时 `new AbortController()` 放入 map
- 调 `generateText({ abortSignal: controller.signal, ... })` —— ai-sdk 内置支持
- `DELETE /agent/runs/:runId` 端点：查 map → `controller.abort()` → 从 map 删
- finally 块清理 map 条目
- finish_reason 加 `'aborted'`，**DDL CHECK 要 ALTER 扩展**

**面试卖点**：
- 为什么不能直接关闭 SSE 连接？因为后端 generateText 仍在跑，token 仍在烧
- 为什么需要后端 abort 不能只前端关 EventSource？同上
- 为什么用 AbortController 不用 setTimeout/事件总线？AbortSignal 是 web 标准，fetch/ai-sdk 等都原生支持

### 3.2 SSE 心跳（Keepalive）

**问题**：ReAct 一步可能 10 秒（LLM 慢），反向代理（Cloudflare 100s / nginx 60s / Fly.io 60s）默认无数据流就切断。

**实现**：
- AgentSseService 在订阅 Observable 里 `merge(eventStream, interval(15_000).pipe(map(() => heartbeatFrame)))`
- 心跳帧用 SSE comment：`: heartbeat\n\n`（无 `event:` 字段，客户端忽略）
- 沿用现有 `apps/api/src/ingestion/ingestion.controller.ts` 的实现模式

**面试卖点**：
- SSE comment 帧的语法（`:` 开头）—— 比 ping 事件更轻，客户端代码零修改
- 为什么 15s 不是 30s？反向代理默认 30s 起，15s 留余量
- WebSocket vs SSE：WebSocket 内置 ping/pong 协议，SSE 没有 → 必须应用层 keepalive

### 3.3 Tool 输出落盘机制（SpillStorage）

**问题**：search_kb 5×200 = 1KB / search_web advanced 模式可能 30KB / 累积 messages 几步就爆。

**双轨存储**：
| 谁 | 看到啥 |
|---|---|
| LLM 视角（messages） | `{ spilled: true, preview, summary }` —— **无 path** |
| agent_steps.output JSONB | `{ spilled: true, path, size, hash, preview, summary }` —— **含 path** |

**实现**：
- `SpillStorage.spill(payload)`：超 8KB 写 `data/agent-spills/{date}/{uuid}.json`，返回 SpillRef
- `spillIfLarge<T>` helper：tool execute 包一层
- 路径白名单：read 时校验 path 必须在 `data/agent-spills/` 下
- TTL：30 天，cron 留给 feat-300.7

**面试卖点**（这是个加分题）：
- > "为什么 agent 系统需要分级存储？messages 数组每条都被 LLM 重读，token = 钱 + 延迟。但 trace 完整是产品卖点。两者的 tension 通过分级存储解决：messages 存决策足够的预览，磁盘存调试/回放需要的全文。这跟 OS 的 swap、CPU 的多级缓存是同一种思路——按访问频率分层。"
- 为什么 LLM 看不到 path？给了它没读盘工具反而困惑（"为什么有个路径我用不了"）
- 为什么不存 DB 而存盘？大 JSONB 行触发 TOAST，读写慢；磁盘 + path 反查表关联性好。
- hash 干嘛用？同 query 多次落盘可去重（虽然 MVP 不做去重，但 hash 入库未来可加）

### 3.4 Per-step duration 测量

**问题**：`agent_steps.duration_ms` 字段已在 schema，但 ai-sdk 的 `onStepFinish(step)` 不直接给单步耗时。

**实现**：
- AgentRunner 维护 `lastStepEndedAt: number`
- 每次 onStepFinish 触发：`duration = now - lastStepEndedAt; lastStepEndedAt = now`
- 第一步用 `runStartedAt` 当起点

**面试卖点**：
- "可观测性不是免费的——SDK 提供事件钩子但不一定带你想要的元数据，要自己测"
- 为什么不用 `step.experimental_providerMetadata`？字段不稳定且各 provider 差异大

### 3.5 BYOK / Embedding Client 的"组装层"

**问题**：AgentRunner 需要 `llmModel`（给 ai-sdk）+ `embeddingClient`（给 search_kb）+ 解密 BYOK key。三者从哪儿来？

**实现**：
- 复用现有 `apps/api/src/pipeline/providers.service.ts`（pipeline-orchestrator 已用）
- AgentRunner 在 run() 入口调：
  ```
  const settings = await projectsService.getSettings(userId, projectId);
  const llmModel = llmService.create({
    provider: settings.provider,
    apiKey: settings.encryptedApiKey,   // LlmService 内部 decryptApiKey()
    baseURL: ..., model: settings.model,
  });
  const embeddingClient = providersService.createEmbeddingClient(settings);
  ```
- 关键：**不在 AgentRunner 内重写一遍解密 / provider 解析逻辑**

**面试卖点**：
- "组装层（factory / coordinator）和业务逻辑层应该独立。AgentRunner 是 orchestration，BYOK 解密是 secrets management，两个职责分开"
- 现有 pipeline-orchestrator 沿用 providers.service 是先例，agent 跟着同模式 = 行为一致

### 3.6 DB 连接生命周期

**问题**：Agent 一跑 30 秒，期间 8 个 tool 都靠 pgClient。如果占用一个连接 30 秒，pool 容易耗尽。

**待定**：实施时先看 `pipeline-orchestrator.service.ts` 现状。两个方案：
- **A. 整 run 持有一个连接**：简单，事务边界明确；要求 pool size ≥ 最大并发 run 数
- **B. 每个 tool 调用借连接**：资源效率高；要求 8 个 tool 全部重构 ctx.pgClient → ctx.dbService

**面试卖点**：
- "数据库连接是稀缺资源，agent 类长时任务对 pool size 极其敏感"
- pgBouncer 在 session mode vs transaction mode 的差异
- 对应到"连接池调优"：max=20，agent 默认 12 步、每步多次查询，按峰值 5 并发 run 估，prepared statement cache 等等

### 3.7 Tool 输出预先截断（与 spill 互补）

**问题**：spill 是"超了再落盘"的安全网，但**好工程是先在 tool 层主动限**。

**实现**：在 feat-300.2 已有 tool 里加常量
- `search_kb`：max 3 chunks × 200 字
- `search_web`：每条 result.content 截 300 字
- `search_history` / `search_notes`：已经截 300 字（300.2 做了）

**面试卖点**：
- "截断 + spill 是两层防御：截断在源头限制（防止过度获取），spill 在路径上兜底（防止 edge case）。**永远要假设 LLM 会做你没预料的事**"
- 这跟前端"客户端校验 + 后端校验"的双层原则是一样的思路

### 3.8 错误脱敏

**问题**：BYOK key、SQL、stack trace 不能漏给前端。

**实现**：
- 定义白名单异常类：`BudgetExceededError` / `MaxStepsError` / `AbortError` / `ToolValidationError`
- 写 agent_runs.error 时：白名单类→ message 入库；其他→ "Internal error: <eventId>" + 完整 stack 写 NestJS Logger
- SSE 推送的 error 帧也走同一脱敏层

**面试卖点**：
- "对外可见的错误信息和对内的日志要分离，前者面向用户体验和安全，后者面向运维"
- log correlation id（eventId）让用户报错时能反查后端日志

### 3.9 Cost 同时入 agent_runs 和 cost_summary

**问题**：cost_summary 是项目级按天聚合，老 pipeline 已经在写。Agent run 要不要也写？

**实现**：要。AgentRunner finalize 时 UPSERT cost_summary（同 pipeline-orchestrator 的模式）。

**面试卖点**：
- 数据冗余 vs 聚合预计算的权衡
- 为什么不实时从 agent_runs SUM？查询时聚合大表慢，cost 仪表盘加载会卡

### 3.10 Prompt 体系（`definePrompt`）

**核心抽象**：
```ts
PromptDefinition<TInput> { id, version, description, render }
```

**为什么有 version**：未来某次 prompt 改动让 eval 分数掉了，回查 trace 一眼看出"那次用的是 v1，现在 v2 改了什么"。

**为什么有 description**：未来 admin UI 列所有 prompt 可读。

**为什么是函数不是 string**：注入物（memory / platformRules / 早期摘要）按入参动态拼。

**为什么是 `definePrompt` 包装而不是直接 export 对象**：现在是恒等函数，未来加"读 DB override"只改这一处，调用方零改动。

**面试卖点**：
- "prompt 是 LLM 系统的源代码，但项目里通常作为字符串散落各处——这是工程上的不合理"
- 集中管理 + 版本号 + trace 写入 = prompt 像普通源码一样可调试、可回归
- 提到 LangChain 的 LangSmith 也是类似的"prompt 即资产"思路（但他们要付费才能用，我们自建）

---

## 4. 文件清单

```
apps/api/src/agent/
├── agent.types.ts                       # AgentRunInput/Output, ChatMessage, SpillRef
├── agent.module.ts                      # 注册依赖
├── agent.controller.ts                  # HTTP/SSE 端点
├── agent-runner.service.ts              # 主循环
├── agent-runs.repository.ts             # agent_runs / agent_steps CRUD
├── agent-sse.service.ts                 # 沿用 ingestion 模式 + 心跳
├── agent-tools.service.ts               # （已 300.2 建）
├── memory-reader.ts                     # 查 agent_memory 表
├── context-manager.ts                   # 估 token + LLM 压缩
├── cost-tracker.ts                      # PRICING const + add + over(budget)
├── spill-storage.service.ts             # 落盘 + 读盘 + cleanup
├── tools/
│   ├── util/spill-if-large.ts           # tool 用的 spill 包装器
│   └── ...（已 300.2 建的 8 个 tool）
├── prompts/
│   ├── types.ts                         # PromptDefinition + definePrompt
│   ├── index.ts                         # re-export
│   ├── system/
│   │   ├── agent-base.prompt.ts
│   │   ├── memory-injection.prompt.ts
│   │   ├── platform-rules-injection.prompt.ts
│   │   └── compose.ts                   # agentSystemPrompt 组合器
│   ├── tools/                           # 300.2 迁移过来
│   │   ├── generate-draft.prompt.ts
│   │   ├── refine-draft.prompt.ts
│   │   └── critic-review.prompt.ts      # eval-runner 未来也 import 这份
│   └── context/
│       └── compress-summary.prompt.ts
└── __tests__/                           # 每模块的单测
```

---

## 5. 任务分解（含工期）

| # | 任务 | 工期 | 依赖 |
|---|---|---|---|
| 0 | Prompt 体系 + 迁移 300.2 prompt + 5 个新 prompt + 测试 | 0.5d | — |
| 0.5 | Tool 输出截断常量（300.2 tool 改造） | 0.1d | — |
| 0.6 | SpillStorage + spillIfLarge helper + 单测 | 0.4d | — |
| 0.7 | 4 个 search tool 加 spill 包装 + 测试更新 | 0.3d | 0.6 |
| 1 | `agent.types.ts` + `cost-tracker.ts` + 单测 | 0.3d | — |
| 2 | `context-manager.ts`（用 compressSummaryPrompt） + 单测 | 0.4d | 0, 1 |
| 3 | `memory-reader.ts` + 单测 | 0.2d | — |
| 4 | `agent-runs.repository.ts` + DDL CHECK 加 'aborted' + 单测 | 0.4d | — |
| 5 | `agent-sse.service.ts`（含心跳） + 单测 | 0.3d | — |
| 6 | `agent-runner.service.ts` 主循环 + AbortController 接线 + per-step duration + 错误脱敏 + 单测 | 1.5d | 0-5 + 300.2 |
| 7 | `agent.controller.ts`：POST run / GET stream / GET run / GET steps / GET spill / DELETE abort | 0.5d | 6 |
| 8 | AgentModule 注册 + smoke 跑通 + 面试题 | 0.3d | 7 |

**合计：5 天**

---

## 6. HTTP 接口契约

```
POST /projects/:pid/agent/run
  body: { messages: [{role,content}], budgetUsd?, maxSteps?, modelOverride? }
  返回: 201 { runId, generationId }
  （不直接走 SSE，因为 POST body + EventSource 不兼容；启动后客户端再连 GET 流）

GET /projects/:pid/agent/runs/:runId/stream  [SSE]
  事件类型:
    event: step          { stepIndex, step_type, tool_name?, input, output, usage, duration_ms }
    event: cost          { usedUsd, percentBudget, stepIndex }
    event: finish        { runId, generationId, finishReason, text }
    event: error         { code, message, eventId }
    : heartbeat          (every 15s, SSE comment)

GET /projects/:pid/agent/runs/:runId
  返回 run 元数据（status / finish_reason / 步数 / 成本 / 时间）

GET /projects/:pid/agent/runs/:runId/steps?limit=&offset=
  返回完整 trace 数组（前端断线重连 / 历史回放）

GET /projects/:pid/agent/runs/:runId/steps/:stepIndex/spill
  返回该 step 落盘的完整 payload（路径白名单校验）

DELETE /projects/:pid/agent/runs/:runId
  Abort 运行中的 run。返回 204。
```

---

## 7. 测试覆盖目标

- **单测**：每模块独立 mock
  - AgentRunner：mock generateText 验证 onStepFinish 入库 / budget cap / fallback 路径 / abort 路径 / maxSteps 路径
  - ContextManager：阈值触发 / 压缩 LLM 调用 / 摘要拼接
  - CostTracker：累计 + over 判断 + 不同 provider 价格
  - SpillStorage：< 阈值不落 / 超阈值落 / read 路径校验 / cleanup
  - MemoryReader：空 memory / 4 类拼接顺序
  - Prompt：每个 prompt 一个快照测试，断言关键片段（包含 memory / 包含 rules）

- **集成**（手工跑通 + smoke.mjs 后续接 300.7）：
  - 一条 query 跑完整 ReAct，断言 agent_steps ≥ 3，finish_reason='done'
  - 配 budget=$0.001 验证 fallback
  - 配 maxSteps=2 验证 max_steps 路径
  - 跑一半 DELETE 验证 aborted

---

## 8. 不在本期范围 & 已知的"未解决"开放点

**不在本期**：
- 前端 AgentTracePanel（feat-300.6）—— 后端只保证 SSE 帧可用 curl -N 验证
- MemoryDistiller（feat-300.4）—— MemoryReader 真实现，distill 写入路径留空
- Eval suite（feat-300.5）
- read_spill tool
- Spill 文件 TTL cron job（cron 配置留 feat-300.7）
- 老 generations 路由的 agent_mode toggle —— 单独新 endpoint，老的不动
- LangGraph 等价文档（feat-300.7）

**开放点（实施时再定）**：
- DB 连接生命周期：任务 4 时看 pipeline-orchestrator 现状再决定 A/B 方案
- ai-sdk 在 maxSteps 用尽时具体 finishReason 值（要写单测确定）
- Spill 文件去重（hash 已入库但本期不查重）

---

## 9. 风险与对冲

| 风险 | 对冲 |
|---|---|
| ReAct 死循环 | budget + maxSteps 双闸门 |
| 反向代理超时切 SSE | 15s 心跳 |
| pg 连接池耗尽 | 任务 4 决策时确认 + 环境变量 POOL_MAX 调到 20 |
| BYOK key 经 trace 泄露 | 错误脱敏 + Logger 不打 settings 对象全文 |
| Tool 返回过大 | tool 层截断 + 8KB spill 双层 |
| Prompt 改回归 | 版本号 + trace + （feat-300.5）eval 把关 |
| ai-sdk API 变 | 把 generateText 调用包到 AgentRunner 一处，升级集中改 |

---

## 10. 面试题预埋清单

`feat-300.3.md` 面试题计划覆盖：

1. ReAct 原理（论文核心 + 与 CoT 的区别）
2. AbortController 在长任务取消中的作用 ⚠️
3. SSE keepalive 必要性 + 实现 ⚠️
4. 分级存储模式（spill）的工程价值 ⚠️
5. 长任务的 DB 连接管理 ⚠️
6. Per-step duration 为什么要自己测 ⚠️
7. 错误脱敏 vs 完整日志的边界 ⚠️
8. Prompt 集中管理 + 版本号 ⚠️
9. Budget cap 实现细节 + 为什么不用 setTimeout
10. Context compression 与 Memory（L2）的区别（架构 doc 已有）

⚠️ = 这次规划阶段挖出来的"易忽略点"，是最有差异化的面试加分项。
