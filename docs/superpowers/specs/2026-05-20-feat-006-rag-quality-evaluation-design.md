# feat-006 RAG Quality Evaluation 设计文档

## 目标

在 RAG pipeline 的 generation 之后，新增一个可选的"RAG 质量评估" stage。
提供两种评估方法：纯算法指标（对标 RAGAS 中可无监督计算的部分）和算法 + LLM Faithfulness judge（更接近工业标准）。
结果在专属 EvaluationOutputPanel 中以卡片形式展示，直观传递"好/差"信号。

## 架构

### Pipeline 位置

```
citation → prompt-build → generation → [evaluation]  (可选，默认开启)
```

evaluation 是最后一个 stage，接收 generation 的输出作为上游。

### evidencePack 透传

evaluation 需要两类数据：
- `citedEvidenceIds`：来自 generation output（已有）
- `evidencePack`（含每条 evidence 的 score）：来自 citation output

为保持"每 stage 只接收一个 upstreamOutput"的架构一致性，通过 passthrough 传递：
1. `prompt-build/route.ts`：从 CitationOutput 中取 evidencePack，加入 PromptBuildOutput
2. `generation/route.ts`：从 PromptBuildOutput 中取 evidencePack，加入 GenerationOutput（所有四种方法）
3. `evaluation/route.ts`：从 GenerationOutput 中同时读取 citedEvidenceIds 和 evidencePack

### 新增/修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/app/api/pipeline/evaluation/route.ts` | 新建 | evaluation API 路由 |
| `app/components/playground/EvaluationOutputPanel.tsx` | 新建 | 专属展示面板 |
| `app/lib/pipelineStages.ts` | 修改 | 新增 evaluation stage 定义 |
| `app/lib/stageRegistry.ts` | 修改 | 注册两种方法的 params |
| `app/app/api/pipeline/prompt-build/route.ts` | 修改 | PromptBuildOutput 加 evidencePack passthrough |
| `app/app/api/pipeline/generation/route.ts` | 修改 | GenerationOutput 加 evidencePack passthrough |
| `app/components/playground/PlaygroundShell.tsx` | 修改 | evaluation stage 时渲染 EvaluationOutputPanel |

## 数据类型

### PromptBuildOutput（新增字段）

```typescript
// 在现有字段基础上追加（不修改已有字段）
export interface PromptBuildOutput {
  systemPrompt: string;
  userPrompt: string;
  originalQuery: string;
  // ...现有字段...
  evidencePack?: EvidenceItem[];  // passthrough from CitationOutput
}
```

### GenerationOutput（新增字段）

```typescript
// 四种方法（marketing-ideas / product-persona / selling-points / content-ideas）
// 的输出接口均新增：
evidencePack?: EvidenceItem[];  // passthrough from PromptBuildOutput
```

### EvaluationOutput（新建）

```typescript
export interface EvaluationOutput {
  // ── 算法指标 ─────────────────────────────────────────────
  hitRate: number;           // evidence[score >= threshold].length / totalEvidence
  citationCoverage: number;  // citedEvidenceIds.length / totalEvidence
  confidenceScore: number;   // mean(score of cited evidence); 无引用时为 0
  totalEvidence: number;
  citedCount: number;
  scoreThreshold: number;    // 用于计算 hitRate 的阈值（回显给用户）

  // ── LLM Faithfulness（rag-metrics-only 时为 null）────────
  faithfulness: {
    score: number;              // 0-1，LLM 评估的忠实度
    unsupportedClaims: string[]; // LLM 认为无 evidence 支撑的主张列表
    reason: string;             // 简短文字说明
    model: string;
    inputTokens: number;
    outputTokens: number;
  } | null;

  // ── 综合等级 ─────────────────────────────────────────────
  level: "good" | "warning" | "poor";
  warnings: string[];
  method: string;
  durationMs: number;
}
```

### level 计算规则

```
good: hitRate >= 0.5 AND citationCoverage >= 0.5 AND (faithfulness?.score ?? 1) >= 0.7
poor: citationCoverage === 0 OR warnings.length >= 2
warning: 其他情况
```

### warnings 触发规则

| 条件 | 警告文案 |
|------|---------|
| `evidencePack` 为空或 undefined | "未检测到 evidence pack，请确认 citation stage 已运行且 prompt-build/generation 透传了 evidencePack" |
| `hitRate < 0.3` | "检索命中率偏低，大部分 evidence 相关度未达阈值，建议调整 retrieval top-k 或 score threshold" |
| `citationCoverage === 0` | "生成内容未引用任何 evidence，evidence-first 原则被违反，请检查 generation prompt" |
| `citationCoverage < 0.3` | "引用覆盖率偏低（< 30%），生成内容可能存在幻觉风险" |
| `confidenceScore < 0.4` | "被引用 evidence 平均分偏低，检索质量可能不足" |
| `faithfulness.score < 0.6`（仅 LLM 方法） | "LLM Faithfulness 评分偏低，生成内容与 evidence 存在较多不一致" |

## API 设计

### `POST /api/pipeline/evaluation`

**Request Body：**
```typescript
{
  methodId: "rag-metrics-only" | "rag-metrics-with-faithfulness";
  params: {
    scoreThreshold?: number;   // 默认 0.5
    // rag-metrics-with-faithfulness 专用
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  };
  upstreamOutput: GenerationOutput | null;
}
```

**Response（成功）：**
```typescript
{
  output: EvaluationOutput;
  trace: {
    methodId: string;
    totalEvidence: number;
    citedCount: number;
    hitRate: number;
    citationCoverage: number;
    confidenceScore: number;
    faithfulnessScore: number | null;
    durationMs: number;
  };
  durationMs: number;
  warnings: string[];
}
```

**Error codes：**
- `missing_upstream`：upstreamOutput 为 null
- `missing_api_key`：rag-metrics-with-faithfulness 但未配置 LLM key
- `llm_failed`：LLM judge 调用失败
- `invalid_json`：请求体非法

### LLM Faithfulness Prompt

**System Prompt：**
```
你是一个专业的 RAG 系统质量评估员。
你的任务是评估生成内容与 evidence 的忠实度（Faithfulness）。

规则：
1. 逐条检查生成内容中的事实性主张是否能在提供的 evidence 中找到依据
2. faithfulnessScore: 0-1 浮点数（1=完全有依据，0=完全无依据）
3. unsupportedClaims: 列出无 evidence 支撑的具体主张（简洁，每条 ≤ 30 字）
4. reason: 一句话总结评估结论

输出严格 JSON，字段如下：
{
  "faithfulnessScore": 0.85,
  "unsupportedClaims": ["主张1", "主张2"],
  "reason": "生成内容整体忠实度较高，大部分主张有 evidence 支撑"
}
```

**User Prompt 组装：**
```
用户问题：{originalQuery}

Evidence（共 N 条）：
[1] {evidenceItem.text} (score: 0.82)
[2] ...

生成内容：
{generatedContent 或 JSON.stringify(output)}

请评估生成内容的忠实度。
```

注意：`generatedContent` 优先使用 `GenerationOutput.generatedContent`（marketing-ideas）；
结构化方法（product-persona/selling-points/content-ideas）则使用 `JSON.stringify(output)` 简化版（仅 summary + 各列表项的 title/description，不含 token 统计字段）。

## EvaluationOutputPanel 布局

```
┌─ RAG Quality Evaluation ────────────────── ● good ─┐
│  method: rag-metrics-with-faithfulness  245ms       │
│                                                      │
│  [检索命中率]    [引用覆盖率]    [置信度]            │
│   ████░░ 72%    ████░ 60%     ████░ 55%            │
│   3/4 hits      3/5 cited     avg 0.55             │
│                                                      │
│  ─── Faithfulness (LLM Judge) ─────────── 0.85 ─   │
│  "生成内容整体忠实度较高，[1][2] 均有 evidence..."  │
│  ▸ 无支撑主张（1条）                                │
│    · "市场份额超过80%" 未在 evidence 中出现          │
│                                                      │
│  ─── Warnings ──────────────────────────────────   │
│  ⚠ 引用覆盖率偏低（< 30%），可能存在幻觉风险         │
└──────────────────────────────────────────────────────┘
```

**颜色编码：**
- `good`：绿色 badge + 进度条
- `warning`：黄色
- `poor`：红色

**仅 `rag-metrics-only` 时**：Faithfulness 区块不显示（整块隐藏）。

## stageRegistry 配置

```typescript
// rag-metrics-only
{
  stageId: "evaluation",
  methodId: "rag-metrics-only",
  params: [
    { key: "scoreThreshold", label: "命中率阈值", type: "number",
      default: 0.5, min: 0, max: 1, step: 0.05,
      description: "evidence score 超过此值才计为命中" }
  ]
}

// rag-metrics-with-faithfulness
{
  stageId: "evaluation",
  methodId: "rag-metrics-with-faithfulness",
  params: [
    { key: "scoreThreshold", label: "命中率阈值", type: "number",
      default: 0.5, min: 0, max: 1, step: 0.05 },
    { key: "model", label: "模型", type: "string", default: "" },
    { key: "apiKey", label: "API Key", type: "password", default: "" },
    { key: "baseUrl", label: "Base URL", type: "string", default: "" }
  ]
}
```

## pipelineStages.ts 新增

```typescript
{
  id: "evaluation",
  name: "RAG 质量评估",
  group: "generation",
  module: "生成后",
  category: "optional",
  defaultEnabled: true,
  featureId: "feat-006",
}
```

位置：排在 `output-validation` 之后（pipeline 末尾）。

## 错误降级

| 场景 | 行为 |
|------|------|
| evidencePack 为 undefined | hitRate/confidenceScore 标记为 null，warnings 提示，不报错 |
| citedEvidenceIds 为空 | citationCoverage = 0，confidenceScore = 0，触发 warning |
| LLM judge 失败（rag-metrics-with-faithfulness） | faithfulness = null，warnings 加"LLM judge 调用失败"，其余算法指标正常返回 |
| totalEvidence = 0 | 所有指标为 0，level = "poor"，warnings 提示 |

## 验证步骤

1. `./init.sh` 全部通过
2. `cd app && npm run typecheck` — 0 错误
3. `cd app && npm run lint` — 0 错误
4. 浏览器验证：
   - 跑完 citation → prompt-build → generation → evaluation（rag-metrics-only）
   - 检查三个指标有数值，warnings 正确触发
   - 切换到 rag-metrics-with-faithfulness，配置 LLM key，运行，检查 faithfulness 区块出现
   - 未运行 citation 时跑 evaluation，检查 warning 正确提示 evidencePack 缺失
