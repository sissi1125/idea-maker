# 面试题 — Preprocess Stage 抽取（feat-100.2 第 2 站）

相关文件：
- `packages/rag-core/src/ingestion/preprocess.ts` — runPreprocess + 5 method 实现
- `packages/rag-core/src/ingestion/__tests__/preprocess.test.ts` — 10 个单测
- `packages/shared-types/src/pipeline/preprocess.ts` — zod schema + 接口
- `apps/web/app/api/pipeline/preprocess/route.ts` — 薄路由（78 行）

---

## Q1：preprocess 有 5 种 method，3 个是 async。为什么算法函数还能保持"纯"？async 不破坏纯函数性吗？

**答：**

"纯函数"在 RAG / 数据处理里通常指**确定性 + 无副作用**，async 本身不破坏这两点：

```ts
async function parseMarkitdown(rawContent, buffer, mimeType, params): Promise<PreprocessOutput> {
  // 全部计算在内部完成，不写文件、不读 env、不修改入参
  // 异步只因 await pdfParse(buffer) 是 Promise（pdf-parse 库自己异步）
}
```

- **确定性**：同样的 (rawContent, buffer, mimeType, params) 多次调用结果完全一致
- **无副作用**：不修改输入对象，不写全局状态

唯一的 async 副作用是 pymupdf method 里的 `fetch(url)`——这是 I/O，但 URL 通过 Input 注入，rag-core 不读 env，不硬编码地址。算法本体仍然可测，路由层只需在测试里 mock fetch 即可（或像我们做的，让真实端口不通来测错误路径）。

对比反例：如果算法内部 `const url = process.env.PYMUPDF_URL`，那它就**不纯**了——同样的输入在不同环境会有不同行为，单测无法稳定。

---

## Q2：为什么把 pdf-parse / mammoth / turndown / is-html 从 apps/web 迁到 rag-core？这违反"纯库"原则吗？

**答：**

不违反。**"纯库"指代码层面无 framework 依赖（无 Next.js、无 NestJS、无 Express），不是无第三方依赖**。

- ❌ rag-core 不能依赖：`next`、`@nestjs/common`、`@vercel/...`
- ✅ rag-core 可以依赖：`pdf-parse`、`mammoth`、`turndown`、`zod`、`crypto`（Node 内置）

这些库都是**与 framework 无关的纯函数库**，可在任意 Node runtime 跑。把它们留在 apps/web 反而错了——apps/api（NestJS）下次也要用 preprocess，会拉同一份 pdf-parse 进来。集中放在 rag-core 里：
1. 单一来源，版本统一
2. apps/web 和 apps/api 都通过 `@harness/rag-core` 间接使用
3. apps/web 的 package.json 变薄，只留 framework 相关

迁移前 apps/web 有 14 个 deps，迁移后 10 个，方向正确。

---

## Q3：原 route.ts 是 520 行，薄路由后只剩 78 行。这 442 行去哪了？纯薄了还有什么剩下的逻辑？

**答：**

442 行算法逻辑搬到 `packages/rag-core/src/ingestion/preprocess.ts`（~430 行）。

薄路由剩下的 78 行职责：
1. **HTTP 解析**：`req.json()` 取 body
2. **认证 / 输入校验**：`pipelineRun.selectedDocumentId` 必填检查（业务规则，不属算法）
3. **I/O 加载**：调 `getDocument(...)` 和 `getDocumentBuffer(doc)` 把文档从 docStore 读出来
4. **env 注入**：`process.env.PYMUPDF_SERVICE_URL` 传给 rag-core
5. **schema 校验**：`PreprocessMethodId.parse(rawMethodId)` 和 `PreprocessParamsSchema.parse(rawParams)`
6. **结果包装**：把 rag-core 的 `{output, trace, warnings}` 加上 `durationMs` 后 `NextResponse.json`
7. **错误翻译**：`isPipelineError(err)` → 400/404，否则 → 500

这些都是"运输层"职责，每个 framework（Next.js/NestJS）实现细节不同但逻辑一致。换成 NestJS 后会变成 `@Controller @Post` + DTO + ExceptionFilter，但调 `runPreprocess(...)` 的核心三行不变。

---

## Q4：`PreprocessInput` 里 `pymupdfServiceUrl` 是 optional。如果路由层忘了传，会发生什么？怎么设计才稳？

**答：**

当前实现：

```ts
// rag-core 内部
await callPymupdfService(..., pymupdfServiceUrl ?? "http://localhost:8001", ...)
```

如果路由层没传，会用默认 `localhost:8001`——这是个**有意为之的回退**：本地开发场景大概率服务监听这个端口。

风险：生产环境若服务在别处但路由层忘传 URL，会静默连到 localhost:8001 拿到连接拒绝。错误信息友好（"pymupdf 服务未启动"），不会 crash，但根因不易察觉。

更严格的设计可选：
- **必填**：去掉 `?`，强制路由层传 URL（生产更安全，但 dev 多一行胶水代码）
- **打印警告**：rag-core 内部检测到使用默认值时 `console.warn("Using default pymupdf URL")`
- **环境变量约定**：rag-core 也允许读 `process.env.PYMUPDF_SERVICE_URL`，但这就破坏了"不读 env"原则

我们选择「optional + 默认值 + 错误信息友好」是平衡点：dev 顺滑、生产虽不严格但能定位问题。如果未来线上事故多，再升级为必填。

---

## Q5：5 种 method 里，markitdown 是个"分派 router"——它检测 mimeType 然后跳到对应分支。这种设计的优劣？

**答：**

```ts
async function parseMarkitdown(rawContent, buffer, mimeType, params) {
  if (isPdf) return parsePdfPages(...);  // 实际上路由到 plainText 处理
  if (isDocx) return parseMarkdownAfterMammoth(...);
  if (isHtml) return parseMarkdownAfterTurndown(...);
  if (isMarkdown) return parseMarkdown(...);
  return parsePlainText(...);
}
```

**优势**：
- 用户视角"一个 method 处理一切"，对营销文档这种格式杂乱场景很友好
- 内部复用现有 parser，不重复实现
- 失败时 fallback 链清晰（DOCX 失败 → plainText 兜底）

**劣势**：
- "method=markitdown" 实际行为不可预测，依赖 mimeType。如果 mimeType 错（如 HTML 文件标记为 text/plain），结果可能与预期偏差
- trace 里返回的 `method` 字段是 "markitdown" 而非实际选择的分支（"markdown" / "plain-text"），追溯困难。改进：trace 加 `selectedRoute: "pdf|docx|html|md|fallback"`
- 单测覆盖矩阵爆炸——markitdown 一个 method 需要测 5 种 mimeType × 多种 fallback 路径

权衡：markitdown 是个"便利层"，配上 markdown-structure / plain-text / pdf-pages 三个**确定性 method**，让需要可控的场景能避开 markitdown 的不可预测性。给用户选择权而不是只给"智能"接口。

---

## Q6：单测里 pymupdf 这一条故意指向 `http://localhost:1` 让它连不上，为什么不 mock fetch？

**答：**

两种思路各有适用：

**真实 fetch（当前做法）**：
```ts
pymupdfServiceUrl: "http://localhost:1",
// fetch 真正发出去，落到 ECONNREFUSED
```
- 验证的是**真实代码路径**：包括 fetch 调用、错误捕获、warning 文案
- 缺点：依赖系统真的没有进程监听 1 端口（一般成立）
- 缺点：测试比 mock 慢几毫秒（不影响）

**mock fetch（替代做法）**：
```ts
vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED ..."));
```
- 完全可控，跨 OS / CI 稳定
- 但 mock 是个谎言层——真实代码用的 `AbortSignal.timeout()` 或 headers 没参与测试

对纯函数 / 简单错误路径，**真实小尺度调用 > mock**，因为测试更接近真实行为，失败时定位也容易。复杂 mock 留给"需要构造特定响应 body"的场景，比如要测"pymupdf 返回 source_refs，rag-core 是否正确映射 char_start → charStart"，这就必须 mock 一个假响应。

---

## Q7：从 idempotency（173 行）到 preprocess（520 行），抽取工作量翻了 3 倍。剩 16 个 stage 还能按这个模式复制吗？

**答：**

可以，但要根据复杂度排批次：

| 类别 | stage 示例 | 工作量估 | 关键挑战 |
|------|-----------|---------|---------|
| **简单** | transform、citation、filter | 2-3 小时 | 无外部依赖，直接复制模式 |
| **中等** | chunk、preprocess、rerank | 0.5-1 天 | 多 method 分支、单测覆盖矩阵大 |
| **重 I/O** | embedding、retrieval、storage、generation | 1-2 天 | 注入 pg client / LLM client / 多 provider 适配 |

复制模式的核心三步不变：
1. shared-types 定义 schema + 接口（pymupdfServiceUrl 这种 I/O 配置作为 Input 字段）
2. rag-core 实现纯函数（依赖通过参数注入）
3. apps/web route 改薄（参数解析 → I/O 加载 → 调 rag-core → 错误翻译）

但每多一个 method 就多一组单测；每个外部 I/O（DB、HTTP、LLM API）需要决定「注入 client 实例还是注入 URL/config」。Wave 2 总工期估 1-2 周，本次会话 2 个 stage（~4 小时）符合节奏。
