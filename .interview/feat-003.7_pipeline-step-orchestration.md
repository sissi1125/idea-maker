# 面试题 — Pipeline Step Orchestration（feat-003.7）

相关文件：
- `app/lib/pipelineStages.ts` — 19 个 stage 定义
- `app/lib/pipelineDeps.ts` — STAGE_DEPS + resolveEffectiveUpstream
- `app/lib/stageRegistry.ts` — StageDef / ParamDef / implemented 标志
- `app/components/playground/PipelineStepList.tsx` — 左侧 step 列表 UI + toggle

---

## Q1：pipeline 中有哪几类 stage？各自的语义是什么？

**答：**

本项目将 stage 分为四类（`category` 字段）：

| 类型 | 语义 | 能否被禁用 |
|------|------|----------|
| `required` | 主链路核心步骤，不可跳过 | 否，始终激活 |
| `optional` | 可选增强步骤，默认有开关 | 是，用户手动 toggle |
| `conditional` | 依赖运行时上下文的步骤 | 是，由 `runtimeContext[conditionKey]` 决定 |
| `optimization` | 质量优化步骤，影响效果不影响流程 | 是 |

例如：`preprocess`、`chunk`、`generation` 是 required；`context-management`（多轮对话）、`fallback`（降级兜底）、`multi-recall-merge` 是 optional；`intent-recognition` 是 conditional，仅在检测到意图识别信号时激活。

---

## Q2：`resolveEffectiveUpstream` 的作用是什么？它如何跳过被禁用的步骤？

**答：**

当可选步骤被 toggle 关闭后，下游 stage 的上游不再是固定的直接依赖，而需要沿依赖链向上寻找最近的活跃步骤。`resolveEffectiveUpstream` 就负责这个动态解析。

```typescript
export function resolveEffectiveUpstream(
  stageId: string,
  enabledSteps: Record<string, boolean>,
  runtimeContext: PipelineRuntimeContext
): string | null {
  let current = STAGE_DEPS[stageId];
  while (current) {
    const stage = PIPELINE_STAGES.find((s) => s.id === current);
    if (!stage) return current;          // 未知步骤视为活跃
    if (isStageActive(stage, enabledSteps, runtimeContext)) return current;
    current = STAGE_DEPS[current];       // 跳过，继续向上
  }
  return null;
}
```

**例子：** fallback 关闭时，prompt-build 的有效上游从 fallback 跳到 rerank：

```
STAGE_DEPS: prompt-build → fallback → rerank
isStageActive(fallback) = false → 跳过
isStageActive(rerank) = true   → 返回 "rerank"
```

required 步骤（如 preprocess、generation）永远不会被跳过，保证主链路畅通。

---

## Q3：`stageRegistry` 中的 `implemented: false` 标志是做什么用的？

**答：**

`stageRegistry.ts` 中的每个 `StageDef` 都有可选的 `implemented?: boolean` 字段（默认 undefined 即已实现）。当设为 `false` 时，前端会：

1. 将对应 stage 的 Run 按钮置灰（disabled）
2. 在 stage 名称旁显示"未实现"标记

这允许在 pipeline 定义中提前占位（`pipelineStages.ts` 已有该 stage），但不向用户开放执行，适合 roadmap 上已规划但尚未实现的步骤。

典型用例：`output-validation` 在 pipeline 中定义了 stage 和 method，但 `implemented: false` 告知前端当前不可运行。

---

## Q4：5 个可选步骤（context-management、intent-recognition、multi-recall-merge、fallback、output-validation）的职责分别是什么？

**答：**

| Stage | 职责 | 默认状态 |
|-------|------|---------|
| `context-management` | 多轮对话：合并历史消息，让 query 包含对话上下文 | 关闭（单轮 Playground 场景） |
| `intent-recognition` | 意图分类：判断用户 query 是产品咨询、投诉、闲聊等，影响后续处理策略 | conditional |
| `multi-recall-merge` | 多路召回合并：将多个检索源（dense + fulltext）的结果归一化合并，再统一进入 filter | 关闭 |
| `fallback` | 降级兜底：当检索结果不足时触发拒答或通用回复，防止低质量内容进入 prompt | 关闭 |
| `output-validation` | 输出校验：生成后检查引用有效性、格式合规、敏感词过滤 | 关闭（未实现） |

这五个步骤均有独立 API 路由，即使关闭也不影响主链路的 required 步骤运行。

---

## Q5：前端如何实现 stage toggle，切换后如何影响运行时行为？

**答：**

**UI 层（PipelineStepList）：**
每个 optional/conditional stage 旁边有开关按钮，点击后更新 `enabledSteps: Record<string, boolean>` 状态（存放在 PlaygroundShell）。required 步骤没有开关。

**运行时影响（PlaygroundShell.handleRun）：**
点击 Run 时，`handleRun` 调用 `resolveEffectiveUpstream(stageId, enabledSteps, runtimeContext)` 动态决定上游。若某个可选步骤被关闭，下游会自动跳过它，从更上层的活跃步骤取 output。

这种设计让用户可以灵活对比"开启 fallback vs 不开启 fallback"对最终生成结果的影响，而无需修改任何代码——这正是 Playground 调试工具的核心价值。
