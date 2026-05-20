# feat-006 RAG Quality Evaluation 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 generation stage 之后新增一个可选的"RAG 质量评估" stage，提供算法指标（hit rate / citation coverage / confidence score）和可选的 LLM Faithfulness judge，结果在专属 EvaluationOutputPanel 中以卡片形式展示。

**架构：** 通过 evidencePack passthrough（citation → prompt-build → generation → evaluation）将 evidence 分数传至末尾，evaluation API route 纯算法计算三个指标，可选触发 LLM Faithfulness 评分。新增一个 React 专属面板展示结果，与 GenerationOutputPanel 保持同级架构。

**技术栈：** Next.js 15 App Router、TypeScript、Tailwind CSS v4、OpenAI-compatible LLM API（与 generation stage 相同）

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/app/api/pipeline/prompt-build/route.ts` | 修改 | PromptBuildOutput 加 `evidencePack?: EvidenceItem[]` passthrough |
| `app/app/api/pipeline/generation/route.ts` | 修改 | 四种方法的输出接口加 `evidencePack?: EvidenceItem[]` passthrough |
| `app/lib/pipelineStages.ts` | 修改 | 新增 evaluation stage 定义（排在 output-validation 之后） |
| `app/lib/stageRegistry.ts` | 修改 | 注册 evaluation 的两种方法及其 params |
| `app/app/api/pipeline/evaluation/route.ts` | 新建 | evaluation API 路由（算法计算 + 可选 LLM judge） |
| `app/components/playground/EvaluationOutputPanel.tsx` | 新建 | 专属展示面板（三指标卡片 + faithfulness + warnings） |
| `app/components/playground/PlaygroundShell.tsx` | 修改 | evaluation stage 时渲染 EvaluationOutputPanel |

---

## 任务 1：evidencePack passthrough — prompt-build

**文件：** 修改 `app/app/api/pipeline/prompt-build/route.ts`

此任务在 PromptBuildOutput 中加入 `evidencePack` 字段，从 CitationOutput 透传，不修改任何现有逻辑。

- [ ] **步骤 1：修改 PromptBuildOutput 接口，加入 evidencePack 字段**

找到文件中 `export interface PromptBuildOutput {` 部分，在 `warnings: string[];` 之后加一行：

```typescript
// 在 app/app/api/pipeline/prompt-build/route.ts
export interface PromptBuildOutput {
  systemPrompt: string;
  userPrompt: string;
  fullPrompt: string;
  tokenEstimate: number;
  originalQuery: string;
  warnings: string[];
  /** passthrough from CitationOutput，供 generation → evaluation 使用 */
  evidencePack?: import("../citation/route").EvidenceItem[];
}
```

- [ ] **步骤 2：在 buildRAGTemplate 函数的返回值中加入 evidencePack**

函数签名改为接受 `evidencePack` 参数：

```typescript
function buildRAGTemplate(
  contextText: string,
  query: string,
  systemPrompt: string,
  maxContextTokens: number,
  includeSourceRefs: boolean,
  evidencePack?: import("../citation/route").EvidenceItem[]
): PromptBuildOutput {
  // ...（现有逻辑不变）...
  return { systemPrompt: finalSystem, userPrompt, fullPrompt, tokenEstimate, originalQuery: query, warnings, evidencePack };
}
```

- [ ] **步骤 3：在 buildMarketingTemplate 函数中做同样处理**

```typescript
function buildMarketingTemplate(
  contextText: string,
  query: string,
  targetAudience: string,
  tone: string,
  maxContextTokens: number,
  evidencePack?: import("../citation/route").EvidenceItem[]
): PromptBuildOutput {
  // ...（现有逻辑不变）...
  return { systemPrompt, userPrompt, fullPrompt, tokenEstimate, originalQuery: query, warnings, evidencePack };
}
```

- [ ] **步骤 4：在 Route Handler 中将 upstreamOutput.evidencePack 传入两个构建函数**

找到 `switch (methodId)` 块，在调用 `buildRAGTemplate` 时追加 `upstreamOutput.evidencePack`：

```typescript
case "rag-template":
  result = buildRAGTemplate(
    contextText, query,
    String(params.systemPrompt ?? ""),
    maxContextTokens,
    Boolean(params.includeSourceRefs ?? true),
    upstreamOutput.evidencePack  // 新增
  );
  break;
case "marketing-template":
  result = buildMarketingTemplate(
    contextText, query,
    String(params.targetAudience ?? ""),
    String(params.tone ?? "professional"),
    maxContextTokens,
    upstreamOutput.evidencePack  // 新增
  );
  break;
```

注意：`upstreamOutput` 的类型是 `CitationOutput`，需确认 `CitationOutput` 有 `evidencePack: EvidenceItem[]` 字段（已有，见 citation/route.ts:50-57）。

- [ ] **步骤 5：typecheck 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck 2>&1 | head -30
```

预期：0 errors

- [ ] **步骤 6：commit**

```bash
git add app/app/api/pipeline/prompt-build/route.ts
git commit -m "feat: pass evidencePack through prompt-build output"
```

---

## 任务 2：evidencePack passthrough — generation

**文件：** 修改 `app/app/api/pipeline/generation/route.ts`

此任务在四种方法的输出接口和返回值中加入 `evidencePack` passthrough。

- [ ] **步骤 1：给 GenerationOutput 加 evidencePack 字段**

```typescript
export interface GenerationOutput {
  generatedContent: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: import("../citation/route").EvidenceItem[];  // 新增
}
```

- [ ] **步骤 2：给 ProductPersonaOutput 加 evidencePack 字段**

```typescript
export interface ProductPersonaOutput {
  targetSegment: string;
  painPoints: string[];
  coreNeeds: string[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: import("../citation/route").EvidenceItem[];  // 新增
}
```

- [ ] **步骤 3：给 SellingPointsOutput 和 ContentIdeasOutput 加 evidencePack 字段**

```typescript
export interface SellingPointsOutput {
  sellingPoints: SellingPoint[];
  differentiators: string[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: import("../citation/route").EvidenceItem[];  // 新增
}

export interface ContentIdeasOutput {
  ideas: ContentIdea[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
  evidencePack?: import("../citation/route").EvidenceItem[];  // 新增
}
```

- [ ] **步骤 4：在 marketing-ideas 分支的返回值中加入 evidencePack**

找到 `if (methodId === "marketing-ideas")` 块：

```typescript
const output: GenerationOutput = {
  generatedContent, citedEvidenceIds, model: resolvedModel,
  inputTokens: completion.usage?.prompt_tokens ?? 0,
  outputTokens: completion.usage?.completion_tokens ?? 0,
  warnings,
  evidencePack: upstreamOutput.evidencePack,  // 新增
};
```

- [ ] **步骤 5：在三种结构化方法 handler 的返回值中加入 evidencePack**

`handleProductPersona`、`handleSellingPoints`、`handleContentIdeas` 目前签名为接收 `params`，不接收 `evidencePack`。最简做法：在 Route Handler 里，在调用三种 handler 之后，补充 `evidencePack` 字段：

```typescript
// 在 Route Handler 中（三种结构化方法的 return 之前）
if (methodId === "product-persona") {
  output = await handleProductPersona(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
} else if (methodId === "selling-points") {
  output = await handleSellingPoints(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
} else {
  output = await handleContentIdeas(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
}
// passthrough evidencePack
output = { ...output, evidencePack: upstreamOutput.evidencePack };
```

- [ ] **步骤 6：typecheck 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck 2>&1 | head -30
```

预期：0 errors

- [ ] **步骤 7：smoke test（可选，需 dev server 运行）**

```bash
curl -s -X POST http://localhost:3000/api/pipeline/generation \
  -H "Content-Type: application/json" \
  -d '{
    "methodId": "marketing-ideas",
    "params": {},
    "upstreamOutput": {
      "systemPrompt": "test",
      "userPrompt": "test",
      "fullPrompt": "test",
      "tokenEstimate": 10,
      "originalQuery": "test",
      "warnings": [],
      "evidencePack": [{"evidenceId":"e1","text":"t","sourceRef":"","documentId":"d","version":1,"chunkIndex":0,"pageNumber":null,"score":0.8}]
    }
  }' | python3 -m json.tool | grep evidencePack
```

预期：output 中含 `"evidencePack": [...]`

- [ ] **步骤 8：commit**

```bash
git add app/app/api/pipeline/generation/route.ts
git commit -m "feat: pass evidencePack through generation output"
```

---

## 任务 3：Pipeline stage 注册 + stageRegistry

**文件：**
- 修改 `app/lib/pipelineStages.ts`
- 修改 `app/lib/stageRegistry.ts`

- [ ] **步骤 1：在 pipelineStages.ts 的 GENERATION_STAGES 中加入 evaluation**

找到 `output-validation` 条目之后，在数组末尾（`];` 之前）插入：

```typescript
// 在 app/lib/pipelineStages.ts，GENERATION_STAGES 数组末尾，output-validation 之后
{
  id: "evaluation",
  name: "RAG 质量评估",
  group: "generation",
  module: "生成后",
  category: "optional",
  defaultEnabled: true,
  featureId: "feat-006",
},
```

- [ ] **步骤 2：在 stageRegistry.ts 中注册 evaluation 的两种方法**

在 `output-validation` 条目之后，`];` 之前插入：

```typescript
{
  id: "evaluation",
  methods: [
    {
      id: "rag-metrics-only",
      label: "算法指标（无 LLM）",
      params: [
        {
          key: "scoreThreshold",
          label: "命中率阈值",
          type: "number",
          default: 0.5,
          min: 0,
          max: 1,
          step: 0.05,
          hint: "evidence score 超过此值才计为命中；dense-vector 结果通常在 0.3-0.9，RRF 结果通常在 0.01-0.03",
        },
      ],
    },
    {
      id: "rag-metrics-with-faithfulness",
      label: "算法指标 + LLM Faithfulness",
      params: [
        {
          key: "scoreThreshold",
          label: "命中率阈值",
          type: "number",
          default: 0.5,
          min: 0,
          max: 1,
          step: 0.05,
          hint: "同上",
        },
        {
          key: "model",
          label: "模型",
          type: "text",
          default: "",
          placeholder: "留空则读取 LLM_MODEL 环境变量",
        },
        {
          key: "apiKey",
          label: "API Key（可选）",
          type: "password",
          default: "",
          placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量",
        },
        {
          key: "baseUrl",
          label: "API Base URL（可选）",
          type: "text",
          default: "",
          placeholder: "留空则读取 LLM_BASE_URL",
        },
      ],
    },
  ],
},
```

- [ ] **步骤 3：typecheck 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck 2>&1 | head -30
```

预期：0 errors

- [ ] **步骤 4：commit**

```bash
git add app/lib/pipelineStages.ts app/lib/stageRegistry.ts
git commit -m "feat: register evaluation stage in pipeline and stageRegistry"
```

---

## 任务 4：Evaluation API Route

**文件：** 新建 `app/app/api/pipeline/evaluation/route.ts`

此文件实现算法指标计算和可选的 LLM Faithfulness judge。

- [ ] **步骤 1：新建文件，定义类型**

```typescript
/**
 * RAG Pipeline Stage — Evaluation（质量评估）
 *
 * 作用：基于 generation 输出（citedEvidenceIds）和 evidencePack（来自 citation，
 *       经 prompt-build → generation 透传），算法计算三个 RAG 质量指标，
 *       并可选地调用 LLM 评估 Faithfulness（生成内容与 evidence 的忠实度）。
 *
 * 两种方法：
 *   rag-metrics-only              纯算法，无 LLM 调用
 *   rag-metrics-with-faithfulness 算法 + LLM Faithfulness judge（JSON mode）
 *
 * 指标定义：
 *   hitRate          = evidence[score >= scoreThreshold].length / totalEvidence
 *   citationCoverage = citedEvidenceIds.length / totalEvidence
 *   confidenceScore  = mean(score of cited evidence items)
 *   faithfulness     = LLM 评估 0-1 分（忠实度）
 */

import { NextRequest, NextResponse } from "next/server";
import { createLLMClient } from "@/lib/providers";
import type { EvidenceItem } from "../citation/route";

// GenerationOutput 的最小结构（只取 evaluation 需要的字段）
interface GenerationUpstream {
  citedEvidenceIds?: string[];
  evidencePack?: EvidenceItem[];
  originalQuery?: string;
  // marketing-ideas 的原始文本
  generatedContent?: string;
  // 结构化方法的输出（product-persona / selling-points / content-ideas）
  targetSegment?: string;
  painPoints?: string[];
  coreNeeds?: string[];
  summary?: string;
  sellingPoints?: Array<{ title: string; description: string }>;
  differentiators?: string[];
  ideas?: Array<{ title: string; angle: string; format: string }>;
}

export interface FaithfulnessResult {
  score: number;
  unsupportedClaims: string[];
  reason: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EvaluationOutput {
  // 算法指标
  hitRate: number;
  citationCoverage: number;
  confidenceScore: number;
  totalEvidence: number;
  citedCount: number;
  scoreThreshold: number;
  // LLM Faithfulness（rag-metrics-only 时为 null）
  faithfulness: FaithfulnessResult | null;
  // 综合等级
  level: "good" | "warning" | "poor";
  warnings: string[];
  method: string;
  durationMs: number;
}
```

- [ ] **步骤 2：实现算法指标计算函数**

```typescript
function computeAlgorithmicMetrics(
  evidencePack: EvidenceItem[],
  citedEvidenceIds: string[],
  scoreThreshold: number
): Pick<EvaluationOutput, "hitRate" | "citationCoverage" | "confidenceScore" | "totalEvidence" | "citedCount"> {
  const totalEvidence = evidencePack.length;

  if (totalEvidence === 0) {
    return { hitRate: 0, citationCoverage: 0, confidenceScore: 0, totalEvidence: 0, citedCount: 0 };
  }

  // hitRate：高分 evidence 比例
  const hitCount = evidencePack.filter((e) => e.score >= scoreThreshold).length;
  const hitRate = hitCount / totalEvidence;

  // citationCoverage：实际被引用的 evidence 比例
  const citedSet = new Set(citedEvidenceIds);
  const citedCount = citedEvidenceIds.length;
  const citationCoverage = citedCount / totalEvidence;

  // confidenceScore：被引用 evidence 的平均 score
  const citedEvidence = evidencePack.filter((e) => citedSet.has(e.evidenceId));
  const confidenceScore = citedEvidence.length > 0
    ? citedEvidence.reduce((sum, e) => sum + e.score, 0) / citedEvidence.length
    : 0;

  return { hitRate, citationCoverage, confidenceScore, totalEvidence, citedCount };
}
```

- [ ] **步骤 3：实现 warnings 生成函数**

```typescript
function generateWarnings(
  metrics: Pick<EvaluationOutput, "hitRate" | "citationCoverage" | "confidenceScore" | "totalEvidence">,
  evidencePackMissing: boolean,
  faithfulnessScore: number | null
): string[] {
  const warnings: string[] = [];

  if (evidencePackMissing) {
    warnings.push("未检测到 evidence pack，请确认 citation stage 已运行且 prompt-build / generation 已完成 evidencePack 透传");
    return warnings; // 其他指标无意义，提前返回
  }

  if (metrics.totalEvidence === 0) {
    warnings.push("evidence pack 为空（totalEvidence = 0），无法计算指标");
    return warnings;
  }

  if (metrics.hitRate < 0.3) {
    warnings.push(`检索命中率偏低（${(metrics.hitRate * 100).toFixed(0)}%），大部分 evidence 相关度未达阈值，建议调整 retrieval top-k 或 score threshold`);
  }

  if (metrics.citationCoverage === 0) {
    warnings.push("生成内容未引用任何 evidence，evidence-first 原则被违反，请检查 generation prompt");
  } else if (metrics.citationCoverage < 0.3) {
    warnings.push(`引用覆盖率偏低（${(metrics.citationCoverage * 100).toFixed(0)}%），生成内容可能存在幻觉风险`);
  }

  if (metrics.confidenceScore > 0 && metrics.confidenceScore < 0.4) {
    warnings.push(`被引用 evidence 平均分偏低（${metrics.confidenceScore.toFixed(2)}），检索质量可能不足`);
  }

  if (faithfulnessScore !== null && faithfulnessScore < 0.6) {
    warnings.push(`LLM Faithfulness 评分偏低（${faithfulnessScore.toFixed(2)}），生成内容与 evidence 存在较多不一致`);
  }

  return warnings;
}
```

- [ ] **步骤 4：实现 level 计算函数**

```typescript
function computeLevel(
  metrics: Pick<EvaluationOutput, "hitRate" | "citationCoverage">,
  faithfulnessScore: number | null,
  warnings: string[]
): "good" | "warning" | "poor" {
  if (metrics.citationCoverage === 0 || warnings.length >= 2) return "poor";
  const faithOk = faithfulnessScore === null || faithfulnessScore >= 0.7;
  if (metrics.hitRate >= 0.5 && metrics.citationCoverage >= 0.5 && faithOk) return "good";
  return "warning";
}
```

- [ ] **步骤 5：实现 LLM Faithfulness judge**

```typescript
const FAITHFULNESS_SYSTEM = `你是一个专业的 RAG 系统质量评估员。
你的任务是评估生成内容与 evidence 的忠实度（Faithfulness）。

规则：
1. 逐条检查生成内容中的事实性主张是否能在提供的 evidence 中找到依据
2. faithfulnessScore: 0-1 浮点数（1=完全有依据，0=完全无依据）
3. unsupportedClaims: 列出无 evidence 支撑的具体主张（简洁，每条 ≤ 30 字）
4. reason: 一句话总结评估结论

输出严格 JSON：
{
  "faithfulnessScore": 0.85,
  "unsupportedClaims": ["主张1"],
  "reason": "生成内容整体忠实度较高"
}`;

function buildGeneratedText(upstream: GenerationUpstream): string {
  if (upstream.generatedContent) return upstream.generatedContent;
  // 结构化方法：拼接 summary + 关键字段
  const parts: string[] = [];
  if (upstream.targetSegment) parts.push(`目标人群：${upstream.targetSegment}`);
  if (upstream.painPoints?.length) parts.push(`痛点：${upstream.painPoints.join("；")}`);
  if (upstream.coreNeeds?.length) parts.push(`核心需求：${upstream.coreNeeds.join("；")}`);
  if (upstream.sellingPoints?.length) {
    parts.push(...upstream.sellingPoints.map((sp) => `卖点：${sp.title} — ${sp.description}`));
  }
  if (upstream.differentiators?.length) parts.push(`差异化：${upstream.differentiators.join("；")}`);
  if (upstream.ideas?.length) {
    parts.push(...upstream.ideas.map((i) => `Idea：${i.title}（${i.angle}，${i.format}）`));
  }
  if (upstream.summary) parts.push(`总结：${upstream.summary}`);
  return parts.join("\n") || "（无生成内容）";
}

async function runFaithfulnessJudge(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  originalQuery: string,
  evidencePack: EvidenceItem[],
  upstream: GenerationUpstream
): Promise<FaithfulnessResult> {
  const evidenceText = evidencePack
    .map((e, i) => `[${i + 1}] ${e.text.slice(0, 300)} (score: ${e.score.toFixed(2)})`)
    .join("\n");
  const generatedText = buildGeneratedText(upstream);

  const userPrompt = `用户问题：${originalQuery || "（未知）"}

Evidence（共 ${evidencePack.length} 条）：
${evidenceText}

生成内容：
${generatedText}

请评估生成内容的忠实度。`;

  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: FAITHFULNESS_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { faithfulnessScore?: number; unsupportedClaims?: string[]; reason?: string } = {};
  try { parsed = JSON.parse(raw); } catch { /* fall through */ }

  return {
    score: typeof parsed.faithfulnessScore === "number" ? Math.max(0, Math.min(1, parsed.faithfulnessScore)) : 0,
    unsupportedClaims: Array.isArray(parsed.unsupportedClaims) ? parsed.unsupportedClaims : [],
    reason: parsed.reason ?? "LLM 未返回说明",
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}
```

- [ ] **步骤 6：实现 Route Handler**

```typescript
const ALLOWED_METHODS = ["rag-metrics-only", "rag-metrics-with-faithfulness"];

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: GenerationUpstream | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Generation 产物，请先运行 Generation Stage" } },
      { status: 400 }
    );
  }

  if (!ALLOWED_METHODS.includes(methodId)) {
    return NextResponse.json(
      { error: { code: "unknown_method", message: `未知方法: ${methodId}` } },
      { status: 400 }
    );
  }

  const scoreThreshold = Math.max(0, Math.min(1, Number(params.scoreThreshold ?? 0.5)));
  const evidencePack = upstreamOutput.evidencePack ?? [];
  const evidencePackMissing = !upstreamOutput.evidencePack;
  const citedEvidenceIds = upstreamOutput.citedEvidenceIds ?? [];
  const originalQuery = upstreamOutput.originalQuery ?? "";

  // 算法指标
  const algorithmicMetrics = computeAlgorithmicMetrics(evidencePack, citedEvidenceIds, scoreThreshold);

  // LLM Faithfulness（可选）
  let faithfulness: FaithfulnessResult | null = null;
  const faithfulnessWarnings: string[] = [];

  if (methodId === "rag-metrics-with-faithfulness") {
    let llmConfig: Awaited<ReturnType<typeof createLLMClient>>;
    try {
      llmConfig = await createLLMClient(
        String(params.apiKey || ""),
        String(params.baseUrl || "")
      );
    } catch (err) {
      return NextResponse.json(
        { error: { code: "missing_api_key", message: err instanceof Error ? err.message : String(err) } },
        { status: 400 }
      );
    }

    const resolvedModel = String(params.model || "").trim() || llmConfig.defaultModel;

    try {
      faithfulness = await runFaithfulnessJudge(
        llmConfig, resolvedModel, originalQuery, evidencePack, upstreamOutput
      );
    } catch (err) {
      faithfulnessWarnings.push(`LLM Faithfulness judge 调用失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const warnings = [
    ...generateWarnings(algorithmicMetrics, evidencePackMissing, faithfulness?.score ?? null),
    ...faithfulnessWarnings,
  ];

  const level = computeLevel(algorithmicMetrics, faithfulness?.score ?? null, warnings);

  const output: EvaluationOutput = {
    ...algorithmicMetrics,
    scoreThreshold,
    faithfulness,
    level,
    warnings,
    method: methodId,
    durationMs: Date.now() - startMs,
  };

  return NextResponse.json({
    output,
    trace: {
      methodId,
      totalEvidence: algorithmicMetrics.totalEvidence,
      citedCount: algorithmicMetrics.citedCount,
      hitRate: algorithmicMetrics.hitRate,
      citationCoverage: algorithmicMetrics.citationCoverage,
      confidenceScore: algorithmicMetrics.confidenceScore,
      faithfulnessScore: faithfulness?.score ?? null,
      durationMs: Date.now() - startMs,
    },
    durationMs: Date.now() - startMs,
    warnings,
  });
}
```

- [ ] **步骤 7：smoke test（rag-metrics-only）**

```bash
curl -s -X POST http://localhost:3000/api/pipeline/evaluation \
  -H "Content-Type: application/json" \
  -d '{
    "methodId": "rag-metrics-only",
    "params": { "scoreThreshold": 0.5 },
    "upstreamOutput": {
      "citedEvidenceIds": ["doc1_v1_c0", "doc1_v1_c1"],
      "evidencePack": [
        {"evidenceId":"doc1_v1_c0","text":"t","sourceRef":"","documentId":"doc1","version":1,"chunkIndex":0,"pageNumber":null,"score":0.8},
        {"evidenceId":"doc1_v1_c1","text":"t","sourceRef":"","documentId":"doc1","version":1,"chunkIndex":1,"pageNumber":null,"score":0.6},
        {"evidenceId":"doc1_v1_c2","text":"t","sourceRef":"","documentId":"doc1","version":1,"chunkIndex":2,"pageNumber":null,"score":0.3}
      ],
      "originalQuery": "测试"
    }
  }' | python3 -m json.tool
```

预期 output：
```json
{
  "hitRate": 0.6667,   // 2/3 score >= 0.5
  "citationCoverage": 0.6667,  // 2/3 cited
  "confidenceScore": 0.7,  // mean(0.8, 0.6)
  "totalEvidence": 3,
  "citedCount": 2,
  "level": "good",
  "warnings": []
}
```

- [ ] **步骤 8：typecheck 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck 2>&1 | head -30
```

预期：0 errors

- [ ] **步骤 9：commit**

```bash
git add app/app/api/pipeline/evaluation/route.ts
git commit -m "feat: add evaluation API route with algorithmic metrics and LLM faithfulness"
```

---

## 任务 5：EvaluationOutputPanel 组件

**文件：** 新建 `app/components/playground/EvaluationOutputPanel.tsx`

- [ ] **步骤 1：新建文件，定义 props 和工具函数**

```typescript
"use client";

import type { StepRun } from "@/lib/types";
import type { EvaluationOutput } from "@/app/api/pipeline/evaluation/route";

interface EvaluationOutputPanelProps {
  runs: StepRun[];
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function levelColor(level: "good" | "warning" | "poor"): string {
  return level === "good" ? "text-green-600" : level === "warning" ? "text-yellow-600" : "text-red-600";
}

function levelBg(level: "good" | "warning" | "poor"): string {
  return level === "good" ? "bg-green-50 border-green-200" : level === "warning" ? "bg-yellow-50 border-yellow-200" : "bg-red-50 border-red-200";
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
      <div
        className={`h-2 rounded-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value * 100)).toFixed(0)}%` }}
      />
    </div>
  );
}
```

- [ ] **步骤 2：实现 MetricCard 子组件**

```typescript
function MetricCard({
  label,
  value,
  detail,
  barColor,
}: {
  label: string;
  value: number;
  detail: string;
  barColor: string;
}) {
  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-800">{formatPct(value)}</div>
      <ProgressBar value={value} color={barColor} />
      <div className="text-xs text-gray-400 mt-1">{detail}</div>
    </div>
  );
}
```

- [ ] **步骤 3：实现 FaithfulnessSection 子组件**

```typescript
function FaithfulnessSection({ f }: { f: EvaluationOutput["faithfulness"] }) {
  if (!f) return null;
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">Faithfulness (LLM Judge)</span>
        <span className={`text-lg font-bold ${f.score >= 0.7 ? "text-green-600" : f.score >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
          {f.score.toFixed(2)}
        </span>
      </div>
      <p className="text-xs text-gray-600 mb-2">{f.reason}</p>
      {f.unsupportedClaims.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-yellow-700 font-medium">
            ▸ 无支撑主张（{f.unsupportedClaims.length} 条）
          </summary>
          <ul className="mt-1 pl-3 space-y-1">
            {f.unsupportedClaims.map((c, i) => (
              <li key={i} className="text-gray-600">· {c}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="text-xs text-gray-400 mt-1">model: {f.model} | {f.inputTokens}+{f.outputTokens} tokens</div>
    </div>
  );
}
```

- [ ] **步骤 4：实现主组件 EvaluationOutputPanel**

```typescript
export default function EvaluationOutputPanel({ runs }: EvaluationOutputPanelProps) {
  const latestRun = runs[runs.length - 1];

  if (!latestRun) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        运行 RAG 质量评估 Stage 后在此显示结果
      </div>
    );
  }

  if (latestRun.status === "running") {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm animate-pulse">
        评估中…
      </div>
    );
  }

  if (latestRun.status === "error") {
    return (
      <div className="flex-1 p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {String((latestRun.output as { error?: { message?: string } })?.error?.message ?? "运行失败")}
        </div>
      </div>
    );
  }

  const output = latestRun.output as EvaluationOutput;
  if (!output) return null;

  const barColor = output.level === "good" ? "bg-green-500" : output.level === "warning" ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${levelBg(output.level)}`}>
        <span className="text-sm font-medium text-gray-700">RAG Quality Evaluation</span>
        <span className={`text-sm font-bold ${levelColor(output.level)}`}>
          ● {output.level === "good" ? "良好" : output.level === "warning" ? "警告" : "较差"}
        </span>
      </div>
      <div className="text-xs text-gray-400">
        method: {output.method} | {output.durationMs}ms
      </div>

      {/* 三指标卡片 */}
      <div className="flex gap-2">
        <MetricCard
          label="检索命中率"
          value={output.hitRate}
          detail={`score ≥ ${output.scoreThreshold}`}
          barColor={barColor}
        />
        <MetricCard
          label="引用覆盖率"
          value={output.citationCoverage}
          detail={`${output.citedCount}/${output.totalEvidence} cited`}
          barColor={barColor}
        />
        <MetricCard
          label="置信度"
          value={output.confidenceScore}
          detail="cited evidence 平均分"
          barColor={barColor}
        />
      </div>

      {/* Faithfulness */}
      <FaithfulnessSection f={output.faithfulness} />

      {/* Warnings */}
      {output.warnings.length > 0 && (
        <div className="space-y-1">
          {output.warnings.map((w, i) => (
            <div key={i} className="flex gap-1.5 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1.5">
              <span>⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 5：typecheck 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck 2>&1 | head -30
```

预期：0 errors

- [ ] **步骤 6：commit**

```bash
git add app/components/playground/EvaluationOutputPanel.tsx
git commit -m "feat: add EvaluationOutputPanel with metric cards and faithfulness section"
```

---

## 任务 6：PlaygroundShell 集成

**文件：** 修改 `app/components/playground/PlaygroundShell.tsx`

此任务在 PlaygroundShell 中为 `evaluation` stage 渲染 EvaluationOutputPanel，复用与 `generation` stage 完全一致的模式。

- [ ] **步骤 1：在文件顶部 import EvaluationOutputPanel**

在 `import GenerationOutputPanel from "./GenerationOutputPanel";` 之后加一行：

```typescript
import EvaluationOutputPanel from "./EvaluationOutputPanel";
```

- [ ] **步骤 2：在右侧面板渲染区域加入 evaluation 分支**

找到现有的条件渲染逻辑（位于 PlaygroundShell return 的中列/右列区域）：

```typescript
{activeStage.id === "generation" ? (
  <GenerationOutputPanel runs={stepRuns["generation"] ?? []} />
) : (
  <OutputTracePanel stage={activeStage} runs={stepRuns[activeStage.id] ?? []} />
)}
```

改为：

```typescript
{activeStage.id === "generation" ? (
  <GenerationOutputPanel runs={stepRuns["generation"] ?? []} />
) : activeStage.id === "evaluation" ? (
  <EvaluationOutputPanel runs={stepRuns["evaluation"] ?? []} />
) : (
  <OutputTracePanel stage={activeStage} runs={stepRuns[activeStage.id] ?? []} />
)}
```

- [ ] **步骤 3：typecheck 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck 2>&1 | head -30
```

预期：0 errors

- [ ] **步骤 4：lint 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run lint 2>&1 | head -30
```

预期：0 errors / warnings

- [ ] **步骤 5：init.sh 验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker && ./init.sh 2>&1 | tail -20
```

预期：全部通过

- [ ] **步骤 6：commit**

```bash
git add app/components/playground/PlaygroundShell.tsx
git commit -m "feat: render EvaluationOutputPanel for evaluation stage"
```

---

## 浏览器端到端验证（所有任务完成后）

1. 启动 dev server：`cd app && npm run dev`
2. 上传文档，依次运行：idempotency → preprocess → chunk → transform → embedding → storage
3. 运行：query-rewrite → retrieval → filter → rerank → citation → prompt-build → generation
4. 切换到"RAG 质量评估" stage（默认 enabled），选择 `rag-metrics-only`，点击 Run
5. 确认右侧出现 EvaluationOutputPanel，三个指标有数值，level 颜色正确
6. 切换方法为 `rag-metrics-with-faithfulness`，填写 API Key，点击 Run
7. 确认 Faithfulness 区块出现，score 有值，unsupportedClaims 列表正常（可为空）
8. 在未运行 citation 的情况下（只运行 generation 但 generation 无 evidencePack 透传时），运行 evaluation，确认 warnings 提示 evidencePack 缺失

---

## 自检

**规格覆盖度：**
- ✅ evidencePack passthrough（任务 1、2）
- ✅ 新增 evaluation stage + registry（任务 3）
- ✅ 算法三指标（任务 4 步骤 2-4）
- ✅ LLM Faithfulness judge（任务 4 步骤 5-6）
- ✅ warnings 规则（任务 4 步骤 3）
- ✅ level 计算（任务 4 步骤 4）
- ✅ EvaluationOutputPanel 三卡片 + faithfulness + warnings（任务 5）
- ✅ PlaygroundShell 集成（任务 6）
- ✅ 错误降级（evidencePack missing → warning not error；faithfulness 失败 → 算法指标仍返回）

**类型一致性：**
- `EvidenceItem` 从 `citation/route.ts` 统一 import，不重复定义
- `EvaluationOutput` 在 `evaluation/route.ts` 定义，`EvaluationOutputPanel` import 同一类型
- `GenerationUpstream` 是松散类型（所有字段可选），兼容四种 generation 方法输出
