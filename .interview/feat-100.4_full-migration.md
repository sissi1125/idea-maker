# 面试题 — feat-100.4 Wave 4：完整迁完 + Next.js routes 退场

Wave 3 是"灰度切换"，Wave 4 是"完全切换"。这次面试题聚焦：**绞杀者完成**、**模块化设计**、**清理时机判断**。

相关代码：
- `apps/api/src/pipeline/*.controller.ts`（14 个新 controller）
- `apps/api/src/snapshots/{snapshots.service,snapshots.controller,pipeline-runs.controller,snapshots.module}.ts`
- `apps/api/src/pipeline/pipeline.module.ts`（更新）
- `apps/web/lib/api-base.ts`（取消白名单）
- 删除：`apps/web/app/api/*`、`lib/providers.ts`、`lib/snapshotDb.ts`

---

## Q1：Wave 3 留了 14 个 stage 在 Next.js routes 作为 fallback，Wave 4 一次性全删。这是不是太激进？

**答：不激进——Wave 3 的双跑期已经验证了机制可行**

绞杀者模式（Strangler Fig）不是无限灰度。它分三阶段：

1. **建管道**（Wave 3 早期）：搭起 NestJS 骨架，把 ExceptionFilter / DI / Provider 工厂跑通
2. **共存验证**（Wave 3 后期）：5 端点双跑，证明 NestJS 在生产语义下行为完全一致
3. **快速收割**（Wave 4）：剩余端点机械迁移，删旧路由

每个阶段必须有明确退出条件，否则就退化成"永久双跑"——技术债越积越多。

Wave 3 的 5 端点已验证：
- DI 元数据通路 OK（ts-node-dev 配置稳）
- PipelineExceptionFilter 翻译 PipelineError / ZodError / NotFoundException 全 case 跑通
- 跨进程数据共享 OK（apps/web 和 apps/api 共用 documents.json）
- 前端切换层 api-base.ts 接口稳定

剩余 14 stage 都是同一模式的复制粘贴。延后只是浪费时间。

---

## Q2：14 个 controller 怎么做到一致性 vs 不重复？

**答：Template Method 隐式 + Service 显式共享**

每个 controller 都长这样：

```ts
@Controller("pipeline/xxx")
export class XxxController {
  constructor(private readonly providers: ProvidersService /* 按需 */) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput) throw new PipelineError("...", "...");
    const methodId = XxxMethodId.parse(body.methodId);
    const params = XxxParamsSchema.parse(body.params);

    // 按需注入 client
    let llmClient = ...;

    const result = await runXxx({ methodId, params, upstream: ..., llmClient });

    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
```

**4 个变量**：
1. 路径段（`pipeline/xxx`）
2. Input body 结构（upstreamOutput / pipelineRun）
3. Method enum + Params schema
4. 需要哪些 client（无 / LLM / pg / TEI / 组合）

**共享靠 Service**：所有 LLM/Embedding/Pg client 创建逻辑在 `ProvidersService`；所有 doc 操作在 `DocStoreService`。Controller 只调注入的方法，不自己 new。

**为什么不做 abstract BaseController**：feat-100.2 设计模式总览（Q11）讨论过同样问题——14 个 stage 注入需求差异太大，强行抽象类反而把简单的 controller 复杂化。"复制后调整"比"先抽象后填空"更可控。

---

## Q3：SnapshotsModule 怎么用 ProvidersService 的 pg client？

**答：跨模块导出 + 显式 imports**

```ts
// pipeline.module.ts
@Module({
  providers: [ProvidersService],
  exports: [ProvidersService],  // ← 关键
  controllers: [...],
})
export class PipelineModule {}

// snapshots.module.ts
@Module({
  imports: [PipelineModule],     // ← 关键
  providers: [SnapshotsService],
  controllers: [SnapshotsController, PipelineRunsController],
})
export class SnapshotsModule {}
```

NestJS DI 默认是**模块内可见**。要在 B 模块用 A 模块的 provider，A 必须 `exports`，B 必须 `imports`。

**为什么不把 ProvidersService 提到 AppModule 全局**：会破坏模块边界。SnapshotsModule 单独跑测试时（mock pg），全局 provider 比模块依赖更难替换。

**为什么不在 SnapshotsModule 自己 new pg.Client**：违反 DI 原则——所有 client 创建逻辑必须经过 ProvidersService 单一入口，保持 env 优先级一致。

---

## Q4：snapshots / pipeline-runs 端点在没配 DATABASE_URL 时不抛 500 而是返回空数组，为什么？

**答：宽松输入语义（Tolerant Reader）+ 业务约定**

```ts
@Get()
async listAll(@Query("connectionString") cs?: string) {
  const resolved = this.snapshots.resolveConnectionString(cs);
  if (!resolved) return { snapshots: [] };  // ← 静默
  // ...
}
```

**原因**：

1. **Playground 启动时不强制 DB**：用户可能只想做 chunk / preprocess 等纯算法操作，不需要 pg。让 GET 返回空数组就行，不阻塞页面
2. **保持与 Next.js 原行为一致**：feat-100 之前的 routes 就是这么写的，迁移期不改语义
3. **写操作另说**：POST `/pipeline-runs` 没 DB 就 400 — 因为用户主动想保存东西，缺 DB 必须明确报错

**对比**：如果 GET 强制 DB 配置，每次页面 mount 都会因为 useEffect 拉 snapshots 失败弹错误—— UX 很糟。

**关键面试点**：错误语义不是 binary，要区分 query（容错） vs command（严格）。

---

## Q5：apps/web/lib/docStore.ts 缩成 28 行的"类型存根"，为什么不直接删？

**答：components 需要 `DocumentRecord` 类型，但不再需要任何运行时代码**

```ts
// 旧版（feat-100.2 之前，116 行）
export function createDocument(...) { ... }  // 文件读写
export function listDocuments() { ... }
export function getDocument(id) { ... }
export function getDocumentBuffer(doc) { ... }
export interface DocumentRecord { ... }

// 新版（feat-100.4，28 行）
export interface DocumentRecord { ... }    // 只剩类型
```

components（PlaygroundShell / DocumentUploadPanel / StageConfigPanel）都用了 `DocumentRecord` 来声明 props 和 state。直接删会三处编译错。

**为什么不挪到 shared-types**：
- shared-types 当前定位是"pipeline contract"（method enum、params schema、Input/Output）
- DocumentRecord 是 storage layer 的 ORM 形状，concept layer 不一样
- 等 Phase 4 多文档版本化时再统一规划

**当前妥协**：留个文件存类型，加注释说明"运行时已迁到 apps/api"。比硬塞到 shared-types 更轻、比删除导致编译错更稳。

---

## Q6：删 Next.js routes 是"破坏性变更"，回滚成本？

**答：git revert 单 commit 即可，但前端配置也要回退**

回滚步骤：
1. `git revert <wave-4-commit>` — 路由文件、lib/providers、lib/snapshotDb 全部恢复
2. 前端取消 `NEXT_PUBLIC_USE_NEST_API=true` —— fetch 自动回 `/api/...`
3. 重启 web dev server

**前提**：Wave 4 的所有变更尽量集中在一个 commit，便于 revert。这就是为什么我没有"先删 5 个、再删 5 个、再删 4 个"分批——分批后回滚成本变成 N×commits。

**单 commit 的代价**：diff 大、review 累。但 Wave 4 的本质就是机械迁移（每个 controller 类似），review 反而看模式而非细节。

**真正的不可逆**：DB schema 没变（snapshotDb 的 DDL 在 NestJS 也是相同 SQL）。回滚后 Next.js routes 能继续读写同一份数据，无损。

---

## Q7：rag-core 现在还是直引 `src/index.ts`，部署到生产怎么打包？

**答：留给运维 / 后续 feature 的开放问题，本 PR 不解**

NestJS prod 部署最朴素的两条路：

| 方案 | 改动 |
|---|---|
| rag-core 加 build 脚本 | `tsc -p tsconfig.build.json` 编译到 `dist/`；package.json `main` 切到 `./dist/index.js`，types 仍指源码 |
| apps/api 用 webpack bundle | `nest build --webpack` 把所有依赖打成单 main.js；rag-core 源码被吞进去 |

第一种胜在"sourcemap 友好 + 多 consumer 共享同份 dist"；第二种胜在"单文件部署、零运行时 node_modules 拷贝"。

**为什么 Wave 4 不做**：
- dev 阶段 ts-node + Next.js transpilePackages 已能跑通，没有 unblock 紧急性
- 部署架构（Fly.io / Vercel / Docker compose）尚未敲定，方案要随它走
- 加 build 步骤会拖慢 CI，得先决定 CI pipeline 长什么样

**这就是工程权衡**：能放到后面的事，先放到后面；当下的最小可证明路径优先。

---

## Q8：前端的 `lib/api-base.ts` 从"白名单"变成"全部走 NestJS"，对用户隐式影响？

**答：默认行为变了——必须显式开 flag**

```ts
// Wave 3
if (USE_NEST && NEST_MIGRATED_PIPELINE.has(stageId)) → NestJS
else → /api/...

// Wave 4
if (USE_NEST) → NestJS
else → /api/...   // 但 /api/* 路由已删！
```

**结果**：不设 `NEXT_PUBLIC_USE_NEST_API=true` 时，前端 fetch 全部走 `/api/...`，但 Next.js 上没有这些路由 → 全部 404。

**这不是 bug 是设计**：
- dev 期文档里写明"必须开 flag"
- prod 期部署脚本一定会设 env，不会忘
- 没设 flag 直接 404 而非"看起来正常但数据全没"是好事——快速失败

**alternative**：默认 `USE_NEST=true`。但这会让 Wave 3 的环境一升级就 break（旧 flag false 的部署突然全 404）。保持"显式即正确"更稳。

**关键面试点**：default 行为的迁移要算 fallout——倒向"已迁完"还是"未迁完"取决于哪边的用户多。Wave 4 选择保持 false 默认（与 Wave 3 一致），让运维有意识地切。

---

## Q9：Wave 3 + Wave 4 加起来的代码净增是多少？

**答**：

- 增：apps/api 完整 NestJS 后端（约 20 个文件，~1500 行）
- 减：apps/web/app/api/* 全部（19 个 route 文件 + 2 个 lib 文件，~2300 行）
- 减：docStore.ts 116 → 28 行（-88）
- 净：**-900 行**（业务功能零变化）

加上 feat-100.2 把算法抽到 rag-core 净减的 ~5000 行，整个 feat-100 epic 净减约 **6000 行**。

代码量减少不是目标，是**架构清晰度的副作用**——同样功能用更少的中间层完成。

---

## Q10：30 秒电梯演讲版

> "Wave 4 完成 RAG 平台架构重构最后一步：剩余 14 个 RAG stage、snapshots、pipeline-runs 全部从 Next.js routes 迁到 NestJS controller，apps/web/app/api 整个目录连同 providers.ts / snapshotDb.ts 全部删除。前端 api-base.ts 取消白名单，所有 fetch 走 NestJS。
>
> NestJS 当前 25 个路径：18 个 stage 端点（每个对应一个 controller）+ documents x3 + snapshots x2 + pipeline-runs x2 + health。架构清晰：Controller 解析请求 → ProvidersService 提供 client → 调 rag-core 算法 → PipelineExceptionFilter 翻译错误。
>
> 关键设计：DocumentsModule 和 PipelineModule 互相 export Service 共享 DI；SnapshotsModule 复用 PipelineModule 的 ProvidersService 创建 pg 连接；docStore.ts 缩成 28 行类型存根供 components 用，运行时代码迁到 NestJS。
>
> 跨进程数据共享靠共用 `apps/web/data/documents.json`（NestJS 端通过 `process.cwd()..../apps/web/data/` 路径自动定位），dev 期两个进程读写同一份数据零分裂。
>
> 收益：apps/web 退回到"纯前端 + Playground UI"角色；algorithm / transport / I/O 三层完全分离；切换 NestJS → Fastify / Cloudflare Workers / CLI 都只动 Controller 层。
>
> 模式：**Strangler Fig 完结** + **Tolerant Reader（GET 容错 / POST 严格）** + **Module DI Boundary** + **Type Stub（保留类型删除实现）** + **单 commit 可回滚**。"

---

## 设计模式 → 代码对照

| 模式 | 项目里在哪 |
|------|-----------|
| Strangler Fig（完结） | Wave 3 5 端点共存 → Wave 4 一次性收割剩余 14+5 端点 |
| Module DI Boundary | `PipelineModule.exports` + `SnapshotsModule.imports` |
| Service per Concern | ProvidersService（I/O）/ DocStoreService（doc）/ SnapshotsService（snapshot DDL+CRUD） |
| Tolerant Reader | GET /snapshots 无 DB 返回 []，POST 严格抛 |
| Type Stub | docStore.ts 缩到只剩 DocumentRecord 接口 |
| Default-deny Migration | api-base.ts 默认走 /api/...，要显式 flag 才走 NestJS |
| Single-Commit Reversibility | Wave 4 全部变更在一个 commit，便于 git revert |
| Cross-Process Shared File | apps/api 通过相对路径读 apps/web/data/documents.json |
