# Harness Bug 记录台账

> 目的：为 harness 工程自我进化提供可查阅的历史，记录每个 bug 的现象、根因、修复方式和涉及文件。
> 格式：倒序（最新在前）。每条记录包含 commit hash、日期、严重级别。
>
> 严重级别：🔴 Blocker（阻断主流程） | 🟡 Major（功能错误但有绕路） | 🟢 Minor（体验问题）

---

## BUG-006 · 2026-05-19 · commit TBD

**严重级别**：🟢 Minor（参数层面配置错误）

### 现象
所有 embedding / retrieval 相关 stage 的表单默认值仍是 OpenAI 配置（`text-embedding-3-small`、维度 `1536`、baseUrl 为空），导致使用 Qwen 模型时必须手动修改多个字段，且极易漏改。

### 根因
`stageRegistry.ts` 里 `embedding.openai-3-small`、`retrieval.dense-vector`、`retrieval.hybrid-rrf` 三处 `model` / `dimension` / `baseUrl` default 值写死为 OpenAI 配置。

### 修复
- `app/lib/stageRegistry.ts`：
  - `embedding.openai-3-small`：model default → `text-embedding-v4`，dimension default → `1024`，baseUrl default → `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - `retrieval.dense-vector` & `retrieval.hybrid-rrf`：`embeddingModel` → `text-embedding-v4`，`embeddingDimension` → `1024`（min 改为 `64`），baseUrl default → DashScope URL
  - 所有 embedding dimension 字段 hint 补充 Qwen 合法维度列表：`64/128/256/512/768/1024/1536/2048/3072`

### 涉及文件
- `app/lib/stageRegistry.ts`

---

## BUG-005 · 2026-05-19 · commit TBD

**严重级别**：🔴 Blocker（Qwen embedding 请求直接 400）

### 现象
在 retrieval 阶段使用 Qwen `text-embedding-v4` 时报错：
```
400 InternalError.Algo.InvalidParameter: Value error, dimension for embedding v3 is invalid,
its value shold be in [64, 128, 256, 512, 768, 1024, 1536, 2048, 3072]
```

### 根因
1. Qwen embedding API 对 `dimensions` 参数有白名单限制，仅接受 `[64, 128, 256, 512, 768, 1024, 1536, 2048, 3072]`。
2. `stageRegistry.ts` 中 `retrieval.dense-vector.embeddingDimension` 的 min 值为 `1`，用户测试 debug-deterministic 时用的 dim=4 被保留为表单值，切换 Qwen 后以 `4` 请求 API 触发该错误。
3. params 持久化（BUG-003 引入的 `stageParamsMap`）使旧的非法值在切换回来时被还原。

### 修复
- `app/lib/stageRegistry.ts`：`embeddingDimension` min 改为 `64`（Qwen/OpenAI 最小合法值），default 改为 `1024`
- hint 补充合法维度范围提示（见 BUG-006）

### 涉及文件
- `app/lib/stageRegistry.ts`

---

## BUG-004 · 2026-05-19 · commit TBD

**严重级别**：🟡 Major（optional stage 关闭后仍可误触发执行）

### 现象
在左侧 PipelineStepList 将某个 optional stage（如 `transform`、`fallback`）的开关关闭后，右侧 StageConfigPanel 的「▶ 运行」按钮仍可点击并执行，产生与 pipeline 状态不一致的结果。

### 根因
`StageConfigPanel` 的 `runDisabled` 计算：
```tsx
const runDisabled = isRunning || hasErrors || !!blockReason || !isImplemented;
```
缺少 `!stageActive` 一项。`pipelineRun.enabledSteps` 已持有开关状态，但 StageConfigPanel 未使用 `isStageActive()` 检查。

### 修复
- `app/components/playground/StageConfigPanel.tsx`：
  - 新增 `import { ..., isStageActive } from "@/lib/pipelineDeps"`
  - 计算 `const stageActive = isStageActive(stage, pipelineRun.enabledSteps, pipelineRun.runtimeContext)`
  - `runDisabled` 追加 `|| !stageActive`
  - 按钮状态文字：当 `!stageActive` 时显示「步骤已关闭 — 在左侧开关开启后可运行」

### 涉及文件
- `app/components/playground/StageConfigPanel.tsx`

---

## BUG-003 · 2026-05-19 · commit 6fca865

**严重级别**：🟢 Minor（参数重置降低调试效率）

### 现象
在 embedding 阶段修改批大小（batchSize）后跳转到 storage 阶段，再返回 embedding，批大小恢复默认值 100。

### 根因
`PlaygroundShell` 给 `StageConfigPanel` 传了 `key={activeStage.id}`，切换 stage 时组件完全卸载重挂，`useState` 初始化为 `defaults(firstMethod)`，丢失之前的修改。

### 修复
- `app/components/playground/PlaygroundShell.tsx`：增加 `stageParamsMap` state（`Record<stageId, {methodId, params}>`），通过 `handleParamsChange` 回调在每次 param/method 变更时持久化
- `app/components/playground/StageConfigPanel.tsx`：接收 `initialMethodId` / `initialParams` / `onParamsChange` props，初始化 state 时优先使用传入值

### 涉及文件
- `app/components/playground/PlaygroundShell.tsx`
- `app/components/playground/StageConfigPanel.tsx`

---

## BUG-002 · 2026-05-19 · commit 6fca865

**严重级别**：🔴 Blocker（展开 embedding output 直接卡崩浏览器）

### 现象
embedding stage 运行成功后，点击右侧 Output 面板展开 `chunks` 数组，页面立即卡死或浏览器 tab 崩溃。

### 根因
`OutputTracePanel` 的 `truncateStrings()` 只截断字符串，`number[]` 类型的 embedding 向量（最大 1536 维）原样透传。`CollapsibleJson` 展开时调用 `JSON.stringify(value, null, 2)` 对所有 chunk（含 embedding）序列化，100 chunks × 1536 dim ≈ 15 万个数字，DOM 渲染时卡死。

### 修复
- `app/components/playground/OutputTracePanel.tsx`：
  - `truncateStrings()` 新增 `number[]` 检测：length > 16 的纯数字数组替换为 `{ __vector, dimension, preview[0..5], full }`
  - 新增 `VectorSummary` 组件：行内显示「向量 [N 维]」chip + 前 6 个分量，点击「展开全部」后在 `max-h-40` 滚动区内懒加载完整向量，不做 JSON.stringify

### 涉及文件
- `app/components/playground/OutputTracePanel.tsx`

---

## BUG-001 · 2026-05-19 · commit 6fca865

**严重级别**：🔴 Blocker（pgvector HNSW 索引创建失败）

### 现象
storage stage 完成向量写入后建 HNSW 索引时报错：
```
ERROR: column "embedding" does not have dimensions
```

### 根因
DDL 建表时使用 `embedding vector`（无维度），保持了对不同 embedding provider 的兼容性。但 pgvector 的 HNSW / IVFFlat 索引要求列类型必须是 `vector(N)`（含明确维度），对无维度列抛出此错误。

### 修复
- `app/app/api/pipeline/storage/route.ts`：
  - `ensureVectorIndex` 新增 `dimension: number` 参数
  - 建索引前先执行 `ALTER TABLE rag_chunks ALTER COLUMN embedding TYPE vector(${dimension})`
  - Dimension Guard 已确保表内维度一致，ALTER COLUMN 是安全操作
  - 更新调用处传入 `dimension`

### 涉及文件
- `app/app/api/pipeline/storage/route.ts`

---

## BUG-000（历史，Session 6 修复）· commit e873cc1

以下三个 bug 在上一 session 修复，此处补录：

### BUG-000a · Transform 禁用后 Embedding 崩溃
- **现象**：关闭 optional `transform` 步骤后运行 embedding 报 `cannot read property 'enhancedText' of undefined`
- **根因**：`TransformedChunk` 接口中 `enhancedText` 字段为必选，但 resolveEffectiveUpstream 跳过 transform 后传入的是 chunk output（无 `enhancedText`）
- **修复**：`enhancedText` / `enhancedTokenEstimate` 改为可选（`?`），所有消费处用 `c.enhancedText ?? c.text` 回退
- **文件**：`app/app/api/pipeline/embedding/route.ts`, `app/app/api/pipeline/storage/route.ts`

### BUG-000b · Dimension Guard 阻止正常开发切换
- **现象**：先用 debug-deterministic（dim=4）测试，再换 text-embedding-v4（dim=1024），Dimension Guard 报错且无法绕过
- **修复**：storage 所有方法新增 `truncateTable: boolean` 参数（default false），开启后写入前执行 `TRUNCATE TABLE rag_chunks` + drop indexes
- **文件**：`app/app/api/pipeline/storage/route.ts`, `app/lib/stageRegistry.ts`

### BUG-000c · Provider 锁定（只支持 OpenAI）
- **现象**：LLM / embedding 调用写死 `OPENAI_API_KEY`，使用 Qwen/DashScope 时无法配置 baseURL
- **修复**：新建 `app/lib/providers.ts` provider factory，读取 `LLM_API_KEY` / `LLM_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL`，支持任何 OpenAI-compatible API
- **文件**：`app/lib/providers.ts`（新建），多个 route 文件
