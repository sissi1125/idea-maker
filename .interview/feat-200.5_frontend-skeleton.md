# feat-200.5 面试题：前端骨架 + 登录 + 项目管理

## Q1: 为什么用 zustand 而不是 React Context 或 Redux 做全局状态？

**考点**：状态管理方案选型 / bundle size / DX

**答**：
- zustand 零样板代码（无 Provider / Reducer / Action Types），MVP 阶段开发速度快
- bundle < 2KB（gzip），远小于 Redux toolkit（~12KB）
- 支持 `persist` middleware 开箱即用，直接存 localStorage
- 与 Next.js SSR 兼容良好：`createJSONStorage` + `onFinishHydration` 控制 hydrate 时机
- React Context 的问题：任何 state 变化会 re-render 整棵 subtree；zustand 用 selector 精准订阅

**追问**：zustand 的 `persist` middleware 在 SSR 环境下有什么陷阱？
→ localStorage 在 server 不存在，首次 SSR 渲染拿不到持久化数据，会出现 hydration mismatch。解决方案：延迟到 `onFinishHydration` 回调后再渲染需要持久化数据的 UI，或使用 `skipHydration` + 手动 `rehydrate()`。

---

## Q2: API client 的 tokenGetter 回调设计解决了什么问题？

**考点**：模块循环依赖 / 依赖反转

**答**：
- `lib/api/client.ts` 是底层 fetch 封装，`lib/stores/auth-store.ts` 依赖 `lib/api/auth.ts`
- 如果 client.ts 直接 import auth-store → 循环依赖（client → store → api → client）
- 解法：client.ts 暴露 `setTokenGetter(fn)`，在 Providers 组件 mount 时注入 `() => useAuthStore.getState().token`
- 这是 **依赖反转**（DIP）：底层模块不知道具体 store 实现，通过回调抽象获取 token
- 好处：API client 可独立测试（mock tokenGetter），store 替换不影响 client

---

## Q3: Next.js route groups `(auth)` / `(workspace)` 的设计意图？

**考点**：Next.js App Router / Layout 嵌套 / 路由组织

**答**：
- `(auth)` 组：登录/注册页面，无 Sidebar，全屏表单
- `(workspace)` 组：登录后的主界面，共享 layout.tsx（含 Sidebar + AuthGuard）
- 括号语法不影响 URL（/login 而非 /auth/login），纯粹是 layout 分组
- AuthGuard 只需写在 `(workspace)/layout.tsx` 一处，所有子路由自动保护
- `/playground` 独立于两个组，保留旧 RAG 调试入口

---

## Q4: Sidebar 项目切换器的状态管理与路由同步如何设计？

**考点**：前端状态 ↔ URL 同步 / 单一数据源

**答**：
- `currentProjectId` 存在 zustand store（persist 到 localStorage）
- 切换项目时同步做两件事：`setCurrentProject(id)` + `router.push(/projects/${id})`
- URL 是真正的 source of truth：`/projects/[id]/page.tsx` 在 mount 时从 `useParams` 读 id 并 `setCurrentProject`
- 这样直接访问 URL 或刷新页面都能正确恢复状态
- Sidebar 通过 `usePathname()` 判断 active 状态，不依赖额外 "route" state

---

## Q5: 原型组件 JSX → TSX 迁移时做了哪些关键改造？

**考点**：渐进式迁移 / 技术债管理

**答**：
- **inline style → Tailwind + CSS 变量混合**：保留 `var(--brand)` 语义色（30+ 变量迁入 globals.css），布局用 Tailwind utilities
- **全局 Icon 函数 → lucide-react**：原型用自定义 SVG `<Icon d="...">` 组件，替换为 tree-shakable 的 lucide 图标（如 `Brain`, `Search`, `DollarSign`）
- **全局变量 PROJECTS → zustand store**：原型 `window.PROJECTS` 静态数组，改为 API 拉取 + store 管理
- **callback prop → Next.js router**：原型 `onSignIn` / `setRoute` 回调，改为 `router.push()` + 路由分组
- **未迁移的保留原型**：Chat、AgentThinking、Upload 等 Week 6-7 再迁，避免过早改动

---

## Q6: 为什么 `partialize` 只存 token / currentProjectId，不存完整 user / projects？

**考点**：持久化策略 / 数据新鲜度

**答**：
- **token**：JWT 是无状态凭证，刷新页面后需要它才能调 API；必须持久化
- **user**：用户信息可能被后端修改（改名等），每次 hydrate 时 `refreshUser()` 从 `/auth/me` 拉最新
- **currentProjectId**：记住上次选中的项目，改善 UX；ID 是稳定标识不会变
- **projects 列表**：项目可能被删除/新增，持久化旧数据会导致幽灵项目；每次进 workspace 调 `fetchProjects()`
- 原则：**只持久化不常变且恢复成本高的数据**（token、选中 ID）；其余从 API 拉
