# feat-300.6 面试题：前端 AgentTracePanel + SSE 接入

> 围绕「**为什么这么设计**」展开。每题附「**关键差异化答案**」。

---

## 1. EventSource 的协议限制有哪些？你怎么绕？

**关键点**：3 个硬约束 + 对应解法。

| 限制 | 影响 | 解法 |
|---|---|---|
| 不支持 POST body | 启动 agent 需要传 messages，但 SSE 必须 GET | **两步式**：POST /agent/run → 拿 runId → GET /stream |
| 不支持自定义 header | `Authorization: Bearer` 注入不进去 | URL query `?token=xxx`；后端 SSE Guard 接受 query 作为 Authorization 兜底 |
| 重连默认从头连同一 URL | 后端 stream 不重放历史 → 漏帧 | 自己关连接 + **GET /steps 拿历史 + new EventSource**；用 stepIndex 去重 |

**面试卖点**：
- 启动两步式有"丢前几帧"陷阱（POST 返回时后端 ReAct 已经在跑，SSE 连上前可能错过 step 0/1）
- 解法：**并行**调 GET /steps（limit=200）和 connectSSE，用 stepIndex 做幂等合并 —— 跟 Kafka consumer 的 offset 是同一种思路
- URL token 的代价：access log 会写 → 用短期 access token（JWT 1h），不要让 SSE token 是长期 refresh token
- WebSocket 没这问题（subprotocol 可塞 token），但 WS 需要自己写心跳 + 重连，复杂度更高

参考：[useEventSourceWithReplay.ts](apps/web/lib/hooks/useEventSourceWithReplay.ts) 的 connect / fetchHistory 并行策略。

---

## 2. 断线重连为什么不能"从头收"？

**关键点**：EventSource 自动重连解决 TCP 层问题，不解决业务层。

EventSource 内置的自动重连默认行为：网络断 → 浏览器自己 retry → 重新连接同一 URL。

**陷阱**：我们后端 stream 端点不会重放历史，所以重连后只能收到"从重连那一刻起"的新帧，断线期间发出的帧永远丢。

**解法**：禁用浏览器默认重连，自己控流。
1. `onerror` 触发 → 关掉旧 EventSource
2. 调 GET /steps 拿全量历史
3. 与已渲染的 entries Map 按 stepIndex 合并去重（key 重复直接 set 覆盖）
4. new EventSource 接后续帧

**面试卖点**：
- "事件流系统的 at-least-once vs exactly-once"——我们靠 stepIndex 唯一约束在前端做 dedup
- 类比 Kafka consumer commit offset：stepIndex 就是我们的 offset
- 后端协议 vs 浏览器协议的边界——TCP 层重连不等于业务层 idempotent
- 用 Map 而不是数组：O(1) set 覆盖 vs O(n²) findIndex 去重

参考：[useEventSourceWithReplay.ts](apps/web/lib/hooks/useEventSourceWithReplay.ts) 的 doReconnect 流程。

---

## 3. SSE 心跳为什么前端不响应？watchdog 怎么做？

**关键点**：SSE comment 帧浏览器静默忽略，应用层要监控"无任何事件"。

后端发 `: heartbeat\n\n`（SSE comment 帧）保活防 Cloudflare/nginx 切断。浏览器 EventSource 的处理：
- comment 帧不触发 `onmessage`
- 也不触发 `onerror`
- 我们**无法**直接监听心跳

**解法**：45s watchdog 监控"上一个事件距今多久"（含 message / 各自定义 event 类型 / open 事件，都 reset 计时）。45s 无任何事件 → 怀疑代理已切断 → 主动触发重连流程。

**面试卖点**：
- "心跳工作"= 应用层应主动监控**无事件时长**，不只看 `onerror`
- 反向代理 buffer 配置（nginx `X-Accel-Buffering: no`）前端无法控制 → 必须在前端做兜底
- 时间窗口选择：心跳 15s（后端） < watchdog 45s（前端） < Cloudflare 100s（基础设施）——3 层防御递增
- 类比 TCP keepalive 的应用层版本

参考：[useEventSourceWithReplay.ts](apps/web/lib/hooks/useEventSourceWithReplay.ts) 的 resetWatchdog / watchdogTimeoutMs。

---

## 4. 你做了哪些受控/非受控混合的组件？为什么？

**关键点**：AgentStepCard 的 `forceExpanded` prop = 父组件 override 自身状态。

```tsx
const [selfOpen, setSelfOpen] = useState(meta.defaultOpen);
const open = forceExpanded !== undefined ? forceExpanded : selfOpen;
```

**为什么这样设计**：
- 默认每张卡 reasoning 展开、tool_result 折叠（不同 stepType 不同初值）
- 顶部「全部展开/折叠」按钮要能 override 所有卡片
- 用户点单张卡仍能切换（只影响 selfOpen，父组件释放 force 时反映用户最近选择）

**反模式（我最初的实现）**：
```tsx
useEffect(() => {
  if (forceExpanded !== undefined) setOpen(forceExpanded);
}, [forceExpanded]);
```
触发 ESLint `react-hooks/set-state-in-effect`——cascading render + 状态同步反模式。

**正确实现**：**派生 state** 而非 effect 同步。

**面试卖点**：
- "Effect 同步外部 → 内部 state" 是 React 19 的反模式（官方文档《You Might Not Need an Effect》）
- 受控 / 非受控混合的合理用法：默认非受控（self），父传 prop 时受控（force），不存第二份真值
- 这与表单的 `defaultValue` (uncontrolled) vs `value` (controlled) 是同一种模式

参考：[AgentStepCard.tsx](apps/web/components/agent/AgentStepCard.tsx) 的 selfOpen / forceExpanded。

---

## 5. 自动滚到底但用户上滚要暂停——怎么实现？

**关键点**：sticky bottom 行为 + onScroll 检测距底距离。

```tsx
const stickToBottomRef = useRef(true);

useEffect(() => {
  if (stickToBottomRef.current && scrollRef.current) {
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }
}, [steps.length]);

const onScroll = () => {
  const el = scrollRef.current;
  if (!el) return;
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottomRef.current = distFromBottom < 100;
};
```

**为什么 100px 阈值**：
- 用户精确滚到底太苛刻（鼠标滚轮 / 触控板有惯性）
- 100px = 大约 1-2 行内容的距离，「快滚到底」就视为想看新内容
- 类似 macOS 滚动到底的"吸附"行为

**面试卖点**：
- 用 ref 而不是 state：滚动时不触发 React 重渲染（onScroll 50fps+ setState 会卡）
- scrollIntoView vs scrollTo：scrollIntoView 会让父元素滚动可能引起页面跳，scrollTo 精确控制
- behavior: "smooth" 在 step 频率 < 200ms/step 时会丢动画——这里 LLM 步骤间隔通常 1-5s，smooth 体验好

参考：[AgentTracePanel.tsx](apps/web/components/agent/AgentTracePanel.tsx) 的 stickToBottomRef。

---

## 6. AgentMode toggle 的灰度迁移路径

**关键点**：新功能默认开 + 一键回退 + 错误兜底链路。

**实现**：
- `useUiStore.agentModeEnabled` 默认 `true`，zustand persist localStorage
- agent 失败时错误 banner 自带「切回经典模式重试」按钮 → 一键 `setAgentModeEnabled(false)` + 用相同 prompt 重跑老 /generate
- 经典模式入口永不下线 → 老路径作为 fallback safety net

**为什么默认开**：
- 项目核心卖点是 Agent；默认关 = 用户永远看不到
- 简历项目场景（GitHub 静态展示）：截图必须看到 trace；默认关意味着每个看简历的人都要去找开关
- 真生产环境会默认关 + 灰度按用户/项目放量 —— 这是不同场景的不同决策

**面试卖点**：
- "灰度回滚开关"——新功能默认开 + 一键回退；保留老路径直到指标稳定
- 用户级 localStorage 而非项目级 DB：偏好跨项目通用，不污染项目数据模型
- 默认值的判断框架：**用户场景的 cost of "看不到" vs cost of "被吓到"**
  - demo 项目：看不到 cost 高 → 默认开
  - 生产产品：被吓到 cost 高 → 默认关

参考：[ui-store.ts](apps/web/lib/stores/ui-store.ts) + [page.tsx](apps/web/app/(workspace)/projects/[id]/page.tsx) 的 「切回经典模式重试」按钮。

---

## 7. Distill 触发的 API 反馈语义——"成功"≠"有变化"

**关键点**：四态返回设计。

后端 `POST /memory/distill` 可能返回：
```
{ triggered: true, inserted, merged, processed }       // 真的跑了
{ triggered: false, skipped: "no_new_feedback" }       // 没新 feedback
{ triggered: false, skipped: "in_flight" }             // 别人正在跑
{ triggered: true, skipped: "no_candidates", processed: N }  // 跑了但 LLM 说无可蒸
```

**面试卖点**：
- "200 OK" 不等于"产生了用户期望的变化"——API 设计要让前端能区分
- 用 boolean 字段 `triggered` + 字符串 `skipped` 而不是 HTTP status：
  - 209 / 202 等 status 各家解释不一，client 难判
  - JSON 字段语义清晰、可扩展（未来加新 skipped 原因不破坏现有 client）
- 时间相关反馈（5s cooldown 防狂点）放前端做：后端不应假设客户端会节流
- 类比 idempotent POST：调一次有变化、调第二次没变化都该是 200

参考：[memory.ts](apps/web/lib/api/memory.ts) 的 DistillResult。

（注：MVP scope 暂未做 MemoryPanel UI，此题论证后端 API 设计；前端 UI 在任务 8 实现时落地。）

---

## 8. Trace 长文本展开的渲染性能

**关键点**：30 个 step 全展开 = 90KB+ DOM，长中文文本布局慢。

**实现**：
- 默认折叠 tool_result（信息密度低、长度大）
- 展开后用 `<pre className="max-h-[400px] overflow-auto">` 限定容器
- `whitespace-pre-wrap break-words`：长 URL / 中文长字不撑破布局
- super long（≥ 4000 字）展示 preview + "在新页签打开"链接（独立路由留 300.7）

**未做但提到的优化**：
- `content-visibility: auto`：让浏览器跳过屏外卡片的布局/绘制，可省 50%+ 滚动卡顿。但 IE/旧 Safari 不支持
- React 列表虚拟化（react-window）：当 step 数 > 100 才值得，本期 maxSteps=12 不需要

**面试卖点**：
- "可视化库不是免费的"——能用 CSS 解决的不要 JS
- 阈值思维：什么数量级用什么技术？
  - n < 100：直接渲染
  - 100 ≤ n < 10000：content-visibility / 折叠 / 分页
  - n ≥ 10000：虚拟化
- 长中文文本与长拉丁文本的布局差异：中文无空格断词，必须 `break-words`/`overflow-wrap: anywhere` 才不撑破

参考：[AgentStepCard.tsx](apps/web/components/agent/AgentStepCard.tsx) 的 JsonBlock 长文本处理。

---

## 9. 第一次跑通时撞到的真实 bug：「provider 抽象的漏抽」

**关键点**：默认值散落 3 处 → 换 provider 时哪一层漏改都炸，错误信息还会误导你查错方向。

**事故现场**：第一次接 GLM + Ollama bge-m3 跑 agent，后端报错：
```
AI_ToolExecutionError: Error executing tool search_kb:
  404 model "text-embedding-v4" not found, try pulling it first
```

第一直觉：「ollama 没装 text-embedding-v4」→ 去 `ollama pull text-embedding-v4`。
**错——这是 Qwen 的命名，不是模型本身的名字。**

**根因**：embedding model 默认值散落在 3 处：
1. `.env`：`EMBEDDING_MODEL=bge-m3` ✓（用户改了）
2. `ProvidersService.createEmbeddingClient`：读 env 拿到 bge-m3 ✓
3. `search-kb.tool.ts`：**硬编码 fallback `"text-embedding-v4"`** ✗
4. AgentRunner 没把 (2) 的 `defaultModel` 透传给 (3) → fallback 触发

完整调用链：
```
.env → ProvidersService → AgentRunner.embedding.defaultModel
                                       ↓（漏传）
                                ctx.options ← search-kb.tool ← fallback "text-embedding-v4"
```

**修复（两层）**：
- **修 A**：[agent-runner.service.ts:185](apps/api/src/agent/agent-runner.service.ts) 把 `embedding.defaultModel` 透传到 `ctx.options.embeddingModel`
- **修 B**：[search-kb.tool.ts:73](apps/api/src/agent/tools/search-kb.tool.ts) 删掉硬编码 fallback，改为 **fail loud** 抛错——以后再有类似问题立刻知道是哪一层没注入

**面试卖点**：
- **错误信息会误导你查错方向**：tool 默默 fallback 到错的 model 名，错误来自 ollama 而非 tool 自己 → 第一直觉去查 ollama
- **抽象层的「漏抽」**：API 表面看起来 provider-agnostic（创建 client 走 env），但深层有 Qwen-specific 假设。这种"半抽象"比纯硬编码更危险（看起来通用、实际只在某种环境下通用）
- **Fail loud vs silent fallback**：silent fallback 把"配置错"延后到"运行时"才暴露，且 stack trace 指向无辜的下游（ollama）。改成抛错后，配置错→ 立刻在启动期暴露在源头
- **检验抽象是否「真抽象」的方法**：换一个 provider 跑一次。能跑就是真抽象，跑不通就是假抽象——这次的事故就是经典「假抽象」被换 provider 揪出来的过程
- 类比：JDBC 是真抽象（换 MySQL/Postgres SQL 大部分不动），ORM 的方言函数是假抽象（一换就炸）

参考：
- [agent-runner.service.ts:185](apps/api/src/agent/agent-runner.service.ts) ctx.options 注入
- [search-kb.tool.ts:73](apps/api/src/agent/tools/search-kb.tool.ts) fail loud 兜底
- 3 个测试用例同步更新（output-limits / search-spill / search-kb），暴露"测试代码自己也在帮硬编码续命"的反模式

---

## 10. 第二个真实 bug：「假装异步」的阻塞式 HTTP handler

**关键点**：API 设计文档和实际行为脱节，是最难抓的"半完成"代码。

**事故现场**：浏览器发一条消息，AgentTracePanel 渲染出来后**永远卡在"Agent 正在启动…"**，但后端日志显示 ReAct 在跑、tool 在调、token 在烧。

**根因**：[agent.controller.ts](apps/api/src/agent/agent.controller.ts) 注释写：
> "前端不需要等待这个 response，真正的实时输出走 SSE"

实现却是：
```ts
@Post("run")
async startRun(...) {
  // 这里 await 等到整个 ReAct 跑完才返回
  return this.db.withClient((pgClient) => this.runner.run(pgClient, input));
}
```

调用链：
```
前端: const { runId } = await runAgent(...)  ← 阻塞 60-120s
     ↓ 拿到 runId 时 run 已结束
前端: connectAgentSSE(runId)  ← 太迟了，SSE 流是空的
```

**修复（两步）**：
- 新增 [`runner.startInBackground()`](apps/api/src/agent/agent-runner.service.ts) 方法：
  - run() 创建 agent_runs row 后立即触发 `onIdsReady` 回调把 ids 暴露给 caller
  - caller 几十毫秒拿到 ids，余下 ReAct 在 background 跑不被 await
- Controller POST /run 改调 startInBackground，**142ms 返回**（vs 之前 60-120s）

**面试卖点**：
- **代码注释 ≠ 合约**：注释说"非阻塞"，实现却 await，是工程上的脏债，且 TypeScript 类型层抓不出来
- **Node 单进程 + Promise GC 的天然属性**：fire-and-forget 不会因为主请求结束而进程退出——promise chain 持有引用，GC 不会回收。所以 background run 安全
- **怎么发现的**：浏览器实际跑一遍才暴露。这是「**单测可以全过但产品根本跑不通**」的活样本——单测不验证「POST 返回时机」这种行为契约
- **POST + GET 两步式 SSE 是 EventSource 协议限制的标准绕过**：浏览器 EventSource 不支持 POST body，所以业务层必须分两步（POST 拿 runId → GET /stream），这种解法又给"POST 应该多快返回"留了模糊空间——文档不写清楚就出此类 bug

参考：
- [agent.controller.ts](apps/api/src/agent/agent.controller.ts) `startRun` 端点改造
- [agent-runner.service.ts](apps/api/src/agent/agent-runner.service.ts) `startInBackground` + `run(_, _, hooks)`

---

## 11. 第三个真实 bug：「事件总线 fire-and-forget」+ SSE「订阅迟于事件」

**关键点**：典型的发布-订阅竞态——发布者比订阅者快。修了 #10 之后才暴露。

**事故现场**：runId 现在 200ms 拿到了，前端立刻 `new EventSource(.../stream)`。但 trace 仍然空——AgentTracePanel 卡在"Agent 正在启动…"。后端日志显示 SSE 不停 `[sse-open]` → 几秒后断 → 再 `[sse-open]` → **重连死循环**。

**根因**：[agent-sse.service.ts](apps/api/src/agent/agent-sse.service.ts) 原版用 `fromEvent(eventBus, ...)` 转 RxJS Observable。`fromEvent` 是 fire-and-forget——**只接收订阅后发出的事件**。

调用时序：
```
T+0    POST /agent/run 返回 runId（背后 ReAct 立刻开跑）
T+50   AgentRunner emit step#0  ← fromEvent 还没人订阅，事件丢
T+200  浏览器 connectSSE → controller.subscribe(runId) → fromEvent 开始监听
T+400  AgentRunner emit step#1  ← 这次能收到
T+4000 run done, finish 帧发出 ← 收到
```

但因为 step#0 丢了，整个流前 200ms 是空白；浏览器 EventSource 长时间无数据 → onerror → 触发我们 hook 里的 watchdog reconnect → 又一次空白 → 死循环。

**修复**：用 `ReplaySubject` per-runId 缓冲所有事件：
```ts
private buffers = new Map<string, ReplaySubject<AgentSseFrame>>();

emitStep(p) {
  this.getBuffer(p.runId).next({ type: 'step', data: p });  // 进缓冲
  this.eventBus.emit(...);  // 兼容性，留 EventBus 外部订阅入口
}

subscribe(runId) {
  // ReplaySubject 自动回放历史 + 接收实时 → 天然解决竞态
  return merge(this.getBuffer(runId).asObservable(), keepalive$).pipe(...);
}
```

加 60s TTL 清理避免内存泄漏（finish/error 后延时 unmount）。

**面试卖点**：
- **Pub-Sub 的经典竞态**：subscriber 慢于 publisher 时事件丢失。同样的问题出现在 Kafka 消费者落后于生产者、Redis Stream 没设 consumer group、浏览器 WebSocket 重连后丢消息……
- **解法谱系**：
  - `Subject`：fire-and-forget，订阅前丢
  - `BehaviorSubject`：只缓最近 1 个值
  - **`ReplaySubject(N)`：缓最近 N 个（or 全部），订阅时回放 → 本场景用**
  - 持久化方案：Kafka offset / DB queue（重启也不丢）
- **为什么我们不持久化**：agent run 寿命 ~10s，进程内 buffer 就够；持久化是给跨进程/重启场景的
- **为什么不用 `shareReplay`**：那是给上游 observable 共享多订阅者的，本场景没有上游 source observable，是手动 next() 推
- **怎么发现的**：手动 curl SSE 端点能看到事件流——浏览器 reconnect loop 是表象，underlying 是 "SSE 流是空的"。诊断这种 bug 关键是分层：先用 curl 确认协议层有没有事件，再回到浏览器看 hook 层
- **测试盲区**：199 单测全过，因为没有「**整个端到端发消息+订阅 SSE+收到事件**」的集成测试。单测 mock 了 SSE service / event bus，掩盖了真实订阅时序。这是单测最大局限：**单测能证 unit correctness，不能证 system correctness**

参考：
- [agent-sse.service.ts](apps/api/src/agent/agent-sse.service.ts) ReplaySubject 替换 fromEvent
- 与 [useEventSourceWithReplay.ts](apps/web/lib/hooks/useEventSourceWithReplay.ts) 前端去重回放配合，构成「双层防御」：前端处理 SSE 重连断流，后端处理 SSE 订阅迟于事件

---

## 12. 第四个真实 bug：「close() 触发的 onerror 被误判为异常断开」

**关键点**：清理动作的副作用反过来触发了自己的「错误恢复路径」，是控制流自相矛盾的经典样本。修完 #11 之后才暴露。

**事故现场**：用户能看到 trace 流出来 + 最终文案渲染，但浏览器 Network 显示 `/stream` 请求**持续不停**（每秒新增）。后端日志也是 `[sse-open] [sse-open] [sse-open]` 不断刷屏。

**调用时序**：
```
T+0      ReplaySubject 推 finish 帧
T+1      handleAny("finish") → setStatus("closed") → closeStream()
              closeStream():  es.close() + esRef.current = null
T+1.5    es.close() 副作用：浏览器触发 es.onerror
T+1.5    onerror 检查 `esRef.current?.readyState !== EventSource.CLOSED`
              esRef.current 是 null → null?.readyState = undefined → undefined !== CLOSED → true
              → doReconnect() → new EventSource → ReplaySubject 回放 finish 帧 →
              又 closeStream → 又 onerror → ...死循环
```

**根因**：optional-chain `null?.x` 短路返回 `undefined`，与目标常量 `EventSource.CLOSED` 不相等，把"已清理"误判为"异常断开"。这是 JS optional-chain 语义和业务条件的不匹配。

**修复**：显式 `finishedRef` 终态标记：
```ts
const finishedRef = useRef(false);

// 收到 finish/error 帧时
finishedRef.current = true;
closeStream();

// onerror 三重防御
es.onerror = () => {
  if (!aliveRef.current) return;          // unmount 防御
  if (finishedRef.current) return;        // 终态防御：业务已经说完了
  if (esRef.current !== es) return;       // stale 闭包防御：esRef 已替换
  doReconnectRef.current();
};
```

新 run 启动时（runId 变 → connect/fetchHistory 引用变 → 启动 effect 重跑）必须 reset `finishedRef.current = false`，否则新 run 的 onerror 永远不会重连。手动 reconnect() 也要 reset。

**面试卖点**：
- **副作用反向触发清理动作触发的状态**：这是「control flow 自咬尾巴」的典型——A 完成后调 cleanup(A)，cleanup(A) 又导致 A 的错误回调，错误回调又认为 A 要恢复... 看不见的循环
- **optional-chain 不是空安全万能药**：`null?.x === undefined`，但 `undefined !== Y` 通常为真，与你想表达的"如果 x 不是 Y 就...."经常意图相反
- **隐式状态 vs 显式状态**：用 readyState 判定本质是"读对象残留状态"，不可靠；finishedRef 是"我们的业务事实"，是 single source of truth
- **三重防御的工程价值**：unmount / finished / stale-closure 三层独立判定，任何一个改了不影响其他——比写一个 复杂 if 更易维护
- **如何系统性发现这类 bug**：网络面板看到"持续相同 URL 请求"几乎肯定是 reconnect loop；只要看到这个模式，就 grep onerror / addEventListener('error')，找清理动作和恢复动作的耦合
- **类比**：React `useEffect` cleanup 函数里改 state 会触发 re-render 再触发 effect，**清理函数中的 setState 是经典自咬尾巴**，这次 SSE 是一样的反模式

参考：
- [useEventSourceWithReplay.ts](apps/web/lib/hooks/useEventSourceWithReplay.ts) `finishedRef` + 三重 onerror 防御
- 这是 ReplaySubject 修复（#11）后才暴露的下一层 bug——典型的「修了 A 才能看到 B」

---

## 13. 第五个真实 bug：「useEffect 依赖不稳定」+ 静默无限循环

**关键点**：用 `console.log` 抓到 effect 跑了 **2294 次**。这是 React hooks 最隐蔽的 bug 之一——单测全过、TS 编译干净、ESLint 不报错，但产品在浏览器里炸成无限循环。

**事故现场**：修完 #12 finishedRef 防御后，**浏览器仍然持续 reconnect**。后端 log 看到 `/stream → /steps → /stream → /steps` 几十次每秒。

加 console.log 抓真相：
```
[SSE-DEBUG] startup effect, enabled= false ...     (×2)
[SSE-DEBUG] startup effect, enabled= true ...      (×2294)
```

**根因**：`useEventSourceWithReplay` 的启动 effect 把所有"读到的" callback 都放进 deps：
```ts
}, [enabled, connect, fetchHistory, mergeHistory, closeStream, doConnect]);
```

而 `doConnect` 自己又 useCallback 依赖 `parseEvent / getEntryKey / isEntryEvent / onAux / onFinish`：
```ts
const doConnect = useCallback(() => {...}, [
  connect, parseEvent, getEntryKey, isEntryEvent, onAux, onFinish, ...
]);
```

调用方 `useAgentRun` 传入时用 inline 箭头字面量：
```ts
useEventSourceWithReplay({
  // ...
  getEntryKey: (e) => e.stepIndex,            // ← 每次 render 新函数
  isEntryEvent: (t) => t === "step" || ...,   // ← 每次 render 新函数
});
```

链式失稳：
```
每次 render →
  getEntryKey/isEntryEvent 新身份 →
    doConnect useCallback 重算（identity 变）→
      启动 effect deps 变 →
        cleanup（关 SSE）+ 重跑（reset finishedRef + 新 fetchHistory + 新 SSE）→
          fetchHistory 返回时 setEntries → state 变 → re-render →
            循环
```

每 render 都关连接开新连接 + 重置 `finishedRef = false`。**`finishedRef` 永远活不过一次 render**——这是为什么 #12 防御看似正确但仍然循环。

**修复**：分清楚 useEffect deps 的两种语义：
- 「**该不该重启效果**」（语义依赖）：放 deps
- 「**避免闭包陷阱读旧值**」（句法依赖）：放 ref

`doConnect / mergeHistory / closeStream` 属于后者——它们身份变了但**行为不变**（因为闭包捕获同样的值）。所以：
```ts
const doConnectRef = useRef(doConnect);
const mergeHistoryRef = useRef(mergeHistory);
const closeStreamRef = useRef(closeStream);
useEffect(() => {
  doConnectRef.current = doConnect;
  mergeHistoryRef.current = mergeHistory;
  closeStreamRef.current = closeStream;
}); // 每 render 同步 ref，不放 deps

useEffect(() => {
  // ...用 doConnectRef.current() 而非 doConnect()...
}, [enabled, connect, fetchHistory]); // ← 只放语义依赖
// eslint-disable-next-line react-hooks/exhaustive-deps
```

**面试卖点**：
- **`react-hooks/exhaustive-deps` lint 是好心的暴政**：它把"读了什么"等价于"该不该重跑"，但这俩根本不是一回事
  - 读了一个 callback 不一定要在它身份变时重跑
  - 一个 callback 身份变了不一定行为变（闭包语义）
  - lint 没法判断"语义依赖" vs "句法依赖"，只能保守地全部塞进 deps，开发者自己取舍
- **「身份变 ≠ 行为变」是 React 闭包模型的核心**：
  - useCallback 的 deps 控制"什么时候返回新函数"
  - useEffect 的 deps 控制"什么时候 re-run"
  - 这两个不是同一种语义。强行 1:1 对齐会出问题
- **Ref 隔离是 React 工程的标配工具**：
  - 想读最新值但不想重启：`ref + useEffect(() => { ref.current = latest })`
  - 这种模式在 React docs 叫 "Latest Ref Pattern" / "Effect Event Pattern"（React 18 + 提出官方 useEffectEvent，未稳定）
- **抓这种 bug 的标准动作**：
  - Network 看到周期性相同请求 → reconnect loop
  - 加 `console.log("effect, enabled=", enabled)` → 看 effect 跑几次
  - 如果跑无数次，对照 deps 一项项查"它身份为啥变"
- **三层 bug 叠加才暴露**（#11 → #12 → #13）：
  - 不修 #11 看不到 reconnect（因为根本没 finish）
  - 不修 #12 看不到 #13（因为 #12 把 reconnect 关一关再说）
  - 修了 #12 才能看到「即使 finishedRef 防御了，循环还在」→ 顺藤摸瓜到 effect deps
- **单测的盲区再次出现**：199 单测全过——单测都是 mount 一次跑断言，**永远不会暴露"render 重复无限"**这类问题。需要 Profiler / Strict Mode / 实际跑

参考：
- [useEventSourceWithReplay.ts](apps/web/lib/hooks/useEventSourceWithReplay.ts) ref 隔离 doConnect/mergeHistory/closeStream
- 加调试 console.log 抓 effect 调用次数是必修技
- 类似 bug：`useEffect(() => setSomething(), [obj])` 当 obj 是新对象字面量时也会无限循环——同源问题
