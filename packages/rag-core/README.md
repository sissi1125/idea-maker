# @harness/rag-core

纯 RAG 算法库。**零 HTTP 依赖、零 Next.js / NestJS / framework 依赖**，可被任意 runtime 调用。

## 提取模式（feat-100.2 Wave 2 起所有 stage 遵循）

每个 pipeline stage 的算法逻辑应满足：

### 1. 函数签名

```ts
// packages/rag-core/src/<category>/<stage>.ts
import type { XxxInput, XxxResult } from "@harness/shared-types";
import { PipelineError } from "../errors";

export function runXxx(input: XxxInput): XxxResult {
  // 纯计算 + 已注入的 I/O 客户端，无 fetch、无 new pg.Client、无 process.env 直接读
  // 错误统一抛 PipelineError，由路由层翻译成 HTTP envelope
}
```

### 2. I/O 注入而非内联

- 数据库连接、HTTP 客户端、文件系统访问通过参数传入，**不在 rag-core 内部直接构造**
- 例：`runRetrieval({ ...params, pgClient })` 而不是 `runRetrieval({ ...params })` 然后内部 `new Pool()`
- 这让单测可以用内存 mock，prod 用真实 client

### 3. 错误处理

- 已知业务错误 → `throw new PipelineError(code, message, details?)`
- 未知错误自然冒泡，路由层兜底成 `{ error: { code: "internal_error", message: String(err) } }`
- 不要 try/catch 然后 return error object——交给调用方决定

### 4. 路由层职责（apps/web/app/api/pipeline/<stage>/route.ts）

```ts
import { NextRequest, NextResponse } from "next/server";
import { runXxx } from "@harness/rag-core";
import { XxxParamsSchema } from "@harness/shared-types";
import { isPipelineError } from "@harness/rag-core/errors";
// ... 加载 I/O 客户端

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const params = XxxParamsSchema.parse(body.params);
    // 路由层负责：加载文档、初始化 pg client、读 env、组装 rag-core 输入
    const { output, trace, warnings } = runXxx({ ...params, ...loaded });
    return NextResponse.json({ output, trace: { ...trace, durationMs: Date.now() - startedAt }, warnings });
  } catch (err) {
    if (isPipelineError(err)) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: codeToStatus(err.code) });
    }
    return NextResponse.json({ error: { code: "internal_error", message: String(err) } }, { status: 500 });
  }
}
```

### 5. 测试

- `packages/rag-core/src/<category>/__tests__/<stage>.test.ts` 用 vitest
- 覆盖：每个 method 主路径 + 边界（空输入、超大输入）+ 错误路径（PipelineError 抛对 code）
- 不需要测路由层——那是 Playground 手测和未来 e2e 的职责
