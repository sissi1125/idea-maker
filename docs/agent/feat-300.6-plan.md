# feat-300.6 实施规划：前端 AgentTracePanel + MemoryPanel + EvalReport + SSE

> 第一版前端真正"看见" Phase 3.5 Agent 系统。
>
> **特别标注「易忽略点」段落 ⚠️ —— 这些是面试常考的工程细节**。

---

## 1. 范围与目标

把 300.1–300.5 攒下的后端能力暴露给前端，让"透明可观测"成为项目可演示的卖点。新增：

- **`apps/web/lib/api/agent.ts`** — `runAgent`、`getRun`、`getSteps`、`abortRun`、`connectAgentSSE`
- **`apps/web/lib/api/memory.ts`** — `listMemory` / `createMemory` / `updateMemory` / `deleteMemory` / `distill`
- **`apps/web/lib/api/eval.ts`** — `runEval` / `listEvalRuns` / `getEvalRun` / `promoteFeedback`
- **`AgentTracePanel.tsx`** — step 时间轴（reasoning + tool calls + observations + context_compress + finish）
- **`MemoryPanel.tsx`** — Settings 页新 Tab：列出 agent_memory，编辑 / 删除 / 触发 distill
- **`EvalReport.tsx`** — Settings 页新 Tab：最近 N 次 eval_runs 趋势线 + 单条详情抽屉
- **Chat 页「Agent 模式」toggle** — 开走 `/agent/run` + SSE；关走老 `/generate`
- **Settings 页 Tab 化** — 把原有 3 个 Section 改成 Tab 容器，"AI 学到的偏好" / "评估报告" 并入
- **可选**：把 Chat 页右侧的 PipelineTraceView 在 agent 模式下替换为 AgentTracePanel

**不在本期**：
- Studio 全屏的"营销师视角"看板（feat-012）
- agent_steps 落盘视图 read-spill UI（后端有端点，前端"原文展开"按钮可后续加）
- eval CI 触发 / 进度 SSE（feat-300.7）
- MemoryPanel 的 confidence 调节滑块（首版只读 confidence）
- 移动端响应式（首版 desktop-first，sidebar 折叠靠 lg: breakpoint）

**MVP Scope（用户场景 B：GitHub 简历项目静态展示 2026-06-01）**：

只做任务 0-2、4-7、11，**优先保证 trace 截图/录屏的视觉效果**。

| 暂缓 | 理由 |
|---|---|
| 任务 3 Tabs / KindBadge | Settings Tab 化暂不做，依赖减弱 |
| 任务 8 MemoryPanel | 演示价值不如 trace；memory 可演示"自动学习"在后端 |
| 任务 9 EvalReport / 独立路由 | 同上，eval 报告靠 markdown 输出已够 demo |
| 任务 10 Settings Tab 化 | Memory/Eval 暂缓，Settings 不需要重构 |
| Onboarding tooltip | 截图场景红点污染截图；简历读者是人不是产品用户 |

MVP 工期估算：**~2.5 天**（0/1/2/4/5/6/7/11）。
后续补完任务 3/8/9/10 = +1.5 天。

---

## 2. 已确认的设计决策

| 决策 | 选项 | 理由 |
|---|---|---|
| **Agent 模式 toggle 默认** | **开**（用户确认 2026-06-01） | 项目核心卖点就是 Agent，默认走新路径；老 /generate 留作 fallback |
| toggle 持久化 | 用户级 localStorage（zustand persist）| 改回老路径的偏好跨刷新保留；不入 project_settings（不是项目维度） |
| Agent 模式启动方式 | POST /agent/run 拿 runId → 再 GET /agent/runs/:id/stream SSE | EventSource 不支持 POST body；分两步规范的 SSE 用法 ⚠️ |
| SSE 鉴权 | URL query `?token=xxx` | 与 ingestion SSE 一致（已实现模式）；EventSource 不支持自定义 header ⚠️ |
| **AgentTracePanel 排序** | **正序时间轴 + 自动滚到底**（用户确认 2026-06-01） | reasoning→tool→observation 的故事感是 transparency 卖点核心；ChatGPT/Cursor/Claude Code 都正序 |
| 断线重连策略 | EventSource 内置 + 重连时调 GET /steps 拿历史回放 | 不要"重新订阅 SSE 从头收"——后端 stream 端点不重放历史 ⚠️ |
| **终止按钮位置** | **单入口：TracePanel 头部**（用户偏好 2026-06-01） | 按钮泛滥更糟；Chat 区下方放「查看 trace」链接替代第二入口 |
| Trace 折叠粒度 | reasoning 默认展开 / tool_result 默认折叠 + 顶部「全部展开/折叠」开关 | 信息密度差异；开关给重度用户兜底 |
| Memory 列表分组 | 按 kind（preference/style/taboo/audience）四个 section | 与后端 memory-injection.prompt 的渲染顺序一致；用户认知一致 |
| Memory 编辑模式 | 行内编辑（点击 → 弹 textarea + 保存/取消） | 单条编辑常见操作，弹窗过重 |
| **Distill 触发按钮位置** | **方案 B：MemoryPanel 末尾「高级」折叠区，默认收起** | 不污染主 UI；保留演示能力；配 tooltip 说明「通常无需手动触发」⚠️ |
| Distill 按钮反馈 | toast + 列表自动 refetch | 与 ingestion 模式一致；triggered=false 时 toast 说明"未满 5 条新 feedback" |
| MemoryPanel 顶部展示 | `"上次自动学习于 X 小时前"`（读 last_distilled_at），无按钮 | 让用户感知"AI 在自动学"，不诱导手动操作；按钮藏在「高级」里 |
| EvalReport 图表 | 不引入 chart 库，纯 SVG 折线 + tooltip | 数据点 < 20，CSS+SVG 30 行能搞定；少装一个依赖 ⚠️ |
| EvalReport delta 配色 | 退步=red / 持平=neutral / 进步=green | 一眼可读；避免颜色盲单一红绿，配合 ↑ / ↓ 图标 |
| **EvalReport 位置** | **独立顶级路由 `/projects/[id]/eval`**（用户确认 2026-06-01） | eval 是质量监控不是项目设置；分离信息架构避免 Settings 越塞越胖；新增一个一级菜单入口 |
| Settings Tab 容器 | 自建简易 Tab（不引 ui 库） | 已有项目 zero ui-lib 依赖；保持一致 |
| **Settings Tab 化范围** | **保留 Tab 化**：LLM / 思考深度 / RAG / Platform Rules / Memory 五项 | Eval 移走后 Settings 减负；五项仍值得 Tab 分类避免长滚动 |
| 错误 UI | 内联红条 + retry 按钮 | 不弹 modal；agent 失败属业务正常态，UI 不该惊扰 |
| Trace 中长文本 | 默认折叠 + "展开全文" 按钮 + ≥ 4000 字时给"在新页签打开"链接 | spillIfLarge 出来的 preview 已截短，但仍可能长 |

---

## 3. ⚠️ 易忽略点（面试重点）

### 3.1 SSE 启动的两步式 + 防"丢前几帧"

**问题**：浏览器 EventSource 不支持 POST body，所以必须：
1. POST /agent/run → 拿到 `{ runId, generationId }`
2. 立刻 `new EventSource(.../runs/:runId/stream?token=...)`

**陷阱**：步骤 1 完成时后端 ReAct 循环已经在跑，步骤 2 连上前可能错过头几个 step 帧。

**实现**：
- 后端 controller 在 `Post /run` 端点内**只创建 run + 推回 runId**，不启动 ReAct
- 真正启动 ReAct 推到 `Sse` 端点首次订阅时（或后端用 in-memory queue 缓冲已发出的 frame）
- **简化路径（本期采用）**：UI 收到 runId 立即 connectSSE，并行 GET /steps?limit=200 拿"已经发生的"做回放，与 SSE 流去重 by stepIndex

**面试卖点**：
- EventSource 协议限制（no POST body / no header / 自动重连）
- "事件流 + 历史快照"双路径在分布式系统里是常见模式（Kafka offset / SSE Last-Event-ID）
- 我们没用 Last-Event-ID（NestJS @Sse 不天然支持）；用 stepIndex 自己实现等价物

### 3.2 SSE URL token 鉴权 vs Header

**问题**：浏览器 EventSource 构造函数不允许自定义 header，而我们的 API 用 `Authorization: Bearer`。

**实现**：
- 后端 SSE 端点接受 `?token=` query 兜底
- 前端 `connectAgentSSE(runId, token)` 拼 URL
- 后端 Guard 优先读 `Authorization` header，header 缺失时读 `?token=`

**面试卖点**：
- 安全注意：URL query 会写到 access log，反向代理可能落盘 → token 泄露
  - 缓解：用短期 access token（JWT 默认 1h），不要让 SSE token 是长期 refresh token
  - 缓解：access log 过滤 `token` 参数（infra 层）
- WebSocket 没这问题（subprotocol 可塞 token）—— 但 WS 需要客户端心跳、断线重连自己写，复杂度更高
- fetch 的 ReadableStream + 手撕 SSE parsing 也能拿 header，但要自己解析 `event:` / `data:` 帧 + 自己实现重连——不值

### 3.3 断线重连不能"从头收"

**问题**：EventSource 自动重连默认行为是重新连接同一 URL；后端 stream 端点不会重放历史 → 重连后只能看到"从重连那一刻起"的帧，前面的 step 永远丢。

**实现**：
- 在 EventSource 的 `onerror` / `readyState === CLOSED` 时：
  1. 关掉旧 EventSource
  2. 调 GET /agent/runs/:runId/steps 拿全量历史
  3. 用 stepIndex 与已渲染列表去重 + 补齐
  4. 重新 new EventSource 接后续帧

- AgentTracePanel 维护 `Map<stepIndex, StepFramePayload>` 而不是数组，幂等合并

**面试卖点**：
- "为什么不直接相信 EventSource 的自动重连"——它解决 TCP 层连接恢复，不解决业务层数据重放
- "事件流系统的 at-least-once vs exactly-once"——我们靠 stepIndex 唯一约束在前端做 dedup
- 类比 Kafka consumer commit offset：stepIndex 就是我们的 offset

### 3.4 SSE 心跳前端不要响应

**问题**：后端发 `: heartbeat\n\n`（SSE comment）保活，浏览器 EventSource 会忽略 comment 但 `onmessage` 不触发——这是预期。

**实现**：
- 前端**不需要写心跳处理**
- 如果 30s 内既没 message 也没 error，说明心跳工作正常
- 用 setTimeout watchdog 监控"上一个事件距今多久"：如果 > 45s 仍无任何事件（包括 comment），怀疑代理已切断 → 手动触发重连流程（3.3）

**面试卖点**：
- SSE comment 帧的语法（`:` 开头）+ 浏览器 EventSource 静默忽略
- 应用层应主动监控"无任何事件"（包含 comment）的时长，不只看 onerror
- 反向代理 buffer 配置（nginx X-Accel-Buffering: no）：前端没法控制，要看 ops

### 3.5 Trace 中长文本展开的渲染性能

**问题**：一次 search_kb 可能返 3KB 文本，30 个 step 全展开 = 90KB DOM。中文长文本布局慢。

**实现**：
- 默认折叠 tool_result，点击展开
- 展开后用 `<pre>` + `overflow-auto max-h-[400px]` 限定容器
- `whitespace-pre-wrap break-words`：长 URL / 长中文字不撑破布局
- 超 4000 字给"在新页签打开"链接 → 跳 `/agent/spill/:runId/:stepIndex`（feat-300.6 不做这个独立路由，按钮置灰留 300.7）

**面试卖点**：
- React 渲染长字符串时如果父容器是 flex，会触发布局抖动；用固定 `max-h` 隔离
- `content-visibility: auto` 给 trace 卡片可省 50%+ 滚动卡顿，但 IE/旧浏览器不支持
- 列表虚拟化（react-window）的判断阈值：当 step 数 > 100 才值得，本期 maxSteps=12 不需要

### 3.6 Memory 编辑的乐观更新策略

**问题**：用户改一条 memory 点保存，是等后端返回再刷新（保险），还是先改 UI 再后端确认（流畅）？

**实现**：
- **悲观**（首版采用）：保存按钮 disabled + spinner → 200 后用返回值更新 row → toast "已保存"
- 拒绝乐观更新的理由：confidence 字段值后端可能 clamp/校验；如果先改 UI 再被后端覆盖，用户会困惑

**面试卖点**：
- 乐观更新适合"高频 + 后端永远不会拒绝 + 容忍短暂不一致" 的场景（点赞 / 拖拽排序）
- memory 是"低频 + 后端会校验 + 一致性敏感"，悲观更新成本更低
- 中间路径：用 React 19 的 `useOptimistic` hook，failure 时自动回滚——但本项目还在 React 18

### 3.7 Distill 触发的双反馈语义 + 「该不该有按钮」的产品判断

**为什么藏在「高级」折叠区**（产品判断）：
- 蒸馏是 AI 的"内务"，类似 GC——99% 用户不该被引导主动管它
- ChatGPT / Notion AI 都不暴露这个按钮，是有道理的（用户无感知 = 体验最好）
- 我们暴露是因为：① 调试场景需要 ② demo 时演示价值高 ③ endpoint 反正已有
- 折叠 + tooltip「通常无需手动触发」= **不诱导日常使用，仅保留进阶入口**

**MemoryPanel 顶部反而要做什么**：
- 一行 `"上次自动学习于 2 小时前"`（读 `agent_memory.last_distilled_at` 的 MAX）
- 让用户感知"AI 后台在自动学"
- 比"立即学习"按钮更符合 agentic 产品调性

**API 返回的四态**（按下高级按钮才会触发）：
- `{ triggered: true, inserted, merged, processed }` — 真的跑了
- `{ triggered: false, skipped: "no_new_feedback" }` — 没新 feedback
- `{ triggered: false, skipped: "in_flight" }` — 别人正在跑
- `{ triggered: true, skipped: "no_candidates", processed: N }` — 跑了但 LLM 说没东西可蒸

**实现**：
- toast 分四态：成功（"新增 X 条 / 合并 Y 条"）/ 灰提示（"暂无新 feedback"）/ 警告（"正在进行中"）/ 中性（"LLM 未提炼出新偏好"）
- 列表 refetch：前两态都 refetch（即使没新增也要刷新 last_distilled_at 反映）
- 按钮 cooldown：5 秒内重复点视为 noop（防止用户狂点）

**面试卖点**：
- "成功"不等于"有变化"——API 设计要让前端能区分；后端返回 skipped 字段就是这个语义
- 时间相关的反馈（cooldown）放前端做：后端不应假设客户端会节流
- **产品决策**：暴露后端能力 ≠ 必须做主入口；UI 信息架构应反映"用户该关心什么"——"AI 在自动学"用户应该感知，"什么时候学"用户不该被诱导管
- 类比：JVM 暴露 `System.gc()`，但 99% 应用 UI 不给用户按——同一种判断

### 3.8 Agent 模式 toggle 的迁移路径

**问题**：用户已经习惯老 /generate，突然默认开 Agent 模式可能让人迷茫（多了一个 trace 面板 / 跑得稍慢 / cost 模型不同）。

**实现**：
- 第一次进 Chat 页时显示 onboarding tooltip："这是新的 Agent 模式，你可以..."（小红点 + 关闭按钮，关后存 localStorage）
- toggle 旁挂"了解 Agent 模式" 链接 → 跳一个简短的 What's New 卡片
- 老 generate API 不删，agent 模式失败时给"切回经典模式重试"按钮

**面试卖点**：
- "灰度回滚开关"——新功能默认开 + 一键回退；保留老路径直到指标稳定
- onboarding tooltip 的"展示一次"语义：localStorage 而非 cookie（cookie 占带宽）

### 3.9 EvalReport 趋势图自建 SVG

**问题**：折线图引入 chart.js / recharts / echarts 都 100KB+，本期就一个图。

**实现**：
- 纯 `<svg viewBox="0 0 600 200">` + 数据点映射 + `<polyline>` 单线
- tooltip 用 `<title>` 元素或自定义 absolute div
- 坐标轴/网格用 `<line>` 几条
- 30 行代码、零依赖、按需还能加第二条线（passed_rate）

**面试卖点**：
- "可视化库不是免费的"——bundle size / 学习成本 / 升级风险
- 单图 / 数据点少（< 50）时手撸 SVG 是合理选择
- 引图表库的临界点：交互复杂（hover/zoom/legend）或图表种类 ≥ 3 种

### 3.10 SSE Hook 的生命周期 cleanup

**问题**：用户点开 Chat → 看 trace → 切到 Settings → trace 还没跑完 → EventSource 应该关吗？

**实现**：
- `useAgentRun(runId)` hook 在 useEffect cleanup 里 `eventSource.close()`
- 切走视为"用户不再关心"，但后端 run 仍在跑（cost 仍在烧 ≠ 中断）
- 切回来 → 重新 connectSSE + 历史快照（同 3.3）
- 真正"中断"要走 DELETE 端点（终止按钮）

**面试卖点**：
- "关流 ≠ 中断 run"——前端关连接只是省网络；要省 cost 必须显式 abort
- React 18 strict mode 在 dev 会 mount/unmount 两次：cleanup 错了会出现"连一秒就断"的诡异 bug
- useEffect 依赖数组里 runId：runId 变化也要 cleanup 旧 SSE

---

## 4. 文件清单

```
apps/web/lib/api/
├── agent.ts            # runAgent / getRun / getSteps / abortRun / connectAgentSSE
├── memory.ts           # listMemory / create / update / delete / distill
├── eval.ts             # runEval / listEvalRuns / getEvalRun / promoteFeedback
└── index.ts            # re-export

apps/web/lib/hooks/
├── useAgentRun.ts      # connectSSE + 历史快照合并 + cleanup
└── useEventSourceWithReplay.ts  # 通用：SSE + GET history 去重（可复用 ingestion）

apps/web/lib/stores/
└── ui-store.ts         # +agentModeEnabled（zustand persist）

apps/web/components/agent/
├── AgentTracePanel.tsx       # 主时间轴
├── AgentStepCard.tsx         # 单 step 卡片（按 stepType 多态渲染）
├── AgentCostBar.tsx          # budget 仪表盘条
└── AgentAbortButton.tsx      # 终止按钮 + 二次确认

apps/web/components/memory/
├── MemoryPanel.tsx           # 列表 + distill 按钮
├── MemoryRow.tsx             # 单条 + 行内编辑
└── KindBadge.tsx             # preference/style/taboo/audience 视觉徽章

apps/web/components/eval/
├── EvalReport.tsx            # 趋势图 + 最近 runs 列表（整页组件）
├── EvalTrendChart.tsx        # 自建 SVG 折线
└── EvalRunDrawer.tsx         # 单条 run 详情抽屉

apps/web/components/common/
└── Tabs.tsx                  # 简易 Tab 容器（Settings 用）

apps/web/app/(workspace)/projects/[id]/
├── page.tsx                  # +AgentMode toggle / 模式切换 / 内嵌 AgentTracePanel
├── eval/page.tsx             # 【新增】独立 /projects/[id]/eval 顶级路由
└── settings/page.tsx         # Tab 化：LLM / 思考深度 / RAG / Platform Rules / Memory（Eval 已移走）

apps/web/components/layout/
└── (Sidebar.tsx)             # 主导航新增 Eval 入口（Settings 同级）
```

---

## 5. 任务分解（含工期）

| # | 任务 | 工期 | 依赖 |
|---|---|---|---|
| 0 | API client：agent.ts + memory.ts + eval.ts + index re-export | 0.4d | — |
| 1 | useEventSourceWithReplay hook（含 stepIndex 去重 / 历史回放 / watchdog 重连）+ 单测 | 0.5d | 0 |
| 2 | useAgentRun hook（包装 1，暴露 steps[] + status + cost） | 0.2d | 1 |
| 3 | Tabs.tsx + KindBadge + 基础视觉单元 | 0.2d | — |
| 4 | AgentStepCard 多态渲染（reasoning / tool_call / tool_result / context_compress / finish） + 折叠 + 长文本处理 | 0.5d | 3 |
| 5 | AgentCostBar + AgentAbortButton（二次确认） | 0.2d | 0 |
| 6 | AgentTracePanel 组装（自动滚到底 + 心跳 watchdog UI 提示） | 0.3d | 2, 4, 5 |
| 7 | Chat 页接入 Agent 模式 toggle + onboarding tooltip + agent/经典模式切换 | 0.4d | 6 |
| 8 | MemoryPanel + MemoryRow（CRUD + 悲观更新）+ 顶部 "上次自动学习于 X 前" 文本 + **末尾「高级」折叠区放 Distill 按钮**（四态 toast + 5s cooldown + tooltip） | 0.4d | 0, 3 |
| 9 | EvalTrendChart 自建 SVG + EvalRunDrawer + EvalReport 列表 + 独立路由 `app/(workspace)/projects/[id]/eval/page.tsx` + 主导航 sidebar 新增入口 | 0.5d | 0 |
| 10 | Settings 页 Tab 化：把现有 3 Section + Platform Rules + Memory 并入（Eval 已独立路由） | 0.3d | 8 |
| 11 | E2E 手测脚本 + feature_list 标 done + .interview/feat-300.6_frontend.md（8 题） | 0.3d | 10 |

**合计：~4 天**

---

## 6. API 客户端契约

### agent.ts

```ts
runAgent(projectId, messages, opts?): Promise<{ runId, generationId }>
getRun(projectId, runId): Promise<AgentRunRow>
getSteps(projectId, runId, opts?): Promise<AgentStepRow[]>
abortRun(projectId, runId): Promise<void>
connectAgentSSE(projectId, runId, token): EventSource
```

### memory.ts

```ts
listMemory(projectId): Promise<MemoryRow[]>
createMemory(projectId, body): Promise<MemoryRow>
updateMemory(projectId, memoryId, body): Promise<MemoryRow>
deleteMemory(projectId, memoryId): Promise<void>
distillMemory(projectId): Promise<DistillResult>
```

### eval.ts

```ts
runEval(projectId, body?): Promise<EvalRunSummary>
listEvalRuns(projectId, opts?): Promise<EvalRunRowLite[]>
getEvalRun(projectId, runId): Promise<EvalRunRowLite>
promoteFeedbackToGolden(projectId, generationId): Promise<{ item, filePath }>
```

---

## 7. 测试覆盖目标

**单测（vitest + happy-dom）**：
- `useEventSourceWithReplay`：模拟 EventSource + history fetch，验证 stepIndex 去重 / 断线重连 / cleanup
- `AgentStepCard`：5 种 stepType 各一个快照测试
- `Tabs`：URL hash 同步 / 默认 Tab 选择
- `EvalTrendChart`：空数据 / 单点 / 多点 / delta 颜色映射

**集成（手测）**：
- 跑一条 query → trace 边推边滚 → 终止按钮工作 → 切走再切回历史回放
- 改 memory → distill → 再跑一条 query → trace 里 system prompt 注入了新偏好
- 跑 eval → 报告页看到新 run + 与 baseline 对比
- 高分 feedback 上挂"加入 golden"按钮 → 落到目录

---

## 8. 不在本期范围 & 已知"未解决"开放点

**不在本期**：
- Studio 全屏看板（feat-012）
- spill 文本展开独立路由（按钮置灰）
- Memory confidence 滑块编辑
- 移动端响应式 / Touch 手势
- E2E playwright 自动化（手测 + 单测足够 MVP）
- agent_steps 实时 cost 累计的 micro-chart（cost bar 已够直观）

**开放点（实施时再定）**：
- `useAgentRun` 是否走 React Query？目前项目零依赖；自建 hook 仍能管理 stale-while-revalidate，但代码量稍多
- Tabs 实现：受控 useState 还是 nuqs / search params？倾向 search params（刷新保留 + 可分享 URL）
- Settings 页 Tab 改造可能破坏现有 deep link `/settings#section-id`——本期把 hash 改成 `?tab=`，redirect 旧 hash

---

## 9. 风险与对冲

| 风险 | 对冲 |
|---|---|
| SSE 在 Cloudflare / 反代下被切 | 心跳 15s 已在后端；前端 45s 无事件 watchdog + 手动重连 |
| EventSource 不支持 header | URL token + 短期 JWT + access log 过滤 |
| 重连丢前几帧 | stepIndex 去重 + GET /steps 历史回放 |
| 长文本撑破布局 | max-h + overflow + whitespace-pre-wrap |
| React strict-mode 双 mount 触发幽灵 SSE 连接 | useEffect cleanup 严格关闭 |
| Memory 编辑数据竞争 | 悲观更新 + ETag/updated_at 检查（本期先悲观，竞争留 300.7） |
| Agent 模式新手迷茫 | onboarding tooltip + "切回经典" 兜底 |
| 趋势图无数据展示空白 | EvalTrendChart 空数据态：占位文案 "暂无评估记录" |
| Tab 切换破坏 URL deep link | 旧 hash → 新 ?tab= 的 redirect 兼容 |
| 新增 /eval 一级路由破坏主导航 | 在 layout sidebar 显式加 Eval 入口；空状态友好（"暂无评估记录，运行 pnpm eval 开始"） |
| 终止按钮按错炸成本 | 二次确认弹层（"将立即停止 agent 并保留已产生的步骤" / 取消 / 确认） |

---

## 10. 面试题预埋清单

`.interview/feat-300.6_frontend.md` 8 题计划覆盖：

1. EventSource 的协议限制（POST / header / 重连） + 我们怎么绕 ⚠️
2. SSE 断线重连为什么不能"从头收" + stepIndex 作为 offset ⚠️
3. SSE comment 心跳前端不响应 + 应用层 watchdog ⚠️
4. 乐观 vs 悲观更新的判断框架（memory 选择悲观） ⚠️
5. 长文本/长列表的渲染性能（content-visibility / max-h / 虚拟化触发点） ⚠️
6. 灰度回滚 / 新功能 toggle + onboarding 一次性提示 ⚠️
7. "成功 ≠ 有变化"的 API 反馈语义（distill 四态） ⚠️
8. 图表自建 SVG vs 引库的边界 ⚠️

⚠️ = 这次规划阶段挖出来的"易忽略点"。
