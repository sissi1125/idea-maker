# 面试题 — feat-100.3 Wave 3：NestJS 后端 + 双跑期迁移

Wave 2（feat-100.2）把 18 个 stage 抽到纯库 `@harness/rag-core`，Wave 3 把"路由层"也独立成 NestJS 服务。这次面试题聚焦：**渐进式迁移**、**框架适配**、**部署/运行时陷阱**。

相关代码：
- `apps/api/src/main.ts` / `common/pipeline-exception.filter.ts`
- `apps/api/src/pipeline/{providers.service,*.controller}.ts`
- `apps/api/src/documents/{doc-store.service,documents.controller}.ts`
- `apps/web/lib/api-base.ts`

---

## Q1：为什么不一步到位把所有端点都迁到 NestJS？

**答：Strangler Fig Pattern（绞杀者模式）+ 风险窗口最小化**

Wave 3 只迁 5 个最关键的（chunk / embedding / retrieval / generation / documents），保留 14 个 Next.js route 作为 fallback。原因：

1. **可回滚**：任何端点回归都能用 `NEXT_PUBLIC_USE_NEST_API=false` 一键退回 Next.js routes，零部署
2. **可观测**：5 端点先跑一段时间，观察 NestJS 进程稳定性、内存、错误率，再上剩余端点
3. **可校验**：5 端点是 RAG 链路的"骨干"（上传 → 切块 → 向量化 → 检索 → 生成）；先验证骨干在双 runtime 下行为完全一致，剩余的 Wave 4 就是机械迁移
4. **依赖小**：5 端点共用 4 类 client 注入（pg / openai / llm / tei），Wave 3 把 ProvidersService 跑通，Wave 4 直接复用

**反例**：一次性迁 18 个 → 出问题不知道是哪个 stage 的迁移引入的，回滚意味着 18 个端点同时退回，影响面太大。

---

## Q2：前端用什么策略切换 Next.js vs NestJS？

**答：URL 工厂函数 + 前端 env flag**

```ts
// apps/web/lib/api-base.ts
const USE_NEST = process.env.NEXT_PUBLIC_USE_NEST_API === "true";
const NEST_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const NEST_MIGRATED = new Set(["chunk","embedding","retrieval","generation"]);

export function pipelineUrl(stageId: string): string {
  return USE_NEST && NEST_MIGRATED.has(stageId)
    ? `${NEST_BASE}/pipeline/${stageId}`
    : `/api/pipeline/${stageId}`;
}
```

**两个关键设计**：

1. **白名单而非全量切换**：白名单里的 stage 才走 NestJS，没在白名单的（如 snapshots / pipeline-runs / 其他 14 stage）继续走 Next.js。这样 Wave 3 期间用户开关 flag 不会让未迁移的端点失效
2. **默认 false**：env 不设或非 `"true"` 就走 Next.js，零行为风险

**反例方案对比**：

| 方案 | 缺点 |
|---|---|
| Next.js route 内部 proxy 到 NestJS | 多一跳网络；route 本身要保留代码；NestJS 挂了 Next.js 也跟着挂 |
| 全局 base URL 替换（不区分白名单） | 未迁端点 404 |
| 编译期 dead code elimination（webpack define） | 不能运行时切换，每次切要 rebuild |

---

## Q3：NestJS Controller 为什么要包一层 Service？路由直接 `runChunk()` 不行吗？

**答：DI 边界 + 可测试性 + 可观测性挂载点**

```ts
@Controller("pipeline/chunk")
export class ChunkController {
  @Post()
  async run(@Body() body) {
    // 路由薄壳：解析 + 校验 + 调 rag-core
    return runChunk({...});
  }
}
```

ChunkController 是无依赖的 — 这是对的，chunk 是**纯算法**。但其他 4 个 Controller 都注入了 `ProvidersService`：

```ts
@Controller("pipeline/embedding")
export class EmbeddingController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  async run(@Body() body) {
    const { client } = this.providers.createEmbeddingClient(...);
    return runEmbedding({...openaiClient: client});
  }
}
```

**为什么包一层 ProvidersService 而不是 Controller 自己 `new OpenAI(...)`**：

1. **集中环境变量读取**：env 优先级（表单 → EMBEDDING_API_KEY → LLM_API_KEY → OPENAI_API_KEY）有 4 层。如果每个 Controller 自己读，4 个 Controller 4 份重复
2. **可替换**：以后想加连接池 / 单例缓存 / 切多租户 BYOK，全在 ProvidersService 一处改
3. **可挂载拦截器**：NestJS Interceptor 可以在 Service 调用前后注入 logging / cache / 限流
4. **可单测**：测 Controller 时 mock ProvidersService 一行；不 mock 就要 mock `process.env` + `import("openai")` + ...

**为什么 ChunkController 不需要 Service**：chunk 是 0 I/O 纯算法，没注入需求。原则：**有 I/O 才有 Service**。

---

## Q4：tsx 跑 NestJS 时所有 DI 都是 undefined，怎么排查？

**答：esbuild 不实现 `emitDecoratorMetadata` — 经典坑**

**症状**：
- 编译通过、tsc typecheck 通过
- `nest start` 启动日志看着正常，路由全部 Mapped
- 调任意 Controller 报 `Cannot read properties of undefined (reading 'list')`
- `this.someInjectedService` 全是 undefined

**根因**：

NestJS DI 靠 TypeScript 编译时生成的元数据：

```ts
class Foo {
  // tsc 编译后会调用 Reflect.metadata("design:paramtypes", [Bar])
  constructor(private bar: Bar) {}
}
```

这是 `emitDecoratorMetadata: true` 的产物，**只有 tsc 和 SWC 支持**（SWC 需 `legacyDecorator + decoratorMetadata` 双开）。

tsx 底层是 **esbuild**，esbuild 明确不打算实现 emitDecoratorMetadata（issue #257）。结果：构造函数参数类型在运行时是 `undefined`，Nest 不知道注入啥，给你的字段就是 undefined。

**排查信号**：
- `console.log(this.foo)` → undefined
- 即便 import 路径、@Injectable、Module providers 全对
- 改用 `@Inject(Foo) private foo: Foo` 临时绕过——这是确认 metadata 问题的快速方法

**解决方案对比**：

| 方案 | 优点 | 缺点 |
|---|---|---|
| `ts-node-dev --transpile-only --respawn` | 完整 emitDecoratorMetadata；NestJS 官方默认 | 启动比 tsx 慢 1-2 倍 |
| `@swc-node/register` + SWC config | 接近原生 esbuild 速度 | 配置项多；swc 版本兼容性偶发问题 |
| `tsx` + 手写 `@Inject(Type)` | 速度最快 | 每个 Service 都要手写；违反 DI 习惯；新人易踩 |
| `nest start` (内置 tsc) | 零配置 | 慢；不能跨 workspace 拉源码 |

本项目选 **ts-node-dev**，理由：dev 启动一次性、速度可接受、零额外配置、和 NestJS 官方约定一致。

---

## Q5：apps/api 引用 `@harness/rag-core` 是 workspace 包，main 指向 `src/index.ts` 而不是 dist。runtime 怎么处理？

**答：dev 用 ts-node 编译时翻译；prod 必须真编译产物**

**dev 路径**：

`ts-node-dev` 注册一个 require hook，所有 `.ts` 文件（包括 node_modules/@harness/rag-core/src/**.ts）在 import 时被即时编译。

这与 Next.js 的 `transpilePackages: ["@harness/rag-core"]` 是同一种机制 — 都把 workspace 源码当本地代码看待。

**prod 路径**（Wave 4 才处理）：

`nest build` 只编 `apps/api/src`，rag-core 的 `.ts` 不会被打包。所以 prod 需要其中之一：

1. rag-core 增加 `build` 脚本编译到 `dist/`，package.json `main` 切到 `./dist/index.js`，types 仍指源码方便 IDE
2. apps/api 用 webpack/esbuild bundle 全部源码到单文件（Nest CLI 自带 `--webpack`）
3. Cloudflare Workers / Vercel：把整个 monorepo 当源码部署，靠平台编译

本项目计划：feat-100.4 时给 rag-core 加 dist 产物，部署架构用方案 1（最朴素、对 sourcemap 友好）。

---

## Q6：错误处理在 Next.js routes 里是每个 route 自己写 try/catch + status map；NestJS 里怎么做？

**答：全局 ExceptionFilter + 统一翻译表**

```ts
// apps/api/src/common/pipeline-exception.filter.ts
@Catch()
export class PipelineExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof ZodError) return res.status(400).json({ error: { code: "invalid_params", ...} });
    if (isPipelineError(err))    return res.status(STATUS[err.code] ?? 500).json({ error: ... });
    if (err instanceof HttpException) return res.status(err.getStatus()).json({...});
    return res.status(500).json({ error: { code: "internal_error", ... } });
  }
}

// main.ts
app.useGlobalFilters(new PipelineExceptionFilter());
```

**收益**：

| 维度 | Next.js routes（feat-100.2 状态） | NestJS（feat-100.3） |
|---|---|---|
| status code 表 | 18 个 route 各自维护一份 PIPELINE_ERROR_STATUS | 全局一份 |
| try/catch | 每个 route 写 | Controller 不用写，filter 兜底 |
| ZodError 翻译 | 每个 route 自己处理 invalid_params | filter 统一 400 |
| 跨 Controller 一致性 | 容易漂移（漏改某个 route） | 强制一致 |

**关键点**：filter 沿用 feat-100.2 定义的 `PipelineError(code, message, details?)` —— rag-core 本身没变，所有迁移收益直接落地。

**特殊情形**：DELETE /documents/:id 缺资源时用 `NotFoundException`（Nest 内置）抛，而不是 PipelineError，因为这是 transport 层的 404 概念，业务层 PipelineError 不应该携带"not found"语义。

---

## Q7：双跑期数据存储怎么不分裂？

**答：共享文件 + env 路径注入**

```ts
@Injectable()
export class DocStoreService {
  private readonly dataFile: string;
  constructor() {
    const fromEnv = process.env.DOCUMENTS_DATA_FILE;
    if (fromEnv) {
      this.dataFile = path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
    } else {
      // apps/api 启动时 cwd = apps/api，向上两层到 repo 根再到 apps/web/data
      this.dataFile = path.resolve(process.cwd(), "..", "..", "apps/web/data/documents.json");
    }
  }
  // ...
}
```

**为什么这样**：

dev 时 apps/web 和 apps/api 是两个进程，但都读写同一份 `apps/web/data/documents.json`。用户在 Next.js 上传的文档，切到 NestJS 也能立即看见；反之亦然。**数据没有"哪个后端独占"的问题。**

部署时（Wave 4 处理）：把数据文件路径从 apps/web 里搬出来到中立目录，DOCUMENTS_DATA_FILE 指过去。

**为什么不直接抽 `packages/document-store`**：
- Wave 3 还有 Next.js 在用 docStore；如果抽包，apps/web 也要跟着改 import 路径
- Wave 4 计划删 apps/web docStore 后再做这个抽包；现在保持两份代码（apps/web 的原版 + apps/api 的 NestJS 版本）更稳

**Tradeoff**：暂时有重复代码，换来 Wave 3 的稳定性。

---

## Q8：Swagger UI 为什么不写 DTO + 装饰器，输出却比较"裸"？

**答：刻意延后到 Wave 4**

Wave 3 的 Controller 接口都是 `Record<string, unknown>` + zod 解析，没用 NestJS 推荐的 `class-validator` DTO：

```ts
@Post()
async run(@Body() body: ChunkRequestBody) {
  const params = ChunkParamsSchema.parse(body.params); // zod
  // ...
}
```

**理由**：

1. **shared-types 的 zod schema 是 single source of truth**：feat-100.2 已经定了 18 个 stage 的 ParamsSchema 都在 shared-types/pipeline/*.ts。如果在 apps/api 再写一份 class-validator DTO，等于两套契约
2. **migration 风险最小**：Controller 接口和 Next.js route 接口逐字节相同，前端不用改 body 结构
3. **Wave 4 再考虑**：要么用 `nestjs-zod` 把 zod schema 自动适配成 Swagger schema，要么继续保持现状（Swagger 只展示路径/method，不展示 body schema）

**反例**：现在就上 class-validator → schema 漂移、双重维护、迁移期间随时可能不一致。

---

## Q9：CORS / ValidationPipe / Swagger 都在 `main.ts` 配，会不会太集中？

**答：Bootstrap 集中是 Nest 推荐做法，但要警惕一个反模式**

`main.ts` 的职责：
- 应用级横切配置（CORS / 全局 pipe / 全局 filter / Swagger 注册）
- 启动监听

**警惕**：不要在 `main.ts` 写业务逻辑（如初始化 DB schema、跑 migration）— 那是 `AppModule.onModuleInit` 的事，否则 e2e 测试 + 不同环境的初始化逻辑会冲突。

本项目 `main.ts` 38 行，全是配置和启动，零业务，符合规范。

---

## Q10：30 秒电梯演讲版

> "Wave 3 把 RAG 算法从 Next.js routes 之外又抽出一层：**NestJS 独立后端服务**。
>
> 5 个最关键端点（chunk / embedding / retrieval / generation / documents）在 `apps/api` 用 NestJS Controller + ProvidersService 重新实现；剩余 14 个继续走 Next.js routes。
>
> 前端 `apps/web/lib/api-base.ts` 提供 `pipelineUrl()` / `documentsUrl()` 工厂，根据 `NEXT_PUBLIC_USE_NEST_API` flag 决定 fetch 哪个后端。默认走 Next.js，零风险；想试 NestJS 路径就开 flag。
>
> 双跑期数据存储不分裂——两个后端读写同一份 `apps/web/data/documents.json`，DOCUMENTS_DATA_FILE 可注入路径。
>
> 关键收益：rag-core 算法零改动；错误处理从 18 份 PIPELINE_ERROR_STATUS 收敛到一个 `PipelineExceptionFilter`；Swagger UI 上线 `/docs` 提供端点目录。
>
> 关键坑：tsx 不支持 `emitDecoratorMetadata`，NestJS DI 全失效——换 ts-node-dev 解决。
>
> 模式：**Strangler Fig** + **Feature Flag 切换** + **Global ExceptionFilter** + **Dependency Injection** + **Configuration over Code**。"

---

## 设计模式 → 代码对照

| 模式 | 项目里在哪 |
|------|-----------|
| Strangler Fig（绞杀者） | Wave 3 5 端点迁 NestJS + 14 端点留 Next.js fallback |
| Feature Flag | `NEXT_PUBLIC_USE_NEST_API` + `NEST_MIGRATED_PIPELINE` 白名单 |
| Factory（URL 工厂） | `pipelineUrl()` / `documentsUrl()` |
| Global Exception Filter | `PipelineExceptionFilter` 翻译 PipelineError / ZodError / HttpException |
| Dependency Injection | `ProvidersService` / `DocStoreService` 被 Controller 注入 |
| Single Source of Truth | shared-types 的 zod schema 同时给 Next.js 和 NestJS 用 |
| Configuration over Code | env 决定 CORS origin / API_PORT / DOCUMENTS_DATA_FILE |
| Cross-Process Shared Storage | 两个后端共用 documents.json |
| Bootstrap Centralization | `main.ts` 集中所有 app-level 配置 |
