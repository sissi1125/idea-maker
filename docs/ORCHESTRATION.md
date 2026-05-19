# Pipeline Step Orchestration — 架构设计文档

> **状态：待确认**（设计草案，执行前需 owner 审阅）
> **对应 feature**：`feat-003.7`

---

## 1. 问题陈述

当前 RAG Pipeline 存在以下限制：

| 问题 | 当前实现 |
|------|---------|
| 步骤固定，无法跳过 | `STAGE_DEPS` 是硬编码线性链 |
| 依赖解析不感知"已禁用"步骤 | `PlaygroundShell.handleRun` 直接读 `STAGE_DEPS[stageId]` |
| 无步骤分类（必选/可选/条件） | `PipelineStage` 只有 id/name/group |
| 用户无法在 UI 勾选步骤 | `PipelineStepList` 无 toggle 控件 |
| 新增步骤（意图识别、对话上下文等）未注册 | `PIPELINE_STAGES` 和 `stageRegistry` 缺少这些条目 |

---

## 2. 完整步骤清单（目标状态）

### 离线 Ingestion Pipeline

| stageId | 名称 | 模块 | 分类 |
|---------|------|------|------|
| document-upload | 文档上传 & 文档库 | 数据接入 | **必选** |
| idempotency | 幂等性检查 | 数据接入 | 可选 |
| preprocess | 文档预处理 | 数据处理 | 可选 |
| chunk | 分块 Chunk | 数据处理 | **必选** |
| transform | 增强 Transform | 数据处理 | 优化项（可选） |
| embedding | 向量嵌入 Embedding | 向量化 | **必选** |
| storage | 存储 Storage | 索引 | **必选** |

### 在线 Query Pipeline

| stageId | 名称 | 模块 | 分类 | 条件键 |
|---------|------|------|------|--------|
| context-management | 对话上下文管理 | 查询理解 | 条件 | `isMultiTurn` |
| intent-recognition | 意图识别 / 路由 | 查询理解 | 可选 | — |
| query-rewrite | Query 改写 | 查询理解 | 可选 | — |
| retrieval | 检索 Retrieval | 检索 | **必选** | — |
| multi-recall-merge | 多路召回合并 / 去重 | 检索后处理 | 条件 | `multipleRetrievalSources` |
| filter | 过滤 Filter | 检索后处理 | 可选 | — |
| rerank | 重排 Rerank | 检索后处理 | 可选 | — |
| fallback | 降级 / Fallback | 流程控制 | 条件 | `retrievalQualityLow`（运行时判断） |
| prompt-build | Prompt 构造 | 生成前 | **必选** | — |
| generation | 内容生成 | 生成 | **必选** | — |
| output-validation | 输出校验 / 后处理 | 生成后 | 可选 | — |
| citation | 引用 Citation | 生成后 | 可选 | — |

---

## 3. 分类语义

| 分类 | 含义 | UI 行为 |
|------|------|---------|
| **required** | 核心流程，始终执行 | 显示为固定步骤，无开关 |
| **optional** | 用户可按需启用/禁用 | 显示 toggle 开关，默认状态由 `defaultEnabled` 决定 |
| **conditional** | 根据运行时上下文自动决定是否执行 | 显示为灰色/信息状态，旁边说明触发条件；用户可强制覆盖 |
| **optimization** | 优化项，分类同 optional，但 UI 显示"推荐"徽章 | 同 optional |

---

## 4. 架构变更方案

### 4.1 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/pipelineStages.ts` | **新建** | 从 `PipelineStepList.tsx` 提取 `PipelineStage`/`PIPELINE_STAGES`，扩展 category/module/conditionKey 字段，补充所有新步骤 |
| `lib/pipelineDeps.ts` | **修改** | 更新 `STAGE_DEPS` 补充新步骤；新增 `resolveEffectiveUpstream` 函数 |
| `lib/types.ts` | **修改** | `PipelineRun` 扩展 `enabledSteps` 和 `runtimeContext` |
| `lib/stageRegistry.ts` | **修改** | 补充新步骤的 `StageDef` stub（暂无 API route，methods 含 "not-implemented" 提示） |
| `components/playground/PipelineStepList.tsx` | **修改** | 导入新 `lib/pipelineStages.ts`；可选步骤添加 toggle switch；条件步骤显示状态说明 |
| `components/playground/PlaygroundShell.tsx` | **修改** | `PipelineRun` 初始化 `enabledSteps` 默认值；`handleRun` 改用 `resolveEffectiveUpstream`；向下传 toggle handler |
| `components/playground/StageConfigPanel.tsx` | **修改** | 当步骤被禁用时显示"此步骤已跳过"提示而非正常配置界面 |

### 4.2 关键类型变更

```typescript
// lib/pipelineStages.ts（新文件）
export type StepCategory = "required" | "optional" | "conditional" | "optimization";

export interface PipelineStage {
  id: string;
  name: string;
  group: "ingestion" | "retrieval" | "generation";
  module: string;
  category: StepCategory;
  defaultEnabled: boolean;       // optional 步骤的默认开关状态
  conditionKey?: keyof PipelineRuntimeContext; // 条件步骤的触发键
  featureId: string;
}
```

```typescript
// lib/types.ts（扩展）
export interface PipelineRuntimeContext {
  isMultiTurn: boolean;
  multipleRetrievalSources: boolean;
  retrievalQualityLow: boolean;    // 由 retrieval/filter stage 运行结果写入
}

export interface PipelineRun {
  status: PipelineRunStatus;
  selectedDocumentId: string | null;
  selectedDocumentVersionId: string | null;
  /** 可选/条件步骤的启用状态。required 步骤不在此 map 中（始终启用） */
  enabledSteps: Record<string, boolean>;
  /** 运行时上下文，影响条件步骤的自动判断 */
  runtimeContext: PipelineRuntimeContext;
}
```

### 4.3 依赖解析的核心逻辑

```typescript
// lib/pipelineDeps.ts（新增函数）

/**
 * 解析当前 stage 的有效上游：
 * - 沿 STAGE_DEPS 链向上查找
 * - 遇到 optional/conditional 且被禁用的步骤时跳过，继续向上
 * - required 步骤永远不跳过
 * - 找不到则返回 null（入口步骤）
 */
export function resolveEffectiveUpstream(
  stageId: string,
  enabledSteps: Record<string, boolean>,
  runtimeContext: PipelineRuntimeContext
): string | null {
  let current = STAGE_DEPS[stageId];
  while (current) {
    const stage = PIPELINE_STAGES.find((s) => s.id === current);
    if (!stage) return current; // 找不到 metadata 则保守处理：当作存在
    if (isStageActive(stage, enabledSteps, runtimeContext)) return current;
    current = STAGE_DEPS[current]; // 跳过，继续向上
  }
  return null;
}

/** 判断一个 stage 在当前配置下是否活跃（不被跳过） */
export function isStageActive(
  stage: PipelineStage,
  enabledSteps: Record<string, boolean>,
  runtimeContext: PipelineRuntimeContext
): boolean {
  if (stage.category === "required") return true;
  if (stage.category === "conditional" && stage.conditionKey) {
    // 用户可通过 enabledSteps 强制覆盖条件判断
    if (stage.id in enabledSteps) return enabledSteps[stage.id];
    return runtimeContext[stage.conditionKey] === true;
  }
  // optional / optimization：以 enabledSteps 为准，若不存在则用 defaultEnabled
  return enabledSteps[stage.id] ?? stage.defaultEnabled;
}
```

### 4.4 STAGE_DEPS 更新（含新步骤）

```typescript
export const STAGE_DEPS: Record<string, string> = {
  // ingestion 链（不变）
  idempotency:  "document-upload",
  preprocess:   "idempotency",
  chunk:        "preprocess",
  transform:    "chunk",
  embedding:    "transform",
  storage:      "embedding",

  // query 链（新增步骤补充）
  intent-recognition:    "context-management",
  query-rewrite:         "intent-recognition",
  retrieval:             "query-rewrite",
  multi-recall-merge:    "retrieval",
  filter:                "multi-recall-merge",
  rerank:                "filter",
  fallback:              "rerank",
  prompt-build:          "fallback",
  generation:            "prompt-build",
  output-validation:     "generation",
  citation:              "output-validation",
};

export const ENTRY_STAGES = new Set(["document-upload", "context-management"]);
```

> **注意**：`query-rewrite` 原来是入口，现在变为 `context-management` 是入口，`query-rewrite` 在其下游。`context-management` 本身是条件步骤，当它被跳过时，`resolveEffectiveUpstream("intent-recognition", ...)` 会沿链往上找不到更多，返回 null，即 intent-recognition 此时变为入口。

### 4.5 PipelineStepList UI 设计

```
┌── Ingestion ──────────────────────────────────────┐
│  ● 文档上传 & 文档库          [必选]              │
│  ○ 幂等性检查           [可选] [toggle: ON ]       │
│  ○ 文档预处理           [可选] [toggle: ON ]       │
│  ● 分块 Chunk                 [必选]              │
│  ○ 增强 Transform       [优化] [toggle: ON ] ★    │
│  ● 向量嵌入 Embedding         [必选]              │
│  ● 存储 Storage               [必选]              │
└───────────────────────────────────────────────────┘
┌── Retrieval ──────────────────────────────────────┐
│  ◈ 对话上下文管理      [条件: 多轮对话] ⓘ        │
│  ○ 意图识别 / 路由     [可选] [toggle: OFF]        │
│  ○ Query 改写          [可选] [toggle: ON ]        │
│  ● 检索 Retrieval             [必选]              │
│  ◈ 多路召回合并        [条件: 多路检索] ⓘ        │
│  ○ 过滤 Filter         [可选] [toggle: ON ]        │
│  ○ 重排 Rerank         [可选] [toggle: ON ]        │
│  ◈ 降级 Fallback       [条件: 召回不足] ⓘ        │
│  ● Prompt 构造                [必选]              │
└───────────────────────────────────────────────────┘
┌── Generation ─────────────────────────────────────┐
│  ● 内容生成                   [必选]              │
│  ○ 输出校验 / 后处理   [可选] [toggle: OFF]        │
│  ○ 引用 Citation       [可选] [toggle: ON ]        │
└───────────────────────────────────────────────────┘
```

---

## 5. 不影响现有实现的策略

| 约束 | 实现方式 |
|------|---------|
| 现有 API routes 不动 | 新步骤暂无 route，stageRegistry 中返回 `status: "not_implemented"` stub |
| 现有组件接口不破坏 | `PipelineRun` 字段向后兼容（`enabledSteps` 默认 `{}`，`runtimeContext` 有默认值） |
| 现有依赖逻辑不破坏 | `handleRun` 调用 `resolveEffectiveUpstream` 代替直接读 `STAGE_DEPS`；当所有步骤都 enabled 时行为与现在完全一致 |
| `PIPELINE_STAGES` 迁移 | 从 `PipelineStepList.tsx` 提取到 `lib/pipelineStages.ts`，组件改为 import |

---

## 6. 分阶段实现计划

### Phase 1：基础设施（`feat-003.7`，本次执行）

1. 新建 `lib/pipelineStages.ts`（提取 + 扩展 PipelineStage 类型，补全所有步骤定义）
2. 更新 `lib/types.ts`（`PipelineRun` 加 `enabledSteps` + `runtimeContext`）
3. 更新 `lib/pipelineDeps.ts`（`STAGE_DEPS` 补全 + `resolveEffectiveUpstream`）
4. 更新 `lib/stageRegistry.ts`（补充新步骤 StageDef stub）
5. 更新 `components/playground/PipelineStepList.tsx`（toggle UI）
6. 更新 `components/playground/PlaygroundShell.tsx`（接入新依赖解析 + toggle 状态管理）
7. 更新 `components/playground/StageConfigPanel.tsx`（禁用状态展示）

### Phase 2：新步骤 API routes（`feat-004.*` 延伸 + `feat-005.*`）

按步骤顺序依次实现：intent-recognition → context-management → multi-recall-merge → fallback → prompt-build → output-validation（generation 已在 feat-005 中规划）

---

## 7. 未解决的设计问题（需 owner 决策）

1. **`fallback` 的触发时机**：当前设计为条件步骤，由 `retrievalQualityLow` 上下文键触发。该键何时写入？建议由 `filter` 或 `rerank` 阶段的 output 中的 `qualityScore` 自动判断，写入 `runtimeContext`。是否同意？

2. **`context-management` 作为新入口**：原 `query-rewrite` 是 retrieval 链的入口，现在 `context-management` 成为更上游的入口，`query-rewrite` 的 UI 状态（独立运行按钮）需要重新考虑。是否接受这个变更？

3. **条件步骤的"强制覆盖"**：设计允许用户通过 toggle 强制开/关条件步骤（如手动开启 `context-management` 即使不是多轮场景）。是否需要这个能力？

4. **新步骤 stub 的 UI 展示**：未实现的步骤在被选中时，StageConfigPanel 显示"即将推出"提示还是直接显示参数配置但 Run 按钮 disabled？建议显示参数配置（便于预览设计），Run 按钮 disabled + 提示"API 路由尚未实现"。
