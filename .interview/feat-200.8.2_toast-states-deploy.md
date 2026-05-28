# feat-200.8.2 + 200.8.3 — toast + 三态 + 部署联调

## Q1：toast 系统为什么自写不用 react-hot-toast / sonner 这类成熟库？

**考察点**：依赖管理、设计语言一致性、维护成本。

**答**：

成熟库的优势是显然的：

- 用法极简（`toast.success("...")` 一行）
- 动画 / 入退场 / 堆叠都打磨过
- 维护方修 bug

但代价也实在：

- 多 30-50KB gzip 依赖
- 默认样式跟项目色板不一定一致——需要 override，往往要钻 lib 内部 className 命名
- 样式 override 一旦 lib 升级可能失效
- 升级时偶尔遇到 breaking API

**我们的实际需求**很基础：4 个 variant、auto-dismiss、右下角浮动、可手动 X 关闭。约 200 行自写，**零依赖**，样式跟项目 CSS 变量（`var(--ok)` / `var(--err)`）完美贴合，未来想加"撤销操作"按钮也只是给 ToastItem 加个 `action?` 字段。

判断元规则：**如果某功能 = (200 行 + 0 依赖) 能搞定，且未来很可能需要项目特色定制，就自写；如果功能边界模糊或交互很多，就引库**。

这条规则也防止"为了用某个时髦库而引依赖"。

---

## Q2：你在 toast 里实现了一个 module-level `globalHandler`——它跟 React Context 重复吗？为什么需要两个？

**考察点**：React 体系内 vs 体系外的状态访问。

**答**：

不重复，**应对两种不同的调用方**：

**Context（useToast）**：

- 组件内使用，符合 React 范式
- 走 Provider 树，能感知 mount / unmount

**globalHandler**：

- **非组件代码**——典型场景是 apiFetch 全局错误捕获、zustand store 内部错误
- 这些代码不能调 hooks（hooks 必须在组件函数体内）
- module-level 变量让它们也能 push 错误 toast

实现细节：ToastProvider mount 时把自己的 api 注册到 `globalHandler`，unmount 时清空。这保证 globalHandler 只在 Provider 存活时可用，符合 React 的生命周期。

为什么不直接放 React 全局 state？

- 全局 state（如 zustand）本质上还是要在组件里 subscribe，跟 Context 一样的问题
- module-level 变量是最朴素的全局——纯函数代码可读取，不引入新的状态库

潜在风险：**如果 Provider 被多次 mount**（SSR + CSR hydrate）`globalHandler` 会被后 mount 的覆盖。MVP 阶段一个 SPA 不会出现这种场景，但如果未来要做多 Provider（如 micro-frontend），就要加引用计数。

---

## Q3：projects 列表的 Empty state 和 Loading skeleton 都加了——它们解决的是同一个问题吗？

**考察点**：UI 三态（loading / empty / error）的语义区分。

**答**：

是三个不同状态：

| 状态 | 含义 | UI |
|---|---|---|
| Loading | 我们正在拉数据，结果还没回来 | Skeleton 卡片（占位灰条 + shimmer 动画） |
| Empty | 数据回来了，但用户确实没有任何项目 | 引导插画 + "新建项目"行动 |
| Error | 拉失败 | 错误提示 + 重试按钮（本项目暂未实装 retry） |

为什么不能合并：

- "Loading 显示 Empty 文案" → 用户误以为没有，可能立即创建一个新的，结果数据回来后多了一份
- "Empty 显示 Loading skeleton" → 用户死等

技术上区分：

```ts
const showLoading = loading && projects.length === 0;
const showEmpty = !loading && projects.length === 0 && !creating;
```

- `projects.length === 0` 是必要前提
- 用 `loading` 区分前两态
- `!creating` 防止用户已经在创建表单上时还显示"还没有项目"的引导（视觉重复）

这种"四象限分支"在面对 async 数据时很常见。统一抽出 `<AsyncList loading empty error>` 组件能减少重复，但我没抽——目前只有项目列表完整三态，其他列表（notes / history）有自己的"没匹配 filter"等场景，过早抽象反而不灵活。

---

## Q4：`CREATE EXTENSION IF NOT EXISTS vector` 加在 `initSchema` 里——这种"应用启动时 DDL"模式有什么风险？为什么不用专门的迁移工具？

**考察点**：DDL 时机选择、迁移工具的价值与代价。

**答**：

风险有几条：

1. **多进程竞争**：N 个 API 实例同时启动都跑 DDL，可能撞 lock。但 PG 的 `CREATE EXTENSION IF NOT EXISTS` 是带 lock 的幂等，安全。
2. **首次请求慢**：第一次请求会跑全部 DDL（虽然 IF NOT EXISTS 都很快），延迟比后续高几十 ms。
3. **静态分析难**：DDL 散在 schema.ts 里，不像 migration 文件按时间命名能追溯版本。
4. **回滚困难**：没有 DOWN script，加错列就要写补丁 ALTER。

为什么仍然这么做：

- **MVP 单实例 + 单 DB**：竞争问题不存在
- **`IF NOT EXISTS` 全套**：表 / 列 / 索引都幂等，没人会跑碎
- **省一层维护成本**：不用学 Drizzle/Prisma migration 工具，pg-pool 直接跑 SQL
- **新 feature 一次性加 DDL 块**：在 schema.ts 里写好就完事，调试在本地直接 drop database 重来

什么时候要切到 migration 工具：

- 多节点部署 / 蓝绿发布开始出现 schema drift
- 团队 > 3 人，需要 PR review 时看清楚每次 schema 改了啥
- 开始有"在线表结构变更"需求（rename column 不能 drop+recreate）

这就是经典的 **"工程力量不到位时，写代码 < 装工具 < 等工程力"** 三段式——MVP 永远在第一段，能写代码解决就不装工具。

---

## Q5：`apiFetch` 的 BASE_URL fallback 设计成 `env > window.origin > localhost` 三级——`window.origin` 这一层解决什么实际问题？

**考察点**：前后端同站部署、SSR-vs-CSR 边界、运维便利性。

**答**：

实际场景：**Fly.io 单 VM 双进程部署**。

- 用户打开 `https://idea-maker.fly.dev` → 浏览器加载 Next.js
- 前端 JS 跑起来要调 API → 应该调哪个 URL？

三种选择：

| 方案 | 优势 | 代价 |
|---|---|---|
| 显式 `NEXT_PUBLIC_API_URL=https://idea-maker.fly.dev:3001` | 明确 | 多一个端口公开 + HTTPS 证书 + CORS 配置 |
| `NEXT_PUBLIC_API_URL=""` 然后用 nginx/Caddy 反代 `/api/*` | 同站零 CORS | 多一层反代配置 |
| **`NEXT_PUBLIC_API_URL` 留空，浏览器自动 `window.location.origin`** | 零配置；浏览器直接同站请求；nginx 反代或 Next.js rewrite 任选 | 需要前端代码知道 fall back 到 window.origin |

我选第三种——**让代码"在浏览器里就用当前域名"**，运维想搞 nginx 反代到 :3001、或者 Next.js rewrite 把 `/api/*` 转给 API，都行；不需要改前端 env。

为什么要 fall back 而不是默认就 window.origin：

- **服务端渲染 / 构建时**：`window` 不存在，必须先有 `env` 或 `localhost` 兜底
- **本地 dev**：Web :3000 直接调 API :3001，window.origin 会变成 :3000——错的
- 所以 dev / build / runtime browser 三个场景需要不同默认值

`resolveBaseUrl` 函数体内 `typeof window !== "undefined"` 判定 + env 优先级，把这三个场景全 cover 了。这是把"运维便利"内嵌进代码默认值的典型范式。

---
