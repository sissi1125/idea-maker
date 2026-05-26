# 面试题 — feat-100.2 设计模式总览

将 Next.js 单体的 18 个 RAG pipeline route 抽取到 `packages/rag-core` 纯库的过程，是一个把多种经典设计模式实战落地的样本。本文按"问什么 / 怎么答 / 项目里的具体例子"组织。

相关代码：
- `packages/rag-core/src/{ingestion,retrieval,generation}/*.ts`
- `packages/shared-types/src/pipeline/*.ts`
- `apps/web/app/api/pipeline/*/route.ts`

---

## Q1：这次重构最核心的架构思路是什么？

**答：Functional Core, Imperative Shell**（Gary Bernhardt 提出，业界常见名字）

**两层划分**：

```
┌──────────────────────────────────────┐
│  Imperative Shell                    │
│  apps/web/.../route.ts (薄路由)      │ ← HTTP / env / pg lifecycle / 错误翻译
│  - new Client + connect              │
│  - createLLMClient(...)              │
│  - 读 process.env.HF_TEI_ENDPOINT    │
│  - try / finally end()               │
└────────────────┬─────────────────────┘
                 ↓ 注入 client / endpoint
┌──────────────────────────────────────┐
│  Functional Core                     │
│  packages/rag-core/* (纯算法)        │ ← 输入 → 输出
│  - 无 process.env 读取               │
│  - 无 new Client                     │
│  - 错误抛 PipelineError              │
│  - 确定性（mock 注入即可单测）       │
└──────────────────────────────────────┘
```

**为什么有用**：
1. **单测轻量**：238 个单测全是 mock，0 个起 Postgres / 0 个调 OpenAI / 0 个起 Next.js dev server。`pnpm test` 1.2s 跑完
2. **迁移友好**：Wave 3 把路由层换成 NestJS Controller，rag-core 零改动
3. **可测试性 = 可信度**：算法 bug 在单测层就能抓到，不需要起整条 pipeline 才发现

**反例**（重构前）：

```ts
// route.ts 535 行混在一起
export async function POST(req) {
  const body = await req.json();              // HTTP
  const apiKey = process.env.OPENAI_API_KEY;  // env
  const client = new OpenAI({ apiKey });      // I/O
  const db = new Client(...);                 // I/O
  await db.connect();
  // ...算法 400+ 行...
  return NextResponse.json(...);              // HTTP
}
```

测试这个函数？要 mock NextRequest、要 mock OpenAI、要起 Postgres test container、要 patch process.env...

---

## Q2：rag-core 怎么和 OpenAI / pg 通信但又不依赖它们的包？

**答：Hexagonal Architecture（Ports & Adapters）+ TypeScript Structural Typing**

**Port（端口）= 最小结构契约**：

```ts
// packages/shared-types/src/pipeline/embedding.ts
export interface OpenAICompatibleClient {
  embeddings: {
    create(req: { model: string; input: string | string[]; dimensions?: number }): Promise<{
      data: Array<{ embedding: number[]; index: number }>;
    }>;
  };
}
```

**Adapter（适配器）= 真实实现**：

```ts
// apps/web/lib/providers.ts
const { default: OpenAI } = await import("openai");
const client = new OpenAI({ apiKey });  // 真实 OpenAI 实例

// 传给 rag-core 时不需要任何 cast
await runEmbedding({ ...input, openaiClient: client });
```

**关键技术：TypeScript Structural Typing**

不像 Java 必须 `implements`，TS 是 duck typing 友好的——只要对象结构匹配接口，就算"实现了"。真实 `OpenAI` 类有 `embeddings.create`，自然满足 `OpenAICompatibleClient`，不需要任何继承声明。

**收益**：
- `shared-types` 包零外部依赖（不引入 `openai` 包 4MB+ 类型）
- 任意 OpenAI-compatible 服务（Qwen、DeepSeek、Moonshot）都自动满足契约
- 单测时 `vi.fn()` 一行造 mock client：`{ embeddings: { create: vi.fn() } }`

**反例**：
如果用 nominal typing 强制 implements，shared-types 必须 `import OpenAI from "openai"`，所有 consume 该包的 app 都跟着背锅。

---

## Q3：18 个 stage 每个都有 2-5 个 method，怎么组织？

**答：Strategy Pattern + Facade**

**Strategy** = 同 stage 内不同方法是不同策略，共享 input/output 契约：

```ts
// rag-core/ingestion/chunk.ts
export function runChunk(input: ChunkInput): ChunkResult {
  switch (input.methodId) {
    case "fixed-size":                  return chunkFixedSize(...);
    case "recursive":                   return chunkRecursive(...);
    case "markdown-heading":            return chunkMarkdownHeading(...);
    case "markdown-heading-recursive":  return chunkMarkdownHeadingRecursive(...);
  }
}
```

每个 method 是独立策略，调用方按 methodId 选。

**Facade** = `runChunk()` 是统一外观，对外只暴露一个入口，内部 4 个 helper 函数不导出。调用方代码：

```ts
// 调用方 (路由层)
const result = await runChunk({
  methodId: "recursive",      // 切策略
  params: { chunkSize: 512 }, // 参数
  upstream: { cleanText }     // 输入
});
// ↑ 完全不知道内部有 4 个 helper 函数
```

**为什么不用 OOP 的 Strategy class**：
- TS 中函数 = 一等公民，function strategy 比 class 简洁
- 不需要每个 method 一个文件 / 一个类
- 全闭包在一个 module 内，调试 / refactor 更容易

---

## Q4：rerank stage 同时需要 TEI endpoint 和 OpenAI client。这种"多 provider"怎么注入？

**答：Multi-port Dependency Injection（多端口注入）**

```ts
interface RerankInput {
  methodId: RerankMethodId;
  params: RerankParams;
  upstreamMatches: FilteredChunk[];
  upstreamQuery?: string;
  hfTeiEndpoint?: string;    // ← 端口 1
  llmClient?: LLMChatClient; // ← 端口 2
}
```

**关键设计**：
- 每个 client 都是 `optional`（不同 method 用不同子集）
- runtime 在每个 method 入口校验所需端口齐全，缺则抛 `PipelineError("missing_endpoint")` / `PipelineError("missing_client")`
- 不用 discriminated union（虽然类型层更安全，但路由层组装会爆炸）

**retrieval（pipeline 之王）三重注入**：

```ts
interface RetrievalInput {
  pgClient: PgClient;                          // 必传，所有 method
  openaiClient?: OpenAICompatibleClient;       // provider=openai 时必传
  hfTeiEndpoint?: string;                       // provider=hf-tei 时必传
  // debug-deterministic provider 时三个都可缺
}
```

路由层按 `embeddingProvider` 字段决定要创建哪些 client，rag-core 内运行时再校验。

---

## Q5：错误处理是怎么做的？为什么不直接 throw `new Error()`？

**答：Domain Error Object + Error Translation（两层错误模型）**

**Domain Layer**（rag-core）：

```ts
export class PipelineError extends Error {
  constructor(
    public readonly code: string,           // 业务语义
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// 用法
throw new PipelineError("dimension_mismatch", "维度不匹配", { existing: 1536, incoming: 4 });
```

**Transport Layer**（apps/web）：

```ts
const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_chunks: 400,
  missing_client: 500,
  dimension_mismatch: 409,
  provider_error: 502,
  rate_limited: 429,
};

if (isPipelineError(err)) {
  return NextResponse.json(
    { error: { code: err.code, message: err.message, ...(err.details ?? {}) } },
    { status: PIPELINE_ERROR_STATUS[err.code] ?? 500 },
  );
}
```

**为什么这么设计**：
1. **关注点分离**：rag-core 不知道 HTTP，路由层不知道算法细节
2. **可移植**：NestJS / CLI 用同一份 PipelineError，各自决定 HTTP 状态码或终端退出码
3. **可观测**：`details` 字段携带结构化诊断信息，便于客户端编程处理（如显示"你的向量是 1536 维，存储里是 4 维"）

---

## Q6：fallback 缺 LLM client 时不抛错而是降级，为什么？

**答：Graceful Degradation Pattern，但是 stage-specific**

**两种"missing 注入"语义**：

| 类型 | 例子 | 行为 |
|------|-----|------|
| 致命缺失 | embedding / storage / retrieval 缺 client | 抛 `PipelineError("missing_client")` |
| 优雅降级 | fallback / evaluation 缺 LLM client | 用算法兜底 + warning |

**判定原则**：stage 的本质用途。

- **fallback** 本身就是"质量低时的备用路径"，再降级到"无 LLM 的拒答"完全符合语义
- **evaluation** 的 LLM Faithfulness 是可选指标，缺了 LLM 还能算 hitRate / citationCoverage 三个算法指标

```ts
// rag-core/retrieval/fallback.ts
if (!client) {
  // 不抛错，降级
  return {
    triggered: true,
    fallbackResponse: "抱歉，我目前没有足够的信息来回答这个问题...",
    warnings: [`Fallback 触发（无 LLM 配置，退化为拒答）：${reason}`],
  };
}
```

**反模式**：所有 stage 都强制注入 → 一个 env 配错整条 pipeline 跪。

**关键面试点**：错误处理策略 ≠ 统一规则，要看业务上下文。这里写了**注释**明确说明为什么 fallback 不同于其他 stage——文档代码本身就是设计决策的载体。

---

## Q7：rerank 的 `llm-relevance-rerank` 用 `Promise.all` 并发评分，单个 chunk LLM 调用失败怎么办？

**答：Per-Chunk Failure Collection（局部失败收集）**

**幼稚做法**：

```ts
const scored = await Promise.all(matches.map(m => llm.evaluate(m)));
//                    ↑ 一个失败整个 reject，前面已花的 N-1 次 API 调用浪费
```

**项目做法**：

```ts
const llmFailures: string[] = [];
const scored = await Promise.all(
  matches.map(async (m, idx) => {
    try {
      const resp = await client.chat.completions.create(...);
      return { ...m, rerankScore: parsed.score / 10 };
    } catch (err) {
      // 单 chunk 失败：降级为原始分数 + 记录 warning
      llmFailures.push(`chunk[${idx}] 失败: ${err.message}`);
      return { ...m, rerankScore: m.score };  // 用 filter 分数兜底
    }
  }),
);
return { ..., warnings: [`消耗 ${matches.length} 次 API`, ...llmFailures] };
```

**收益**：
- N 个 chunk 中 1 个失败，其余 N-1 个仍正常评分
- warnings 里详细记录哪些 chunk 失败，可观测性强
- 用 filter 阶段的 score 兜底，仍可排序，pipeline 不中断

**反例**：直接 `Promise.allSettled` 然后过滤错误——丢失了详细错误原因，调试困难。

---

## Q8：每个 stage 返回 `{ output, trace, warnings }` 而不是单返回 output，为什么？

**答：Rich Result Object Pattern（结果对象增强）**

```ts
interface StageResult {
  output: StageOutput;          // 业务结果，下游 stage 用
  trace: StageTrace;            // 可观测性数据：耗时、计数、参数
  warnings: string[];           // 非致命问题，UI 展示用
}
```

**三块各司其职**：

| 字段 | 谁消费 | 例子 |
|---|---|---|
| `output` | 下游 stage（程序） | `output.matches` 传给 filter |
| `trace` | Playground UI / OpenTelemetry | `trace.durationMs` 显示在面板 |
| `warnings` | 用户阅读 | "维度截断" / "未引用任何 evidence" |

**为什么不用 console.warn / 单独的 logger**：
- `warnings` 是**返回值的一部分**，函数纯度保留（同输入 → 同 warnings）
- 网络层（HTTP）直接 serialize 一次返回，前端可解析展示
- 单测可断言 warning 内容：`expect(r.warnings).toContain("dimension_mismatch")`

**反例**：把 trace 数据写到 `console.log`、把 warnings 直接 `throw new Warning()` —— 都破坏函数纯度，不可观测。

---

## Q9：`evidencePack` 在 citation 产生，要传到 evaluation。怎么穿过中间的 prompt-build / generation 不丢失？

**答：Passthrough Pattern（数据透传）**

```
citation (产生 evidencePack)
   ↓ Output 含 evidencePack
prompt-build (拼 prompt，但 evidencePack 原样透传)
   ↓ Output 含 evidencePack
generation (调 LLM，但 evidencePack 原样透传)
   ↓ Output 含 evidencePack
evaluation (用 evidencePack 计算 citationCoverage)
```

**实现**：

```ts
// rag-core/generation/prompt-build.ts
return {
  systemPrompt, userPrompt, ...,
  evidencePack: upstream.evidencePack,  // 透传，不改
};

// rag-core/generation/generation.ts
return {
  generatedContent, citedEvidenceIds, ...,
  evidencePack: upstream.evidencePack,  // 又透传
};
```

**为什么这样而不是让 evaluation 自己再去查 citation**：
1. **避免重复查询**：DB 重新拉 evidence 浪费
2. **不可重现**：citation 可能用 cache 拿了某版 evidence，再查可能拿到新版
3. **数据流明确**：在类型层就能看出 evaluation 依赖 evidence

**对比 React Context / Redux**：
- React Context = 隐式 prop drilling，跳过中间组件
- 这里的 passthrough = **显式**经过中间 stage（每个 Output 类型都声明 `evidencePack?`）

后者在 pipeline 场景更合适：每个 stage 的契约清晰，没有"魔法注入"。

---

## Q10：`chunk` stage 定义了 `Chunk`，`transform` 用 `type TransformInputChunk = Chunk`，`retrieval` 又定义 `MatchedChunk`，`rerank` 用 `RankedChunk extends FilteredChunk`。这种类型继承链有什么模式？

**答：Canonical Type Definition + Type Composition（规范类型 + 渐进组合）**

**类型演化链**：

```ts
// chunk.ts
interface Chunk { index, text, charStart, charEnd, tokenEstimate, sourceRef }

// transform.ts
type TransformInputChunk = Chunk;  // 完全复用
interface TransformedChunk extends Chunk {
  enhancedText: string;     // ← transform 加字段
  keywords: string[];
}

// retrieval.ts
interface MatchedChunk {   // 检索返回的形状
  chunkId, documentId, version, text, sourceRef, keywords, score, retrievalMethod
}

// filter.ts
interface FilteredChunk extends MatchedChunk {
  filteredRank: number;     // ← filter 加 rank
}

// rerank.ts
interface RankedChunk extends FilteredChunk {
  rerankScore: number;      // ← rerank 加重排分
  originalRank: number;
  newRank: number;
}
```

**模式名**：**Canonical Type + Progressive Enhancement**

- 上游 stage 定义最小核心类型（canonical）
- 下游 stage 通过 `extends` 加字段，原始字段不变
- 类型链与 pipeline 数据流一致

**收益**：
1. **类型即文档**：看 `RankedChunk extends FilteredChunk extends MatchedChunk` 就知道这条 chunk 经过了哪些 stage 的处理
2. **零运行时开销**：TS extends 编译后是结构化检查，无 vtable
3. **可替换**：删 rerank stage 不影响 FilteredChunk 流向下游 citation

**反例（DDD 战术错误）**：每个 stage 定义独立的 `XxxChunk`，互相不继承，靠手动字段映射——会出现"字段同名但类型微妙不同"的漂移。

---

## Q11：怎么保证 18 个 stage 的代码风格一致？

**答：Template Method（书面）+ 第一个实例作样板（实际）**

**Template** 写在 `packages/rag-core/README.md`（feat-100.2 第一个 commit 就建好）：

```
1. shared-types/<stage>.ts 定义 MethodId enum + zod ParamsSchema + Input/Output/Trace
2. rag-core/<category>/<stage>.ts 导出 run<Stage>(input) 纯函数
3. apps/web/.../route.ts 改薄路由（参数解析 → I/O 注入 → 调 rag-core → 错误翻译）
4. 单测覆盖每 method 主路径 + 错误路径 + trace 字段
```

**第一个实例**（idempotency）= 真实的代码样板，后续 17 个 stage 直接复制后调整。

**为什么这比"先写抽象框架"好**：
- 一开始不知道所有 stage 的共性，强行抽象框架会过度设计
- idempotency 是最简的（173 行）作样板风险低
- 一边复制一边发现 idiom（如 upstreamQuery 字段、双 provider 注入）逐步迭代
- 第 10 个 stage 时模板已经"自然形成"，不需要额外抽象

**反例**：先设计 abstract class `PipelineStage` 然后让 18 个 stage 都 extends——会发现每个 stage 注入需求差异太大（pg / openai / tei / 无），抽象类反而绑住手脚。

---

## Q12：如果让你把整个重构压缩成 30 秒电梯演讲，怎么说？

**答**：

> "把 6500 行混着 HTTP、env、算法的 Next.js route，拆成两层：**纯函数库 `@harness/rag-core`** 包含所有 RAG 算法，零 I/O；**薄路由 `apps/web`** 只做参数解析、客户端注入和错误翻译。
>
> 算法层和外部依赖通过 **shared-types 里的最小接口契约**（OpenAICompatibleClient / LLMChatClient / PgClient）解耦——TypeScript 结构化类型让真实 OpenAI / pg SDK 自动满足契约，shared-types 包零外部依赖。
>
> 18 个 stage 一致按 `runXxx(input) → { output, trace, warnings }` 范式，**Result Object** 同时返回业务结果、可观测性数据、非致命警告。
>
> 收益：238 个单测全 mock 1.2s 跑完；切换 NestJS / Cloudflare Workers / CLI 时算法零改动；换 LLM provider（OpenAI → Qwen → Anthropic）只改路由层 client 创建。
>
> 用到的模式：**Hexagonal Architecture（Ports & Adapters）+ Functional Core / Imperative Shell + Strategy + Template Method + Dependency Injection + Graceful Degradation + Result Object + Canonical Type Composition**。"

---

## 设计模式 → 项目代码对照速查表

| 模式 | 项目里在哪 |
|------|-----------|
| Functional Core, Imperative Shell | `packages/rag-core` vs `apps/web/.../route.ts` |
| Hexagonal Architecture / Ports & Adapters | `OpenAICompatibleClient` / `LLMChatClient` / `PgClient` 接口 |
| Structural Typing | shared-types 不 import OpenAI / pg 包 |
| Dependency Injection | `Input.openaiClient` / `Input.pgClient` 字段 |
| Inversion of Control | rag-core 被动接收 client（不主动创建） |
| Strategy Pattern | `runChunk` 的 4 method switch / `runRetrieval` 5 method |
| Facade | `runXxx(input)` 单入口 |
| Template Method | `packages/rag-core/README.md` 5 条规则 + idempotency 样板 |
| Pipeline / Pipes & Filters | 18 stage 串联，evidencePack 沿管道流动 |
| Result Object | `{ output, trace, warnings }` 三段返回 |
| Error Translation | PipelineError → HTTP status 映射表 |
| Graceful Degradation | fallback / evaluation 缺 client 时降级 |
| Per-Chunk Failure Collection | `rerank.llm-relevance-rerank` 单 chunk 失败不中断 |
| Passthrough Pattern | `evidencePack` 跨 4 个 stage 透传 |
| Canonical Type + Progressive Enhancement | `Chunk → FilteredChunk → RankedChunk` 类型链 |
| Strangler Fig（渐进重构） | route + rag-core 共存的过渡期 |
| Re-export Shim | `providers.ts` 改成 `export { embedBatch } from "@harness/rag-core"` |
| Single Source of Truth | zod schema + `z.infer<>` 一份定义 |
