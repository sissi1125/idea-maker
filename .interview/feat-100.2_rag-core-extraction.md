# 面试题 — rag-core 纯库抽取（feat-100.2 / idempotency 样板）

相关文件：
- `packages/rag-core/src/errors.ts` — PipelineError 统一错误类型
- `packages/rag-core/src/ingestion/idempotency.ts` — checkIdempotency 纯函数
- `packages/rag-core/src/ingestion/__tests__/idempotency.test.ts` — 13 个单测
- `packages/rag-core/README.md` — 「提取模式」5 条规则
- `packages/shared-types/src/pipeline/idempotency.ts` — zod schema + 接口
- `apps/web/app/api/pipeline/idempotency/route.ts` — 薄路由

---

## Q1：为什么要把算法从 Next.js route 里抽到独立纯库？带来什么收益？

**答：**

抽取前：535 行的 `chunk/route.ts` 把请求解析 + 算法 + 错误包装 + trace 全塞在一起。

**收益四点**：

1. **可独立测试**：算法变纯函数后，用 vitest 几毫秒跑完测试，不用起 Next.js dev server。idempotency 写了 13 个单测覆盖 3 method × 多种边界。
2. **可跨 runtime 复用**：feat-100.3 起 NestJS 后端要承接同一套算法，纯库直接 import；未来上 Cloudflare Workers / 命令行 CLI 也是同一份代码。
3. **关注点分离**：HTTP 错误码、Next.js Response、加载文档这些"运输层"的事归路由，算法只关心输入到输出的转换。
4. **重构友好**：算法升级时只动 rag-core，路由零变化；反之路由换成 NestJS 时算法零变化。

代价：增加了一层抽象，新 stage 写两个文件而不是一个。但对 18 个 stage 的体量来说，模板化复制成本可控。

---

## Q2：rag-core 里的 `PipelineError` 为什么不直接抛 HTTP status code 或 NextResponse？

**答：**

**单一职责 + 解耦**：

```ts
// rag-core 抛
throw new PipelineError("missing_document", "未提供目标文档");

// 路由层翻译
catch (err) {
  if (isPipelineError(err)) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.code === "document_not_found" ? 404 : 400 }
    );
  }
}
```

如果 rag-core 直接 `throw new NextResponse(...)` 或 `throw { status: 400 }`：
- 绑死在 Next.js 上，NestJS / CLI 都用不了
- 单测要 mock NextResponse，复杂
- HTTP 语义（404 / 409 / 502）和业务语义（document_not_found / dimension_mismatch）耦合

PipelineError 只携带语义 `code`，每个调用方（Next.js / NestJS / CLI）按自己的规则决定怎么呈现。

---

## Q3：`checkIdempotency` 的输入为什么把 targetDoc 和 otherDocs 作为参数传进来，而不是在函数里调 listDocuments？

**答：**

**I/O 注入（依赖反转）**：

```ts
// ❌ 反例
export function checkIdempotency(methodId, params) {
  const target = getDocument(...);     // 内联 I/O
  const others = listDocuments();      // 内联 I/O
  // ...
}

// ✅ 当前实现
export function checkIdempotency({ methodId, params, targetDoc, otherDocs }) {
  // 纯计算
}
```

收益：
1. **单测无需 mock 文件系统**：测试用例直接构造内存对象传入，确定性强
2. **prod 实现可替换**：路由层用 docStore（JSON 文件），未来上 DB 后改读 PostgreSQL，rag-core 零改动
3. **明确依赖边界**：函数签名暴露所有 I/O 需求，调用方一眼看清

这是常见的依赖注入设计，也是为什么 NestJS 用 DI 容器、Go 用 interface 参数。功能等价但耦合度差一个数量级。

---

## Q4：`packages/shared-types/src/pipeline/idempotency.ts` 同时导出了 zod schema 和 TypeScript 接口。为什么不只用其中一个？

**答：**

各有最佳应用场景：

```ts
// zod schema：运行时校验
export const IdempotencyParamsSchema = z.object({
  normalizeWhitespace: z.boolean().optional().default(false),
  // ...
});

// 路由层用
const params = IdempotencyParamsSchema.parse(rawBody);  // 不合法直接抛

// TypeScript 接口：编译期类型
export interface IdempotencyInput {
  methodId: IdempotencyMethodId;
  params: IdempotencyParams;
  targetDoc: { ... };
}
```

- **zod 处理"不可信输入"**：HTTP body、env、文件内容等运行时来源。`.parse()` 失败时给详细错误信息。`z.infer<typeof Schema>` 还能反推出 TS 类型，DRY。
- **接口处理"内部数据流"**：`IdempotencyInput` 里的 `targetDoc` 是路由层加载好的对象，已经在受控代码里产生，不需要再 zod 校验。直接用 interface 描述就够。

对比："zod 全包"会让内部纯函数边界也变成 `.parse()`，浪费 CPU；"只用 interface"则路由层无法校验请求体，运行时类型不安全。

---

## Q5：为什么选 vitest 不选 Jest？

**答：**

四个原因：

1. **原生 ESM**：rag-core 是 `"type": "module"` 友好型设计（实际上当前 commonjs，但路上会切 ESM）。Jest 处理 ESM 要 `babel-jest` + 复杂配置，vitest 用 esbuild 直接吃。
2. **零配置启动**：`vitest.config.ts` 8 行就跑起来。Jest 通常要 `babel.config.js` + `jest.config.js` + transformer 链。
3. **速度**：vitest 用 Vite 的 dev server 热重启，第二次 `vitest watch` 几乎瞬启。Jest 每次都要冷启动 transformer。
4. **API 同 Jest**：`describe / it / expect` 完全一致，迁移零成本。

代价：vitest 较新，生态没 Jest 那么深，遇到诡异 bug 时社区帖少。但本项目场景简单（纯函数测），不构成阻力。

---

## Q6：13 个单测里，"错误路径"测试为什么重要？比如 `targetDoc 缺失：抛 PipelineError(missing_document)`

**答：**

测试金字塔中"错误路径"经常被忽略，但生产事故 80% 出在错误路径：

```ts
it("targetDoc 缺失：抛 PipelineError(missing_document)", () => {
  expect(() =>
    checkIdempotency({
      methodId: "sha256-content",
      params: defaultParams,
      targetDoc: undefined as unknown as IdempotencyInput["targetDoc"],
      otherDocs: [],
    })
  ).toThrowError(PipelineError);
});
```

这个测试锁定两件事：
1. **错误时机**：早期发现还是后期 NPE 崩溃。`checkIdempotency` 第一行就 `if (!targetDoc) throw new PipelineError(...)`，比让代码跑到 `targetDoc.fileName` 才崩好得多。
2. **错误类型**：抛的是 `PipelineError` 而不是裸 `Error` 或 `TypeError`，路由层才能识别为业务错误返回 400 而不是 500。

如果不写这个测试，重构时不小心把 `if (!targetDoc) throw` 删掉，函数会变成在某个内部访问 `.rawContent` 时崩出 `TypeError: Cannot read property 'rawContent' of undefined`，路由层兜底成 500，前端拿到的错误体没法解析，用户看到的是"内部错误"而不是"未选择文档"。

---

## Q7：剩余 17 个 stage 怎么按这个模式复制？工作量怎么估？

**答：**

每个 stage 的复制三步：

1. **shared-types**：新建 `packages/shared-types/src/pipeline/<stage>.ts`，定义 ParamsSchema (zod) + Input/Output/Trace 接口
2. **rag-core**：新建 `packages/rag-core/src/<category>/<stage>.ts`，把原 route 里的算法搬过来，I/O 注入，错误改抛 PipelineError
3. **apps/web 薄路由**：原 route 改成参数解析 → 加载 I/O → 调 rag-core → 错误翻译
4. **测试**：`__tests__/<stage>.test.ts` 覆盖每个 method + 边界 + 错误路径

工作量按 stage 复杂度分三档：
- **简单**（hash / 字符串）：idempotency / transform / citation / filter，每个 2-3 小时
- **算法**（多 method）：chunk / preprocess / rerank，每个 0.5-1 天
- **I/O 重**（pg / LLM provider）：embedding / retrieval / storage / generation，每个 1-2 天，需要把 client 创建逻辑梳出来

总计预估 1-2 周，与 ROADMAP 估算一致。每个 stage 一个 sub-PR 利于回滚，也方便和轨道 B 协调冻结窗口。
