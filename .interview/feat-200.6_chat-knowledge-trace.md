# feat-200.6 面试题：Chat 主界面 + 知识库 + PipelineTrace

## Q1: PipelineTrace 的伪动画为什么用 requestAnimationFrame 而不是 setInterval？

**考点**：浏览器渲染机制 / rAF vs timer / 性能

**答**：
- rAF 与浏览器刷新频率同步（60fps），每帧只算一次进度，不会跳帧或堆积
- setInterval 是宏任务，在 tab 不活跃时仍会执行造成 CPU 浪费；rAF 在 tab 隐藏时自动暂停
- rAF 回调的 `now` 参数是高精度 `DOMHighResTimeStamp`，用它算 elapsed 不会累积误差
- 动画平滑：rAF 保证每帧只渲染一次，不会在一帧内触发多次 setState 导致不必要的 reconciliation

**追问**：为什么不能在 useEffect body 直接 setState 来初始化进度？
→ React 严格模式下 + `react-hooks/set-state-in-effect` 规则认为 effect body 内同步 setState 会触发级联渲染。正确做法：用 `useState(initializer)` 设初值，动画值在 rAF 回调（异步）中 setState。

---

## Q2: Chat 页面的 generate 调用是同步阻塞的，有什么隐患？何时改为流式？

**考点**：用户体验 / SSE / 异步架构

**答**：
- **当前设计**：`POST /generate` 同步等后端完整结果（可能 5-10s），期间用伪动画反馈进度
- **隐患**：请求超时（Nginx 默认 60s）、无法取消、用户感知到"卡住"
- **流式方案（Week 8）**：改为 SSE 端点 `/generate/events`，后端在每个 stage 完成后推 event
  - 前端 EventSource 接收 `{type: "stage_complete", stageId, progress}`
  - PipelineTrace 切换为真实进度（替代伪动画）
  - stage output 渐进式展示（不用等全部完成）
- **API 兼容**：当前的 `GenerateResponse` 类型不变，SSE 最后一帧推送完整结果

---

## Q3: 知识库上传为什么不走 apiFetch 而是手动构建 fetch + FormData？

**考点**：HTTP Content-Type / multipart / 浏览器 API

**答**：
- `apiFetch` 统一设置 `Content-Type: application/json` + `JSON.stringify(body)`
- 文件上传必须用 `multipart/form-data`，且 **不能手动设 Content-Type**
  - 浏览器 fetch 发送 FormData 时会自动生成含 `boundary` 的 Content-Type
  - 手动设 `Content-Type: multipart/form-data` 会丢失 boundary → 后端解析失败
- 所以上传单独写 fetch，不传 Content-Type header，让浏览器自动处理
- token 从 localStorage 直接读（绕过 tokenGetter），因为上传函数在 API 层而非 store 层

**追问**：有更优雅的方式吗？
→ 可以给 `apiFetch` 加 `rawBody: FormData` 选项，当 body 是 FormData 时跳过 JSON.stringify + 不设 Content-Type。但 MVP 阶段只有一处上传，提前抽象反而增加复杂度。

---

## Q4: useStageProgress hook 里 finished 和 !running 的静态返回值为什么不用 useMemo？

**考点**：React 渲染优化 / 引用稳定性

**答**：
- `[100,100,100,100]` 和 `[0,0,0,0]` 是字面量数组，每次渲染创建新引用
- 但这里返回值只被 `PipelineTraceView` 的子组件用来读 `progress[i]`（原始值比较）
- 子组件没有依赖数组引用相等性（不做 `useEffect(fn, [progress])`）
- 如果下游确实依赖引用稳定性，可以用 `useMemo(() => [100,100,100,100], [])` 或模块级常量
- MVP 优先：性能瓶颈不在此处（4 个 PhaseRow 组件 re-render 成本可忽略）

---

## Q5: Sidebar 的 isActive 判断为什么 "对话" 路径用 === 而其他用 startsWith？

**考点**：路由匹配 / 前缀冲突

**答**：
- "对话"对应 `/projects/:id`（无后缀），"知识库"对应 `/projects/:id/knowledge`
- 如果对话也用 `startsWith(/projects/:id)`，那访问 `/projects/:id/knowledge` 时对话也会高亮（因为 `/projects/:id` 是前缀）
- 所以对话用 `===` 精确匹配，只在路径完全等于 `/projects/:id` 时高亮
- 其他子路由（`/knowledge`、`/history`、`/settings`）互不包含，可以安全用 `startsWith`
- Next.js 的 `usePathname()` 返回不含 query 的路径，适合此逻辑

---

## Q6: Chat 组件的状态机 idle→running→done 与 React 的声明式范式如何共存？

**考点**：状态机设计 / 声明式 UI / DX

**答**：
- **状态机本质是 UI 分支选择器**：`phase` 驱动"显示哪些区块" + "禁用哪些交互"
  - idle: 显示空白 + PresetGrid + ChatInput enabled
  - running: 显示用户消息 + PipelineTrace(running) + ChatInput disabled
  - done: 显示 PipelineTrace(finished) + GeneratedResult + ChatInput enabled
- **与声明式兼容**：JSX 用 `{phase === "running" && <PipelineTrace/>}` 条件渲染
- **替代方案**：xstate / zustand 状态机中间件，但 3 个状态 + 1 个 effect 足矣
- **扩展性**：Week 7 加"多轮对话"时，改为 `messages[]` 数组 + 每条 message 自带 phase
- 本质上 React 组件就是 `f(state) → UI`，状态机把 state 压缩到有限枚举，减少不合法状态组合
