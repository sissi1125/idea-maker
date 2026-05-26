# 面试题 — pnpm Monorepo 骨架（feat-100.1）

相关文件：
- `pnpm-workspace.yaml` — workspace 范围声明
- `package.json` — 根级 workspace scripts
- `.npmrc` — pnpm 配置（hoist 策略）
- `apps/web/package.json` — Next.js 应用，name `@harness/web`
- `apps/api/package.json` — NestJS 应用占位
- `packages/{rag-core,shared-types}/package.json` — workspace 内 TS 源码包

---

## Q1：为什么选 pnpm 而不是 npm 或 yarn？

**答：**

三个关键差异：

| 维度 | npm | yarn classic | pnpm |
|------|-----|--------------|------|
| 磁盘占用 | 每个项目独立拷贝 | 每个项目独立拷贝 | 全局 store + 硬链接 |
| 安装速度 | 慢 | 中 | 快（硬链接 ≠ 拷贝） |
| 依赖隔离 | 平铺 hoisting 易出"幽灵依赖" | 同 npm | 默认严格 symlink，只允许 declared deps |
| monorepo | npm workspaces 弱 | yarn workspaces 中规中矩 | 一等公民，原生 `workspace:*` 协议 |

本项目最看重「严格依赖隔离」：apps/web 不能误用 packages/rag-core 没声明的传递依赖。pnpm 把每个包的 `node_modules` 做成隔离 symlink，逼着 package.json 写实，长期可维护性强。

代价：第三方 Next.js / Webpack 偶尔不识别 symlink，需要额外配置（见 Q4 transpilePackages）。

---

## Q2：`apps/` 和 `packages/` 的语义区别是什么？为什么这么划分？

**答：**

- **`apps/*`**：**可独立部署的应用**，有自己的入口（`next dev` / `nest start`），不被其他包 import。例：`apps/web`（Next.js 前端 + API routes 当前暂留）、`apps/api`（NestJS 后端，feat-100.3 起承接）。
- **`packages/*`**：**被 apps 引用的库**，不直接运行，只导出函数 / 类型。例：`packages/rag-core`（纯 RAG 算法）、`packages/shared-types`（前后端共享 zod schema）。

这个划分让职责清晰：
- `packages/rag-core` 可独立 vitest 单测，零启动开销
- `apps/api` 和 `apps/web` 都能 import `@harness/rag-core`，确保算法一份代码两处用
- 未来上 Turborepo / Nx 时按 apps/packages 加缓存策略也是标准做法

---

## Q3：`workspace:*` 协议是什么？和 `^0.1.0` 有什么区别？

**答：**

```json
{
  "dependencies": {
    "@harness/rag-core": "workspace:*",
    "next": "^16.2.6"
  }
}
```

- `^16.2.6`：从 npm registry 拉，按 semver 解析
- `workspace:*`：**本 monorepo 内的本地包**，pnpm 解析时直接 symlink 到 `packages/rag-core/`，不走 registry，永远拿最新源码

`publish` 时 pnpm 会把 `workspace:*` 自动改写成真实版本号（如 `^0.1.0`），所以发布出去后消费者无感知。本项目目前不发包，只在 monorepo 内部使用，所以一直保持 `workspace:*`。

陷阱：忘了写 `workspace:*` 而写成 `^0.1.0`，pnpm 会去 registry 找，找不到就装失败。

---

## Q4：apps/web 加了 `@harness/rag-core` 之后启动机器假死，为什么？怎么修？

**答（feat-100.2 启动时踩坑）：**

**现象**：`pnpm dev` 后 RSS 一路上涨、postcss.js 子进程大量 spawn、最终系统假死。

**根因**：
1. pnpm 把 `@harness/rag-core` symlink 到 `apps/web/node_modules/@harness/rag-core` → 指向 `packages/rag-core/`
2. Next.js 默认认为 `node_modules` 里的包都是**预编译过的 JS**，不会过 swc/babel
3. 但 `packages/rag-core/src/*.ts` 是**未编译的 TS 源码**
4. Turbopack 遇到 `.ts` 无法识别 → 重试 → 反复 spawn worker → 内存爆炸

**修复**：`next.config.ts` 加：

```ts
{
  transpilePackages: ["@harness/rag-core", "@harness/shared-types"],
  outputFileTracingRoot: path.join(__dirname, "../..")
}
```

`transpilePackages` 告诉 Next.js「这几个包虽然在 node_modules，但要按源码编译」。`outputFileTracingRoot` 告诉 Next.js 真实根在 monorepo 顶层，避免文件追踪反复全 workspace 扫。

**约定**：每加一个 workspace 包都必须登记到 `transpilePackages`。否则下次又会假死。

替代方案：在 `packages/rag-core` 加 build step 输出 `dist/`，consumer 引 `dist/index.js`。可行但开发期需要 watch 编译、loop 长。当前选择直接吃 TS 源更敏捷。

---

## Q5：根 `package.json` 里 `pnpm -r typecheck` 是什么意思？和 `pnpm --filter @harness/web typecheck` 区别？

**答：**

- `pnpm -r <script>`：在**所有 workspace 包**里依次跑 `<script>`（如果包里没定义就跳过）。`-r` = recursive。
- `pnpm --filter @harness/web <script>`：只在 `@harness/web` 这一个包跑。`--filter` 还支持依赖图过滤（`--filter ...@harness/web` = 该包 + 所有依赖它的包）。

我们的 init.sh 用 `pnpm -r typecheck` + `pnpm -r lint` 当质量门禁，一条命令覆盖 4 个包。CI 也走同样模式。

性能上 pnpm 默认并发跑（除非有依赖关系），所以 4 包 typecheck 几乎和单包一样快。

---

## Q6：`.npmrc` 里 `shamefully-hoist=false` 是什么含义？

**答：**

pnpm 默认严格隔离：每个包的 `node_modules` 只有声明的 deps（通过 symlink）。但有些老旧工具假设依赖是 hoisted 平铺的，会找不到包，此时可以 `shamefully-hoist=true` 退回 npm 风格的平铺。

我们设 `false`（默认值显式声明）= **严格模式**，强制让每个 package.json 写完整 deps 列表，杜绝幽灵依赖。代价是偶尔遇到不兼容工具要单独处理，比如 Next.js 的 transpilePackages 就是配套修复。

**"幽灵依赖"举例**：`apps/web` 没声明 `lodash`，但它依赖的 `some-lib` 装了 `lodash`，hoisting 后 `lodash` 出现在 `node_modules` 根，`apps/web` 代码 `import "lodash"` 居然能跑——直到某天 `some-lib` 升级删了 lodash，apps/web 就崩了。严格模式从根上避免。
