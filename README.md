# Idea-Maker · 透明可观测的营销 Agent

> 一个**真 ReAct Agent**驱动的营销内容生成系统：从用户反馈中自动学习偏好、每一步推理可被实时观测、配套完整的离线 Eval 体系。
>
> **核心卖点**：在 Coze / Dify 这类「黑盒平台」之外，做一个**全栈透明 + 工程可控**的对照实现。

[![tests](https://img.shields.io/badge/tests-199%20passed-success)]()
[![smoke](https://img.shields.io/badge/e2e%20smoke-17%2F17-success)]()
[![typecheck](https://img.shields.io/badge/typecheck-clean-success)]()
[![stack](https://img.shields.io/badge/stack-NestJS%20%2B%20Next.js%20%2B%20pgvector-blue)]()

---

## 🎯 这个项目和别人的项目什么区别

| 维度 | 大多数「LLM 应用」demo | 本项目 |
|---|---|---|
| **是 Agent 吗** | 通常是 pipeline（固定顺序）伪装成 agent | **真 ReAct 主循环**：LLM 自主决定下一步调什么 tool |
| **能观测吗** | console.log 或不可见 | **每一步落库 + SSE 实时流 + 时间轴 UI** |
| **能评估吗** | 跑通 demo 就完事 | **三层 Eval**：LLM-as-judge + trajectory match + agent_runs 元数据 |
| **能自学吗** | 不能 | **MemoryDistiller**：用户 feedback → LLM 蒸馏 → 下次 agent 自动遵守 |
| **会出错怎么办** | 重新部署 | **退出码 0/1/2**：区分业务回归 / 基础设施异常 / 正常 |
| **代码可读吗** | 不知道为什么这么写 | **每个决策有注释 + 13+ 个面试题文档讲清楚 why** |

---

## 🏗️ 架构一图

```
┌────────────────────────────────────────────────────────────────┐
│ 前端 Next.js 16 + Turbopack                                     │
│                                                                  │
│  Chat 页              Settings 页（5 Tabs）       /eval 页       │
│  ┌──────────────┐    ┌──────────────────────┐   ┌────────────┐ │
│  │AgentTracePan │    │ LLM / 思考深度 / RAG │   │EvalReport  │ │
│  │ 实时时间轴 +  │    │ 平台规则 / AI 偏好    │   │自建 SVG 趋势│ │
│  │ Cost Bar +   │    │                       │   │Drawer 详情 │ │
│  │ Abort 按钮   │    └──────────────────────┘   └────────────┘ │
│  └──────────────┘                                                │
│         ↑                                                         │
│         SSE EventSource（+ stepIndex 去重 + 45s watchdog 重连）  │
└────────────────────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────────────────────┐
│ 后端 NestJS 10                                                  │
│                                                                  │
│  POST /agent/run（142ms 非阻塞）                                │
│  GET  /agent/runs/:id/stream  [SSE + ReplaySubject 回放]        │
│        ↓                                                          │
│  AgentRunnerService  ←— ReAct 主循环（ai-sdk generateText）     │
│    ├ ContextManager（滑窗 + LLM 摘要压缩）                       │
│    ├ MemoryReader（注入 system prompt）                          │
│    ├ AgentToolsService（8 个 tool 工厂）                         │
│    ├ CostTracker（USD budget 闸门）                              │
│    └ SpillStorage（> 8KB 落盘）                                   │
│                                                                  │
│  8 Tools:  search_kb（pgvector）/ search_notes / search_history │
│            / search_web（Tavily）/ generate_draft / refine_draft│
│            / critic_review / log_decision                        │
│                                                                  │
│  MemoryDistiller @OnEvent('feedback.upserted')                  │
│        累计 5 条 feedback → LLM 蒸馏 → upsert agent_memory      │
│                                                                  │
│  EvalRunner（pnpm eval）                                         │
│        每条 golden 跑真实 AgentRunner.run（生产路径 = eval 路径）│
│        → LLM-as-judge 三维 + trajectory match + 入 eval_runs    │
└────────────────────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────────────────────┐
│ PostgreSQL 16 + pgvector + bge-m3 embedding                     │
│   agent_runs / agent_steps / agent_memory                       │
│   eval_runs / eval_items                                        │
│   notes（vector(1024) + HNSW 索引）                              │
│   feedbacks / generations / project_settings                    │
└────────────────────────────────────────────────────────────────┘
```

**模型层**：BYOK 兼容 OpenAI / GLM（智谱）/ Qwen（DashScope）/ DeepSeek / 任意 OpenAI-compatible endpoint。
实测 demo：GLM `glm-4-flash` + ollama `bge-m3`，单次 agent run **~$0.0001 + 7s 完成**。

---

## ⭐ 5 个真实 bug 调试链（最值钱的资产）

`feat-300.6` 端到端联调过程中**逐层暴露 5 个 bug**——单测 199/199 全过，但浏览器实际跑炸。每一层修了下一层才浮现，洋葱式。

| # | 表象 | 根因 | 修复 |
|---|---|---|---|
| 1 | search_kb 404 `text-embedding-v4` not found | Provider 抽象漏抽：硬编码 Qwen 默认值 | 透传 `ctx.options.embeddingModel/Dimension` → fail loud 抛错 |
| 2 | UI 卡"启动中"，POST 阻塞 60s | "注释说异步实则 await" 全跑完才返回 | `runner.startInBackground` + `onIdsReady` 回调，142ms 返回 |
| 3 | UI 仍空 + SSE reconnect 死循环 | `fromEvent` Pub-Sub 竞态，订阅前 emit 丢失 | `ReplaySubject` per-runId 缓冲 + 60s TTL |
| 4 | finish 后仍 reconnect | `closeStream` 副作用触发 onerror，`null?.readyState !== CLOSED` 误判 | `finishedRef` 显式终态 + 三重防御 |
| 5 | useEffect 跑 **2294 次** | deps 含 doConnect，doConnect 依赖 inline callback | ref 隔离 doConnect 等 helpers，effect deps 只留语义依赖 |

每个 bug 都有独立面试题在 [`.interview/feat-300.6_frontend.md`](.interview/feat-300.6_frontend.md) 题 #9-#13。

**这条调试链的工程价值**：5 个 bug 都是「**单测全过 + TS 干净 + ESLint 不报**」的隐蔽 bug，单元测试覆盖不到，只有端到端实测才能暴露。简历讲故事时这比 "100% 通过率" 更有说服力。

---

## 🧪 三层 Eval 体系（覆盖 LLM + RAG + Agent）

不是仅评 LLM 输出，而是**三维度叠加**：

```
LLM eval     LLM-as-judge 三维（faithfulness/completeness/style 1-5 + rationale + 1/3/5 锚点）
RAG eval     间接：faithfulness 低 = 检索没拿到关键信息（不做 context_precision/recall，ROI 不够）
Agent eval   trajectory 集合相似度（jaccard precision recall fullCover）
             + 直接读 agent_runs 表的 cost/steps/finish_reason

passed = 三维都过 thresholds && jaccard ≥ 0.5
```

**对比 [《Agentic Design Patterns》Chapter 19](https://github.com/xindoo/agentic-design-patterns/blob/main/chapters/Chapter%2019_%20Evaluation%20and%20Monitoring.md)** 文章列的 15 种评估方法，**我们覆盖 9 个（核心）+ 部分覆盖 4 个**——详见 [`docs/agent/langgraph-equivalent.md`](docs/agent/langgraph-equivalent.md) 的对比。

**实测结果**：3 次跑 `pnpm eval` 的 avg.overall = **3.733 → 3.533 → 3.6**（下降 + 回升），趋势线展示完整的 baseline + delta 机制。

5/5 item 都 `passed=false` 但 judge 评分都 3-5 ✅——`jaccard ≤ 0.333` 暴露了「agent 决策路径与设计预期不符」的真实问题，**这正是 agent eval 的价值**（LLM eval 抓不到）。

---

## 🧠 Memory 蒸馏闭环

```
用户给 feedback（评分 + 编辑改写 edit_diff）
         ↓
EventEmitter2 'feedback.upserted'
         ↓
MemoryDistiller @OnEvent（累计 5 条触发）
         ↓
LLM 蒸馏 prompt（edit_diff 作为核心信号，比评分信息密度大 10×）
         ↓
upsert agent_memory（4 kind: preference/style/taboo/audience）
         ↓
下次 AgentRunner 启动时 MemoryReader 加载
         ↓
按 kind 分组注入 system prompt（taboo 优先 — 最重要的放最前）
```

UI 设计取舍：**Distill 按钮藏在 MemoryPanel 末尾「高级」折叠区**（类比 JVM `System.gc()`——保留能力但不诱导日常误触发）。顶部只展示 `上次自动学习于 X 前`，让用户感知"AI 在自动学"。

详见面试题 [`.interview/feat-300.4_memory.md`](.interview/feat-300.4_memory.md) + UI 设计决策 [`docs/agent/feat-300.6-plan.md`](docs/agent/feat-300.6-plan.md) §3.7。

---

## 🚀 快速开始

```bash
# 1. 依赖（pnpm 9+）
pnpm install

# 2. 起 PostgreSQL + pgvector + ollama（embedding）
docker compose up -d postgres
ollama pull bge-m3

# 3. apps/api/.env 配 LLM（OpenAI / GLM / Qwen / DeepSeek 任一兼容协议）
# 例：智谱 GLM-4-flash + 本地 ollama bge-m3 embedding
cat > apps/api/.env <<EOF
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag
JWT_SECRET=your-secret-min-16-chars

LLM_API_KEY=your-glm-key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4-flash

EMBEDDING_API_KEY=ollama
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIMENSION=1024
EOF

# 4. 起后端 + 前端
pnpm --filter @harness/api dev      # http://localhost:3001
pnpm --filter @harness/web dev      # http://localhost:3000

# 5. 验证（17 步 e2e）
node scripts/smoke.mjs
```

---

## 📂 仓库导航

```
apps/
  api/                    NestJS 后端
    src/
      agent/              AgentRunner + ContextManager + AgentTools + Prompts
        prompts/          definePrompt 抽象 + 集中管理 + 版本号
        tools/            8 个 ai-sdk tool（含 spill 落盘）
      memory/             MemoryService + MemoryDistiller + Controller
      eval/               EvalRunner + golden/ + trajectory-match + judge prompt
      pipeline/           老的 11-stage YAML pipeline（feat-200.x，仍保留对照）
      llm/                LlmService + TavilyClient（BYOK）
      db/                 schema.ts（CREATE TABLE IF NOT EXISTS 集中）
    scripts/eval.ts       pnpm eval CLI（退出码 0/1/2 区分业务回归 vs 基础设施）

  web/                    Next.js 16 前端
    app/(workspace)/projects/[id]/
      page.tsx            Chat 主页（Agent toggle + 经典模式 fallback）
      settings/           5 Tabs（LLM / 思考 / RAG / 平台规则 / AI 偏好）
      eval/               独立 /eval 路由（趋势图 + Drawer）
    components/
      agent/              AgentTracePanel + AgentStepCard 5 多态 + CostBar + Abort
      memory/             MemoryPanel + KindBadge + 行内编辑
      eval/               EvalReport + EvalTrendChart（自建 SVG）+ Drawer
      common/Tabs.tsx     URL ?tab= 同步
    lib/
      api/                agent.ts / memory.ts / eval.ts 客户端
      hooks/              useEventSourceWithReplay + useAgentRun

packages/
  rag-core/               纯算法层（11 stages + retrieval methods + embed util）
  shared-types/           前后端共享类型

docs/
  agent/
    ARCHITECTURE.md       Phase 3.5 Agent 架构总览
    feat-300.3-plan.md    Runner 实施规划（10 个 ⚠️ 易忽略点）
    feat-300.5-plan.md    Eval 实施规划
    feat-300.6-plan.md    前端实施规划 + 实施回顾（5 bug 修复链）
    langgraph-equivalent.md  自建 vs LangGraph 对比 + 50 行 Python 等价代码
  PRODUCT.md / ARCHITECTURE.md / ROADMAP_PHASE2_PLUS.md / ...

.interview/                                  # 13 个面试题文件
  feat-300.1_schema-llm-layer.md      6 题
  feat-300.2_agent-tools.md           6 题
  feat-300.3_agent-runner.md         10 题（⚠️ Abort / SSE 心跳 / Spill / Prompt 体系等）
  feat-300.4_memory.md                8 题（edit_diff 信号 / 双闭环 / pgvector / confidence）
  feat-300.5_eval.md                  8 题（LLM-as-judge 风险 / 集合 vs 序列 / passed 复合判定）
  feat-300.6_frontend.md             13 题（含 5 个真实 bug 调试链 ⭐）

scripts/
  smoke.mjs               17 步 e2e（含防 #10 阻塞 bug 复发断言）
```

---

## 🎓 学习目的项目（不是商业产品）

本项目设计目标是「**面试可讲故事 + 工程可经实战检验**」，不是真上线服务。所以做了很多**有意识的取舍**：

| 没做 | 为什么 |
|---|---|
| LangGraph / LangChain | 等于黑盒，写不进面试故事。自建 600 行 TS 反而能讲清楚 ReAct |
| LangSmith | 商用付费。自建三层 Eval 对 demo 阶段 ROI 更优 |
| Ragas 全套 | 标 ground-truth context 成本太高，用 faithfulness 间接兜底 |
| Multi-agent / 子图 | 不在 ReAct 范围内，留 feat-301+ |
| 持久化时序 DB（Prometheus）| PG 表 + 自建 SVG 趋势图够用，没上 Grafana |
| Human-in-the-loop | LangGraph 强项，留作升级路径 |

详见 [`docs/agent/langgraph-equivalent.md`](docs/agent/langgraph-equivalent.md) 的对比章节。

---

## 📊 当前指标

- **199** 单元测试全过（vitest）
- **17/17** e2e smoke 全过（含 防 feat-300.6 #10 阻塞 bug 复发的 < 5s 断言）
- **typecheck** 干净（apps/api + apps/web + packages/rag-core + packages/shared-types）
- **5** 个真实 bug 已修 + 入面试题
- **13** 个面试题文件（覆盖 schema / tools / runner / memory / eval / 前端）
- **3** 个 plan 文档（300.3 / 300.5 / 300.6，按"易忽略点"格式）
- **1** 个 LangGraph 对比文档（60 行 + 50 行 Python 等价代码）

---

## 🛣️ Roadmap

| Phase | 范围 | 状态 |
|---|---|---|
| Phase 2 MVP | 11-stage pipeline + 文档库 + 笔记库 + 平台规则 | ✅ done |
| Phase 3.5 真 Agent | feat-300.1 → 300.7 ReAct + Memory + Eval + 前端 | ✅ **本仓库主线**，刚收官 |
| Phase 4 Studio | 四列看板 + Content Directions + 完整帖扩展 | ⏳ todo |
| Phase 5 工程化 | Lucia Auth + 多租户 + BYOK key 管理 + Drizzle + Fly.io 部署 | ⏳ todo |

详见 [`feature_list.json`](feature_list.json) + [`docs/ROADMAP_PHASE2_PLUS.md`](docs/ROADMAP_PHASE2_PLUS.md)。

---

## 📜 License

MIT
