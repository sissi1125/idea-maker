# 面试题 — Embedding Stage 抽取（feat-100.2 第 5 站，I/O 注入第一例）

相关文件：
- `packages/rag-core/src/ingestion/embedding.ts` — runEmbedding + 4 provider
- `packages/rag-core/src/util/openai-embed.ts` — embedBatch / embedSingleText 纯函数
- `packages/rag-core/src/ingestion/__tests__/embedding.test.ts` — 15 单测（含 mock client）
- `packages/shared-types/src/pipeline/embedding.ts` — Input/Output + `OpenAICompatibleClient` 结构契约
- `apps/web/lib/providers.ts` — createEmbeddingClient（读 env）
- `apps/web/app/api/pipeline/embedding/route.ts` — 薄路由，I/O 注入点

---

## Q1：embedding 是前 5 个 stage 里第一个有真正"外部 I/O"的。rag-core 不应读 env、不应创建 client，那 OpenAI / TEI / 模型从哪里来？

**答：**

通过 **Input 字段从路由层注入**：

```ts
// shared-types/pipeline/embedding.ts
interface EmbeddingInput {
  methodId: EmbeddingMethodId;
  params: EmbeddingParams;
  upstreamChunks: EmbeddingInputChunk[];
  openaiClient?: OpenAICompatibleClient;  // 路由层创建后传入
  hfTeiEndpoint?: string;                 // 路由层从 env 读取
}
```

```ts
// apps/web/.../embedding/route.ts
let openaiClient;
if (methodId === "openai-3-small") {
  const { client } = await createEmbeddingClient(params.apiKey, params.baseUrl);
  openaiClient = client;
}
const hfTeiEndpoint = process.env.HF_TEI_ENDPOINT;

await runEmbedding({ methodId, params, upstreamChunks, openaiClient, hfTeiEndpoint });
```

rag-core 收到 client/endpoint 后只管使用，不知道它怎么创建的。这是经典的**依赖注入（Dependency Injection）**模式：
- **测试时**：注入 mock client，断言 `mockEmbedCreate.toHaveBeenCalledOnce()`
- **生产时**：注入真实 OpenAI client
- **替换 provider 时**：路由层换 client 构造方式，rag-core 零改动

---

## Q2：`OpenAICompatibleClient` 接口里只声明了 `embeddings.create` 一个方法，不直接 import `OpenAI` 类型。为什么这么设计？

**答：**

**避免 shared-types 包污染**：

```ts
// shared-types/pipeline/embedding.ts
export interface OpenAICompatibleClient {
  embeddings: {
    create(req: { model; input; dimensions?: number }): Promise<{
      data: Array<{ embedding: number[]; index: number }>;
    }>;
  };
}
```

如果直接 `import type OpenAI from "openai"`：
- shared-types 多一个 `openai` 依赖（4MB+ 类型定义）
- 任何 consume shared-types 的 app/包都跟着背负这个依赖
- 单测 mock client 时要 cast 成完整 OpenAI 类，复杂

用**结构化最小接口**：
- shared-types 零外部依赖
- 真实 OpenAI client 结构兼容此接口（duck typing）
- 测试用 `vi.fn()` 就能造，无需 mock 整个 OpenAI SDK

代价：rag-core 内部要用 `client as any` 一次 cast（注释解释了为什么）。这是 monorepo schema 包"零依赖"模式的经典权衡。

---

## Q3：4 个 provider 里有 3 个需要不同的外部资源（OpenAI client / TEI URL / 本地模型）。如何让 rag-core 调用方明确知道每个 provider 需要什么？

**答：**

**run-time 校验 + 显式错误**：

```ts
case "openai-3-small": {
  if (!openaiClient) {
    throw new PipelineError(
      "missing_client",
      "openai-3-small 需要注入 OpenAI client；路由层应通过 createEmbeddingClient 创建后传入 Input.openaiClient",
    );
  }
  ...
}

case "hf-tei-embedding": {
  const endpoint = params.endpoint?.trim() || hfTeiEndpoint;
  if (!endpoint) {
    throw new PipelineError("missing_endpoint", ...);
  }
  ...
}
```

错误码语义化 + 消息含"应该怎么做"。路由层捕获到 `missing_client` 直接 → HTTP 400 + 友好错误。

**为什么不在 TypeScript 类型层强制**：
理论上可以用 discriminated union：

```ts
type EmbeddingInput =
  | { methodId: "openai-3-small"; openaiClient: OpenAI; ... }
  | { methodId: "hf-tei-embedding"; hfTeiEndpoint: string; ... }
  | { methodId: "debug-deterministic"; ... };
```

但代价：每个 provider 一种类型，路由层组装时分支爆炸。**实用主义选择**：optional 字段 + runtime 校验，错误信息明确。

---

## Q4：embedBatch 单测里 mock 的是 OpenAI 返回 `index=1 在前、index=0 在后`。为什么要测试这个？

**答：**

**OpenAI API 实测有过这个问题**：批量 embedding 时返回的 `data` 数组并不保证按输入顺序排列。同时 dispatch 多个 token，先回的先放数组。

```ts
// openai-embed.ts
export async function embedBatch(...) {
  const resp = await client.embeddings.create({ model, input: texts, ... });
  resp.data.sort((a, b) => a.index - b.index);  // 关键这一行
  return resp.data.map((d) => d.embedding);
}
```

如果没这行 sort，返回的 vectors[0] 可能对应 texts[1]，后续 chunk 的 embedding 与原文错位，索引完全乱掉。embedded chunk 存进数据库后，检索结果会找回错误的原文。**静默错误**，难调试。

测试 `vi.fn().mockResolvedValue({ data: [{ ...index:1 }, { ...index:0 }] })` 显式验证 sort 逻辑。这是个**学过的教训型测试**：测试用例不是"覆盖代码路径"而是"防止已踩过的坑回归"。

---

## Q5：providers.ts 现在变成了一个混合体——`createEmbeddingClient` 还在它里面（读 env），但 `embedBatch` 改成从 rag-core re-export 了。这种"半迁移"状态合理吗？

**答：**

合理但是过渡态，最终目标是清空。

**当前状态**：
```ts
// providers.ts
export async function createEmbeddingClient(apiKey?, baseUrl?) {
  // 读 process.env 创建 OpenAI client
}
export { embedBatch, embedSingleText } from "@harness/rag-core";  // re-export
```

**为什么 createEmbeddingClient 暂留 apps/web**：
- 它读 `process.env.LLM_API_KEY` / `OPENAI_API_KEY` 等环境变量
- env 是 deployment 层概念，符合"路由层职责"
- 多个 stage（embedding/retrieval/generation/rerank/...）都需要 client，集中创建避免重复

**为什么 embedBatch re-export**：
- retrieval/route.ts 还在用 `from "@/lib/providers"` 导入
- 现在改 retrieval 的 import 增加本 commit 范围
- re-export 是零代价兼容层，retrieval 抽取时一并清理

**最终态**（feat-100.2 完成后）：
- apps/web/lib/providers.ts 只保留 createXxxClient（读 env 的工厂）
- 或者完全删除 providers.ts，让 createXxxClient 也搬到 rag-core，env 通过参数注入

渐进重构原则：**不强求一步到位**。每个 stage 抽取时只清理它直接相关的代码，"傍系"代码（providers.ts 等）等被用到时再迁移。

---

## Q6：debug-deterministic provider 用 FNV-1a 哈希生成向量，号称"确定性"。这个向量到底有什么用？为什么不直接随机？

**答：**

**确定性**是它的核心价值：

```ts
function debugDeterministicEmbed(text, dimension) {
  // 同样输入 text + dimension → 完全相同向量
  // 跨进程、跨日期、跨机器都一样
}
```

**使用场景**：
1. **单测稳定性**：embedding 单测断言 `r1.embedding === r2.embedding`，确定性保证不 flaky
2. **eval-matrix 对比**：跑同一文档不同 chunk 策略，向量恒定可隔离变量
3. **集成测试**：模拟整条 pipeline 不需要真实 OpenAI 费用
4. **演示**：客户/雇主面前演示流程时不依赖外部服务

**随机 vector 的问题**：
- 每次运行结果不同，单测时好时坏
- 同一文本两次入库，向量不同，检索时即使原文相同也找不到（数据库唯一性失效）

**为什么不携带语义**：
- FNV-1a 是密码学外的快速哈希，分布近似均匀但与文本语义无关
- query 和 chunk 在同一文本上向量相同，但 "猫" 和 "宠物" 哈希完全无关——所以检索时只能命中字面相同的文本，不能做 RAG 该有的语义检索
- warning 显式提示"生产环境请换"

---

## Q7：15 个单测覆盖了 4 个 provider 但只有 debug-deterministic 跑了真正的算法，其他都是 mock。这够吗？

**答：**

够，因为**单元测试和集成测试分层**：

| 层级 | 测试什么 | 例子 |
|------|---------|------|
| 单测（本次 15 个） | runEmbedding 的**逻辑分支** + 错误处理 + 数据流 | openai-3-small mock client 是否被调对了次数？sort 是否生效？missing_client 是否抛对了？ |
| 集成测试（dev server + curl） | 路由层真实调 OpenAI / TEI 端到端 | 抽取后用 PRODUCT.md 跑一次 embedding，验证 dimension / batchCount / cost 与抽取前一致 |
| 端到端（eval-matrix） | 整条 pipeline 召回质量 | 同一 query 不同 provider 召回 top-K 的 overlap / 时延对比 |

每层都有自己的职责：
- 单测不应跑真实 OpenAI（费钱 + 慢 + 网络不稳定 + flaky）
- 集成不应 mock（mock 就失去真实性意义了）
- 端到端不应关心代码层逻辑

mock 单测 + 真实集成 = 测试金字塔标配。把所有 provider 都跑真实接口的"完美主义"在工程上不划算。

本次 embedding 抽取里，路由层真实调用的部分由**之前 idempotency / preprocess 时的集成验证经验**兜底——dev server 起来后路由不会因为薄路由本身崩，这是几次实测后建立的信心。
