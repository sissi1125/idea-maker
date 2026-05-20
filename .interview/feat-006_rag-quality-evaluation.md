# 面试题 — RAG Quality Evaluation（feat-006）

相关文件：
- `app/app/api/pipeline/evaluation/route.ts`
- `app/components/playground/EvaluationOutputPanel.tsx`
- `app/app/api/pipeline/prompt-build/route.ts`（evidencePack passthrough）
- `app/app/api/pipeline/generation/route.ts`（evidencePack passthrough）

---

## Q1：工业界评估 RAG 系统质量的主流指标有哪些？本项目实现了哪些，为何这样选择？

**答：**

**工业界主流框架（RAGAS 等）的核心指标：**

| 指标 | 含义 | 是否需要 LLM |
|------|------|------------|
| Faithfulness（忠实度） | 生成内容是否有 evidence 支撑 | ✅ |
| Answer Relevance（答案相关性） | 生成内容是否真正回答了问题 | ✅ |
| Context Precision（上下文精准度） | 检索到的 chunk 中有多少是真正相关的 | ✅ |
| Context Recall（上下文召回率） | 相关内容是否都被检索到 | 需要 ground truth |

上述指标大多依赖 LLM 进行语义判断，或需要人工标注的 ground truth，生产部署成本高。

**本项目实现了两层：**

1. **算法指标（无 LLM）**：
   - `hitRate`：score ≥ threshold 的 evidence 比例，代理"检索质量"
   - `citationCoverage`：被生成内容引用的 evidence 比例，代理"忠实度的可观测下界"
   - `confidenceScore`：被引用 evidence 的平均 score，代理"引用的可信度"

2. **LLM Faithfulness Judge（可选）**：真正语义层面的忠实度评估，接近 RAGAS 标准

**选择理由：** Playground 是调试工具，算法指标可以瞬时反馈（无额外 API 成本），帮助快速定位问题（检索质量差 vs 引用覆盖不足 vs 置信度低）；LLM judge 作为可选项，需要时才触发更精确的语义评估。

---

## Q2：hitRate、citationCoverage、confidenceScore 的计算公式是什么？各自能诊断什么问题？

**答：**

```
hitRate          = evidence[score ≥ scoreThreshold].length / totalEvidence
citationCoverage = citedEvidence.length / totalEvidence        // citedEvidence = evidencePack.filter(id in citedEvidenceIds)
confidenceScore  = mean(score of citedEvidence)
```

注意：`citedCount` 取的是 evidencePack 中实际匹配到的 evidence 数量，而非上游传入的 `citedEvidenceIds.length`，防止重复 ID 或幻觉 ID 导致覆盖率超过 1.0。

**诊断场景：**

| 症状 | 可能原因 | 调整方向 |
|------|---------|---------|
| hitRate 低 | 检索到的 chunk 大多不相关 | 调整 embedding 模型、top-k、score threshold |
| citationCoverage = 0 | 生成内容没有引用任何 evidence | generation prompt 未要求标注引用；evidence-first 原则被违反 |
| citationCoverage 低 | 只引用了少量 evidence | rerank 截断过早；generation 模型选择性忽略 evidence |
| confidenceScore 低 | 引用的 evidence 本身分数不高 | 检索质量不足，被引用的是低相关 chunk |

---

## Q3：evidencePack 是如何从 citation stage 透传到 evaluation stage 的？

**答：**

citation stage 产出的 `evidencePack: EvidenceItem[]` 需要跨越 prompt-build 和 generation 两个中间 stage 才能到达 evaluation。本项目采用**字段透传（passthrough）**方案，而非从快照读取：

```
CitationOutput.evidencePack
  → PromptBuildOutput.evidencePack?    (prompt-build/route.ts 新增字段)
  → GenerationOutput.evidencePack?     (generation/route.ts 四种方法均 passthrough)
  → EvaluationRoute upstreamOutput.evidencePack
```

**实现细节：**
- `buildRAGTemplate` / `buildMarketingTemplate` 接收 `evidencePack?` 参数并写入返回值
- `generation` route 的 marketing-ideas 分支直接在 output 对象里加 `evidencePack: upstreamOutput.evidencePack`；三种结构化方法用 `output = { ...output, evidencePack: upstreamOutput.evidencePack }` spread 追加
- evaluation stage 的 `upstreamOutput` 是 generation 的输出，直接读取 `evidencePack`

**为什么不从快照读取？** 快照方案需要 evaluation API 主动查 DB，引入了数据库依赖和异步复杂度；passthrough 保持了"每 stage API 无状态、只依赖 upstreamOutput"的架构一致性。

---

## Q4：LLM Faithfulness Judge 的 Prompt 设计有哪些关键点？JSON parse 失败时如何处理？

**答：**

**Prompt 设计关键点：**

1. **角色设定**：明确"RAG 质量评估员"角色，要求逐条检查主张
2. **输出格式约束**：使用 `response_format: { type: "json_object" }` + system prompt 中显式定义 JSON schema，防止模型输出 markdown 或解释文字
3. **temperature = 0.1**：评估任务需要一致性，低温度减少随机性
4. **evidence 截断**：每条 evidence 限制 300 字，防止超出 context window
5. **generatedContent 组装**：marketing-ideas 用 `generatedContent` 原文；结构化方法（product-persona 等）将关键字段拼接成可读文本，因为它们没有单一的 `generatedContent` 字段

**JSON parse 失败处理：**

```typescript
try {
  parsed = JSON.parse(raw);
} catch {
  throw new Error(`LLM 返回内容无法解析为 JSON，原始内容：${raw.slice(0, 100)}`);
}
```

抛出的错误被外层 Route Handler 的 try/catch 捕获，推入 `faithfulnessWarnings`，`faithfulness` 保持 `null`，算法指标正常返回。这样避免了 JSON 解析失败时 score 静默归零，误触"忠实度偏低"warning 的问题。

---

## Q5：evaluation stage 的 level（good/warning/poor）是如何计算的？这个设计有什么权衡？

**答：**

**计算规则：**
```typescript
function computeLevel(metrics, faithfulnessScore, warnings) {
  if (metrics.citationCoverage === 0 || warnings.length >= 2) return "poor";
  const faithOk = faithfulnessScore === null || faithfulnessScore >= 0.7;
  if (metrics.hitRate >= 0.5 && metrics.citationCoverage >= 0.5 && faithOk) return "good";
  return "warning";
}
```

**设计权衡：**

1. **citationCoverage = 0 → 直接 poor**：引用覆盖率为 0 是最严重的信号，意味着 evidence-first 原则被完全违反（生成内容无任何 evidence 支撑），无论其他指标如何都不可信。

2. **warnings ≥ 2 → poor**：多个预警叠加表明系统多处失效，单一指标好但其他差的情况对整体质量影响不大。

3. **faithfulness 为 null 时视为满足 good 条件**：仅使用 `rag-metrics-only` 时不应因为没有 LLM 评估而降级，算法指标达标就可以是 good。

4. **阈值硬编码（0.5、0.3、0.7）**：这是 debug playground 场景的经验值，不同业务场景可能需要调整。生产环境应该允许通过配置覆盖这些阈值。
