# feat-200.3 面试题：Pipeline Orchestrator + Generations + Generate 端点

> Idea-Maker MVP Week 3。本题面向"讲清楚 YAML 配置驱动的多 stage 编排、成本追踪、错误容忍设计"的求职/学习场景，
> 答案结合本项目实际代码（`apps/api/src/pipeline-orchestrator|generations/`）。

---

## 1. 为什么 MVP 选择 Pipeline Orchestrator 而不是 Agent？两者的本质区别是什么？

**答**：

| 维度 | Pipeline Orchestrator（本项目 MVP） | Agent（Phase 4 目标） |
|---|---|---|
| 决策者 | **开发者**：YAML 写死 stage 顺序 | **LLM**：ReAct 循环自主决策下一步 |
| 执行路径 | 固定 DAG：query-rewrite → retrieval → ... → generation | 动态：LLM 看到检索结果不够 → 决定换 query 重新检索 |
| 工具选择 | 每个 stage 的 method 在配置里写死 | LLM 从工具列表自主选（可能跳过某些 stage） |
| 自评估 | evaluation stage 算分但不影响流程 | 自评估不满意 → 自动迭代（最多 N 轮） |
| 实现复杂度 | ~300 行编排逻辑 | 需要 ReAct prompt + 工具注册 + 循环控制 + 成本上限 |

MVP 选 Pipeline 的原因：
1. **核心价值不依赖 Agent**：透明的 18-stage 全链路追踪 + 成本可视化才是差异化
2. **可预测性**：固定编排下 cost/latency 可预估；Agent 可能陷入无限循环
3. **8 周时间约束**：Agent 需要额外 prompt 工程 + 工具注册 + 循环控制，至少多 2 周

代码位置：[pipeline-orchestrator.service.ts](apps/api/src/pipeline-orchestrator/pipeline-orchestrator.service.ts)

---

## 2. YAML 配置驱动的编排 vs 硬编码 if-else，trade-off 是什么？

**答**：

**当前方案：** `default.yaml` 定义 11 个 stage 的 `id / method / params`，service 启动时加载一次。

| 方案 | 优点 | 缺点 |
|---|---|---|
| YAML 配置 | 非开发者可调参（改 topK / temperature）；多 pipeline 可共存（A/B 测试）；stage 顺序一目了然 | 运行时无类型校验（YAML 写错只能启动时发现）；配置与代码分离增加调试成本 |
| 硬编码 | TypeScript 类型安全；IDE 自动补全；断点调试方便 | 改参数要改代码 + 重启；多 pipeline 需复制粘贴大量代码 |

**关键设计**：YAML 定义"做什么"（stage + method + 默认 params），TypeScript 代码定义"怎么做"（每个 stage 的 client 注入 + upstream 传递 + 错误处理）。两者分工清晰。

**升级路径**：Week 5 Settings 页面上线后，用户可通过 UI 覆盖 YAML 默认参数（project_settings 表存 pipeline overrides）。

---

## 3. `runStage` 通用执行器的错误容忍设计：为什么 catch 错误但不抛出？

**答**：

```typescript
private async runStage<T>(stages, stageId, executor): Promise<T | undefined> {
  try {
    const result = await executor(cfg);
    stages.push({ status: "success", ... });
    return result.output;
  } catch (err) {
    stages.push({ status: "error", error: msg });
    return undefined;  // 不抛出！
  }
}
```

**设计理由：11-stage pipeline 中间任何一环出错都不应导致整个请求 500**：

1. **retrieval 报错** → `matches = []` → 触发 fallback 路径 → 用户看到"信息不足，请补充资料"而非 500 错误
2. **evaluation 报错** → 只影响质量评分，不影响 generation 结果 → 用户仍能拿到文案
3. **rerank 报错** → filter 产出直接传给 citation → 质量下降但流程不中断

**代价**：下游 stage 需要处理 `undefined` upstream（空值检查增多）。本项目每个 stage 入口都有 `if (!retrievalOutput)` → `useFallback = true` 的分支。

**对比**：ingestion job runner（feat-200.2）是 `throw` 式——任何 stage 失败直接标记 job 为 failed。因为 ingestion 是数据入库，部分成功 = 数据不一致，必须全失败。而 generation 是"尽力而为"——有 3 段检索结果比 0 段好，即使 rerank 失败。

---

## 4. TraceContextService 的 `addCost()` 是如何跨 stage 累计成本的？AsyncLocalStorage 在这里扮演什么角色？

**答**：

**调用链路**：
```
HTTP Request → TracingInterceptor.run(traceId, ...) → ALS 上下文创建
  → GenerationsService.generate()
    → PipelineOrchestratorService.run()
      → runRetrieval() → this.tracer.addCost({ retrievalCalls: 1 })
      → runGeneration() → this.tracer.addCost({ llmTokensPrompt: N })
      → ...
  → tracer.current().cost  // 读出累计值
```

**AsyncLocalStorage 的作用**：

1. **自动传递**：`als.run(ctx, fn)` 启动一个上下文后，`fn` 内部所有同步/异步代码（包括嵌套的 `await`）都能通过 `als.getStore()` 拿到同一个 `ctx` 对象
2. **请求隔离**：两个并发 generate 请求各自在独立的 ALS 上下文里，`addCost` 互不干扰
3. **零侵入**：orchestrator 调 `this.tracer.addCost(...)` 不需要显式传递 traceId 或 cost 对象

**陷阱**：EventEmitter 回调不自动继承 ALS 上下文（Node.js 限制）。Week 4 的 `AutoGenerationService` 监听 `ingestion.completed` 事件时，需要手动 `als.enterWith()` 或 `als.run()` 绑定新上下文。

---

## 5. 为什么 generation 是同步请求（等完整结果）而不像 ingestion 那样走异步 job + SSE？

**答**：

| 维度 | Ingestion（异步 job + SSE） | Generation（同步等结果） |
|---|---|---|
| 耗时 | 30s-5min（PDF 解析 + 分块 + embedding） | 2-10s（LLM 一次调用为主） |
| 用户期望 | "我传了文件，去做别的事，回来看进度" | "我问了问题，等回答" |
| 中间状态 | 有意义：5 stage 进度 0→100 | 无意义：用户不关心 retrieval vs rerank |
| 断线恢复 | 必须：上传 5 分钟文件不能重来 | 不需要：重新问一次即可 |
| 并发场景 | 一次传 10 个文档，后台并行处理 | 一次一个问题，串行就行 |

**升级触发器**：Week 8 如果需要展示"4 阶段思考动画"（think → search → tools → gen），会加 `/generate/events` SSE 端点。但前端动画不依赖真实 stage 事件——原型用伪延时 `[1400, 1600, 1400, 1800]ms`，MVP 也用同样策略。

---

## 6.（加分题）Pipeline 中的 Fallback 机制：什么条件触发？Fallback 的设计哲学是什么？

**答**：

**触发条件**：Retrieval 返回 0 条匹配结果（`matches.length === 0`）。

**执行流程**：
```
retrieval → 0 results
  → useFallback = true
  → 跳过 filter/rerank/citation/prompt-build/generation/evaluation
  → 直接执行 fallback stage
  → resultNotes = "抱歉，当前信息不足..."
```

**设计哲学 — "不说谎"原则**：

与通用 ChatGPT 不同，Idea-Maker 是基于用户上传的产品资料生成营销内容的 RAG 系统。如果检索不到相关资料：
- **错误做法**：让 LLM "创作"内容 → 用户拿到与产品不符的文案，比没有更糟
- **正确做法**：明确告诉用户"资料不足，请补充" → 用户知道该上传更多文档

**两种 fallback method**：
- `reject-answer`：直接返回配置的 fallbackMessage（当前默认）
- `generic-response`：调 LLM 生成通用回答，但标注"未基于产品资料"（需要 LLM client）

这是 plan 文档说的"透明可观测"价值主张的核心体现：用户永远知道结果基于哪些资料生成的，而不是黑盒 AI 的编造。

代码位置：[pipeline-orchestrator.service.ts](apps/api/src/pipeline-orchestrator/pipeline-orchestrator.service.ts) fallback 分支
