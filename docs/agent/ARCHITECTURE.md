# Phase 3.5 真 Agent 架构设计（feat-300）

## Context

MVP 8 周（feat-200.x）交付了完整的 PDF → 异步 ingestion → 11-stage YAML pipeline → 生成 → 反馈 → 笔记库闭环。但现有架构本质上是一个**确定性 Pipeline**：执行顺序由开发者在 YAML 里写死，LLM 只在每个 stage 内部填内容，不做任何"下一步做什么"的决策。这不是 Agent。

**Pipeline vs Agent 的本质区别（工业界定义）：**

> Agent 的核心是：LLM 自主决定"下一步做什么"——选择调用哪个 tool、决定是否需要再查一次、判断当前信息是否足够、决定何时停止。执行路径是 **emergent（涌现）** 的，开发者事先不知道具体会走哪几步。

Phase 3.5 要做的三件事：
1. **真 ReAct Agent**（Yao et al. 2022）：LLM 掌控执行路径，RAG 降级为按需调用的 tool
2. **记忆与学习闭环**：`feedbacks` 表数据 → MemoryDistiller → 偏好注入 system prompt，让"越用越懂你"从口号变成可追踪的代码路径
3. **Agent 评估体系**：离线 eval suite（LLM-as-judge + golden dataset）+ 在线 runtime 评估 + 人工反馈，三层量化 agent 质量

**技术选型：** Vercel ai-sdk（仅用 LLM/tool 抽象层）+ 自建 agent loop / memory / eval。不引 LangChain / LangGraph 进生产，单独出 LangGraph 平行实现文档用于学习对比。Tavily 接 web search。

---

## 整体架构

```
用户 query
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    AgentRunner (ReAct Loop)                   │
│                                                               │
│   System Prompt = base_instructions + injected_memory(L2)    │
│                                                               │
│   while not done AND steps < maxSteps AND cost < budget:      │
│     1. generateText(messages, tools, toolChoice='auto')       │
│        ↳ onStepFinish → agent_steps 入库 + SSE emit          │
│     2. if toolCalls → executeTool(s) → append observations   │
│     3. if no toolCalls → agent decided to finish              │
│                                                               │
│   fallback if budget/steps exceeded                           │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────────┐      ┌──────────────────────────┐
│     Tools（8个）      │      │     Memory Subsystem      │
├─────────────────────┤      ├──────────────────────────┤
│ search_kb           │      │ agent_memory 表            │
│ search_web (Tavily) │      │ MemoryReader               │
│ search_notes        │      │   → 注入 system prompt     │
│ search_history      │      │ MemoryDistiller            │
│ generate_draft      │      │   ← feedbacks 表（输入）   │
│ critic_review       │      │   → agent_memory（输出）   │
│ refine_draft        │      └──────────────────────────┘
│ log_decision        │
└─────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│   LLM Layer（Vercel ai-sdk）                              │
│   createOpenAI({ baseURL, apiKey })  ← BYOK 解密注入     │
│   generateText / streamText / tool()                     │
└─────────────────────────────────────────────────────────┘
```

**RAG 在 Agent 里的定位：** `search_kb` 是 agent 按需调用的工具，不是每次都走的强制路径。agent 可以不检索（简单问题），也可以检索 3 次（复杂问题）。rag-core 的实现代码全部复用，调用方从"pipeline orchestrator 按序调"变成"tool execute 内部调"。

**rag-core 各 stage 的命运：**

| 原 Stage | Agent 里变成 |
|---|---|
| `retrieval` + `filter` + `rerank` + `citation` | 打包进 `search_kb` tool |
| `query-rewrite`, `intent-recognition` | 溶解进 agent reasoning（LLM 自然处理） |
| `context-management` | 移进 agent runner `compressHistory()` |
| `prompt-build` | `generate_draft` tool 的内部实现 |
| `generation` | `generate_draft` tool |
| `evaluation` | `critic_review` tool（agent 决定调不调、调几次） |
| `fallback` | agent runner 的兜底逻辑，不再是 LLM 决策的 stage |

---

## 数据库 Schema（[apps/api/src/db/schema.ts](apps/api/src/db/schema.ts)）

新增 3 张表：

**`agent_runs`**
```
id, generation_id FK, status, max_steps, budget_usd,
steps_used, cost_used_usd, finish_reason
('done'|'max_steps'|'budget'|'error'),
created_at, finished_at
```

**`agent_steps`**（透明可观测的物理实现）
```
id, run_id FK, step_index,
step_type ('reasoning'|'tool_call'|'tool_result'|'finish'),
tool_name, input JSONB, output JSONB,
token_usage JSONB, duration_ms, created_at
```

**`agent_memory`**
```
id, project_id FK,
kind ('preference'|'style'|'taboo'|'audience'),
content TEXT,
source ('manual'|'distilled'),
source_feedback_ids JSONB,
confidence FLOAT,
created_at, updated_at
```

`generations` 加列：`agent_run_id UUID NULL`。

---

## 模块详细设计

### A. LLM 层（[apps/api/src/llm/](apps/api/src/llm/)）

新文件 `llm.service.ts`：统一封装 BYOK provider 创建，替换 rag-core 里 7 处手写 fetch。

```ts
// 解密用户 BYOK key → createOpenAI({ baseURL, apiKey })
// 暴露 create(config): LanguageModelV1
// 支持多 provider：智谱 / SiliconFlow / OpenAI 兼容均可
```

新文件 `tavily.client.ts`：封装 Tavily search API，30 天 LRU 缓存防重复消耗，无 key 时降级返回 `unavailable`。

新增依赖：`ai`、`@ai-sdk/openai`、`zod`（已有可复用）。

---

### B. Agent Core（[apps/api/src/agent/](apps/api/src/agent/)）

#### B1. Tools（[agent/tools/](apps/api/src/agent/tools/)）

8 个 tool，每个用 `ai-sdk` 的 `tool({ description, parameters: zod, execute })` 定义：

| Tool | execute 委托给 | 参数 |
|---|---|---|
| `search_kb` | rag-core retrieval → filter → rerank → citation | `{ query, topK?, category? }` |
| `search_web` | TavilyClient | `{ query, maxResults? }` |
| `search_notes` | notes.service + pgvector | `{ query, tags? }` |
| `search_history` | generations.service | `{ query, limit? }` |
| `generate_draft` | rag-core generation.ts | `{ task, evidence[], constraints? }` |
| `critic_review` | 新 LLM call（见 §C）| `{ draft, criteria }` |
| `refine_draft` | rag-core generation.ts（refine prompt）| `{ draft, feedback }` |
| `log_decision` | agent_steps 表写入 | `{ reasoning, choice }` |

**Tool description 写法原则**（面试考点）：description 是 LLM 决策的唯一依据，需要明确说明"何时应该调这个 tool"，而不只是"这个 tool 做什么"。

#### B2. AgentRunner（[agent/agent-runner.service.ts](apps/api/src/agent/agent-runner.service.ts)）

```ts
async run(input: AgentRunInput): Promise<AgentRunOutput> {
  // 1. 加载记忆，注入 system prompt
  const memory = await this.memoryReader.load(input.projectId);
  const systemPrompt = buildSystemPrompt({ memory, platformRules: input.rules });

  // 2. 创建 agent_runs 记录
  const runId = await this.createRun(input);

  // 3. ReAct 主循环（ai-sdk 内置，onStepFinish 钩子做可观测）
  const result = await generateText({
    model: this.llm.create(input.modelConfig),
    system: systemPrompt,
    messages,
    tools: this.tools.forRun(runId),
    toolChoice: 'auto',
    maxSteps: input.maxSteps ?? 12,
    onStepFinish: async (step) => {
      // 每步强制入库 + SSE 推前端
      await this.recordStep(runId, step);
      this.sse.emit(runId, step);
      // 累计 cost，超 budget 抛异常终止
      await this.checkBudget(runId, step.usage, input.budgetUsd);
    },
  });

  // 4. 完成 or 降级
  return this.finalize(runId, result);
}
```

**Context Compression**：`compressHistory(messages, threshold=8000tokens)` — 超过阈值把最早的 N 轮压缩成摘要，追加到 system prompt 末尾，保证 multi-turn 对话不爆 context window。

**错误处理三件套：**
- Tool retry：指数退避，区分 retryable（429/5xx）vs not-retryable
- Schema 校验失败：把错误塞回 messages，让 LLM 自己修正输出
- Budget/steps 超限：`fallback()` 把已检索到的 chunks 拼成兜底回答，不让用户看到空白

---

### C. 上下文管理（[agent/context-manager.ts](apps/api/src/agent/context-manager.ts)）

Multi-turn 对话的 `messages` 数组会随对话轮次持续增长，最终超出模型 context window。这是 agent 系统工程化必须解决的问题，不是可选优化。

**两层策略组合：**

```
messages 数组
    │
    ▼
[滑动窗口] 保留最近 K 轮的完整 messages（K 可配，默认 6 轮）
    │
    ▼  超过 token 阈值（默认 8000 tokens）时触发
    ▼
[摘要压缩] 把窗口外的早期轮次 → LLM 压缩成一段摘要
    │
    ▼
system prompt 末尾追加：
"以下是本次对话的早期摘要：{summary}"
```

**`ContextManager` 接口：**

| 方法 | 职责 |
|---|---|
| `estimateTokens(messages)` | 估算当前 messages token 数（用 tiktoken 或字符近似） |
| `shouldCompress(messages)` | 判断是否触发压缩（超阈值 or 超轮次） |
| `compress(messages)` | 调 LLM 把早期轮次总结成自然语言摘要，返回 `{ summary, trimmedMessages }` |
| `inject(systemPrompt, summary)` | 把摘要追加进 system prompt |

**AgentRunner 集成点：**

每次进入 ReAct loop 的新一轮之前，调用 `contextManager.shouldCompress(messages)` — 需要压缩时先压缩再调 `generateText`。**压缩事件本身也写入 `agent_steps`**（`step_type='context_compress'`），保证完整可观测。

**与 Memory 的区别（面试考点）：**

| | 上下文管理 | Memory（L2） |
|---|---|---|
| 作用范围 | **单次会话内**的工作记忆 | **跨会话**的长期偏好 |
| 载体 | `messages` 数组（内存） | `agent_memory` 表（持久化） |
| 更新时机 | 对话进行中自动触发 | feedback 后 distill 触发 |
| 内容 | 本次对话说了什么 | 用户一贯喜欢什么 |

---

### E. Critic（[agent/tools/critic-review.ts](apps/api/src/agent/tools/critic-review.ts)）

`critic_review` tool 的 execute 内部做 LLM-as-judge：

```ts
// LLM judge prompt：
// - 加载项目 memory（L2 偏好）作为评判标准
// - 加载 platform_rules 作为硬约束
// 输出：{ faithfulness, completeness, style, safety, passed, suggestions[] }
// passed = 所有分数 >= threshold（项目可配）
```

Agent 拿到 `passed=false` 后，会在 reasoning 里自主决定调 `refine_draft`。这个循环是 emergent 的，不是写死的。

**Runtime 评估与 offline eval 用同一套评分逻辑**，保证一致性（见 §E）。

---

### F. Memory 子系统（[apps/api/src/memory/](apps/api/src/memory/)）

| 文件 | 职责 |
|---|---|
| `memory.service.ts` | CRUD on `agent_memory` 表 |
| `memory-reader.ts` | `load(projectId)` → 按 kind 分组拼成自然语言注入 system prompt |
| `memory-distiller.ts` | **核心**：feedbacks → LLM 提炼 → upsert agent_memory |
| `memory.controller.ts` | REST CRUD + `POST /memory/distill` 手动触发 |

**MemoryDistiller 工作机制：**

输入：项目近 20 条 `feedbacks`（ratings + `edit_diff` + `comment`）+ 现有 `agent_memory`。

`edit_diff` 是最有价值的信号 — 用户把 AI 输出改成什么样，就是最直接的"我想要什么风格"的示范。

LLM prompt 核心逻辑：提炼稳定偏好（不是单次吐槽）→ 按 4 种 kind 输出 → 与现有 memory 合并（印证则提升 confidence，矛盾则更新）。

**触发时机：**
- 手动：Settings 页"让 AI 重新学习我的偏好"按钮 → `POST /memory/distill`
- 自动：每收到 5 条新 feedback → `@OnEvent('feedback.created')` → 异步触发

**Notes Embedding（让 search_notes 有意义）：**
[apps/api/src/notes/notes.service.ts](apps/api/src/notes/notes.service.ts) 保存/更新笔记时同步算 embedding → `notes.embedding vector(1024)` → `search_notes` tool 用 pgvector 检索。

---

### G. Agent 评估体系（[apps/api/src/eval/](apps/api/src/eval/)）

这是 toy 系统和工业级系统最关键的分界线。

#### E1. 离线 Eval Suite

**Golden Dataset**（[apps/api/src/eval/golden/](apps/api/src/eval/golden/)）：

手工构造 20-30 条三元组：
```json
{
  "id": "eval-001",
  "query": "分析竞品小红书的卖点策略",
  "expected_tools": ["search_web", "search_kb", "generate_draft"],
  "reference_answer": "...",
  "thresholds": { "faithfulness": 4, "completeness": 4, "style": 3 }
}
```

**EvalRunner**（[apps/api/src/eval/eval-runner.ts](apps/api/src/eval/eval-runner.ts)）：

- 对每条 golden item 跑完整 agent
- 用 LLM-as-judge 打分（与 `critic_review` 同一套 prompt，复用逻辑）
- 比对 `expected_tools` vs 实际 `agent_steps` 里的 tool 调用序列（trajectory accuracy）
- 输出分项得分 + 聚合报告

```bash
pnpm eval          # 跑全量 golden set，输出 JSON 报告
pnpm eval --id 001 # 跑单条
```

**与 CI 集成**：改了 prompt / tool 后跑 eval，平均分下降超过阈值则 fail（防回归）。

**Golden Set 增长策略**：人工评分 overall ≥ 4 且有 `edit_diff` 的历史 generation → 半自动加入 golden set。**feedbacks 表同时喂 memory distiller 和 eval 系统，形成双闭环。**

#### E2. 在线 Runtime 评估

每次 agent run 结束后，`critic_review` 的最后一次打分结果保存到 `agent_runs.eval_scores JSONB`，可按项目聚合趋势。

#### E3. 人工反馈（已有）

`feedbacks` 表 4 维评分作为最终 ground truth，高于 LLM-as-judge 的可信度，用于校准 judge 的偏差。

---

### H. 前端改动（apps/web）

最小改动原则：

| 文件 | 改动 |
|---|---|
| [apps/web/lib/api/agent.ts](apps/web/lib/api/agent.ts)（新） | `runAgent()` SSE 客户端 + run/steps 查询 |
| [apps/web/components/agent/AgentTracePanel.tsx](apps/web/components/agent/AgentTracePanel.tsx)（新） | 按 step 时间轴展示 reasoning + tool calls + observations；**项目最佳卖点 UI，直观体现"透明可观测"** |
| [apps/web/app/(workspace)/projects/[id]/page.tsx](apps/web/app/(workspace)/projects/[id]/page.tsx) | Generate 按钮旁加 "Agent 模式" toggle（默认开），开则走 `/agent/run` SSE，关则走老 `/generate` |
| [apps/web/components/memory/MemoryPanel.tsx](apps/web/components/memory/MemoryPanel.tsx)（新） | Settings 页"AI 学到的偏好"Tab：列出 agent_memory 条目，可编辑/删除/手动触发 distill |
| [apps/web/components/eval/EvalReport.tsx](apps/web/components/eval/EvalReport.tsx)（新） | Settings 页展示最近一次 eval 报告（各维度得分趋势）|

---

### I. LangGraph JS 平行实现文档（学习用）

[docs/agent/langgraph-equivalent.md](docs/agent/langgraph-equivalent.md)，60 行内说清楚等价关系：

| 我们自建 | LangGraph 等价物 |
|---|---|
| `AgentRunner` while loop | `StateGraph` + `addEdge('agent', shouldContinue ? 'tools' : END)` |
| `agent_steps` 表 | `MemorySaver` checkpointer |
| 手动 SSE emit | `graph.stream()` 内置流 |
| Tool 注册 | `ToolNode([...tools])` |
| Budget cap | `recursionLimit` + 自定义 reducer |
| MemoryDistiller | **LangGraph 没有内置等价物**（这是我们的优势） |

附 50 行 LangGraph 等价代码片段。面试时的叙事：**"我理解两种实现，选自建是因为 memory distillation 和 per-step 可观测性需要深度控制，LangGraph 的抽象在这里反而是阻力。"**

---

## 复用清单（不重写现有代码）

| 已有能力 | 复用方式 |
|---|---|
| [packages/rag-core/src/retrieval/](packages/rag-core/src/retrieval/) | `search_kb` tool 内部调用 |
| [packages/rag-core/src/generation/generation.ts](packages/rag-core/src/generation/generation.ts) | `generate_draft` + `refine_draft` tool |
| [packages/rag-core/src/generation/evaluation.ts](packages/rag-core/src/generation/evaluation.ts) | `critic_review` tool 的评分逻辑基础 |
| [apps/api/src/feedbacks/](apps/api/src/feedbacks/) | MemoryDistiller 输入 + EvalRunner golden set 来源 |
| [apps/api/src/notes/](apps/api/src/notes/) | 加 embedding 后包成 `search_notes` tool |
| [apps/api/src/platform-rules/rule-validator.ts](apps/api/src/platform-rules/rule-validator.ts) | `critic_review` 里的硬约束检查 |
| `pipeline-orchestrator` YAML pipeline | **保留不删**，作为 `agent_mode=false` 的后备，feature flag 切换 |
| EventEmitter2 | MemoryDistiller 自动触发 |

---

## 子 Feature 分解与工期

| Sub-feature | 内容 | 工期 |
|---|---|---|
| **feat-300.1** | Schema（3 表）+ LLM 层（ai-sdk 接入 + Tavily） | 2 天 |
| **feat-300.2** | 8 个 Tools 定义 + rag-core 委托 | 3 天 |
| **feat-300.3** | AgentRunner（ReAct loop + onStepFinish + budget cap + context compression + 错误处理） | 4 天 |
| **feat-300.4** | Memory 子系统（reader + distiller + notes embedding + UI） | 3 天 |
| **feat-300.5** | Agent 评估体系（golden dataset + EvalRunner + CI 集成 + eval UI） | 3 天 |
| **feat-300.6** | 前端 AgentTracePanel + MemoryPanel + SSE 客户端 | 3 天 |
| **feat-300.7** | LangGraph 文档 + 全量 smoke test + 面试题 | 2 天 |
| **合计** | | **~3 周** |

---

## 验证策略

### 单元测试
- `agent-runner.spec.ts`：mock ai-sdk，验证 step 入库 / budget cap 触发 / fallback 降级
- `memory-distiller.spec.ts`：mock LLM，喂 5 条 feedback 验证 memory upsert 合并逻辑
- 每个 tool 单测：mock 委托对象，验证 zod 参数校验边界

### 集成测试（扩展 `scripts/smoke.mjs`）
1. 老 pipeline 走一次（回归验证不破坏现有功能）
2. Agent 模式走一次，断言 `agent_steps >= 3`、`finish_reason='done'`
3. 提交低分 feedback + 触发 distill，断言 `agent_memory` 新增 ≥ 1 条
4. 再次 agent 运行，通过 agent_steps 断言 system prompt 包含了上步 distill 出的偏好

### Eval 回归
- `pnpm eval` 跑 golden set，平均 faithfulness ≥ 3.5、tool accuracy ≥ 70% 为 pass
- 改 prompt 后必须重跑

### 端到端（手工）
- AgentTracePanel 里看到 ≥ 5 步 reasoning + tool calls
- 提交评分 → Settings 里"重新学习"→ 再次生成，输出风格可观察变化
- 超出 budget 场景：配小 budget（$0.01），验证 fallback 触发且用户不看到报错

### SLA 目标
- p95 延迟 < 30s（含 fallback）
- 单次 agent run 平均成本 < $0.20（智谱 glm-4-flash）
- maxSteps 默认 12，budget 默认 $0.20，均可项目级覆盖

---

## 风险与对冲

| 风险 | 对冲 |
|---|---|
| ReAct 失控烧钱 | budget_usd + max_steps 双闸门；实时 cost 在 SSE 推送，UI 可一键 abort |
| 可观测性变差 | `agent_steps` 强制全程入库 + AgentTracePanel 可视化每步（反而比老 pipeline_trace 更详细） |
| Distiller 学到错误偏好 | MemoryPanel 可看/编辑/删除每条偏好 + source_feedback_ids 可溯源 |
| Eval golden set 太小不代表真实分布 | 高评分历史 generation 半自动扩充 + 按 query 类型分层采样 |
| notes embedding 列迁移影响已有数据 | `ADD COLUMN IF NOT EXISTS`，NULL 值兼容，异步批量补算 |
| ai-sdk 与 BYOK 加密 key 不兼容 | LlmService 里解密后注入 provider 配置，不改 BYOK 存储层 |

---

## 面试考点预埋

每个 sub-feature 完成后在 `.interview/feat-300.x.md` 写面试题，核心考点：

1. **Pipeline vs Agent 的本质区别**（为什么之前是 pipeline，现在才是 agent）
2. **ReAct 原理**（Reason + Act 论文的思路，与 CoT 的区别）
3. **Tool description 设计原则**（LLM 靠 description 决策，不靠 code）
4. **LLM-as-judge 的局限性与校准**（为什么要有人工 feedback 作为 ground truth）
5. **Memory distillation 的工程实现**（不是背 LangChain API，是自己设计的）
6. **为什么不用 LangGraph**（深度可观测 + memory 自建的需要）
7. **Budget cap 实现**（防 LLM 失控的工程手段）
8. **Context compression 策略**（multi-turn 长对话的处理）

---

## 不在本期范围

- ❌ 定时任务（每日竞品拉取 / 定时生成发送）— 独立子系统，Phase 4 处理
- ❌ L3 跨项目用户画像
- ❌ Multi-agent 协作（Critic 是 tool，不是独立 agent）
- ❌ MCP server 接入（发送到微信/邮件）
- ❌ Vector DB 迁移（继续 pgvector）
- ❌ 重写前端架构
