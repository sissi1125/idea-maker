# feat-005 Marketing Generation 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在现有 generation stage 基础上新增三种结构化营销内容生成方法（产品画像 / 卖点地图 / 内容 idea），并为其实现专属卡片式展示面板。

**架构：** 在 `generation/route.ts` 添加 3 个 JSON-mode LLM 方法，每种方法返回结构化 JSON + markdown summary。新建 `GenerationOutputPanel.tsx` 替代 `OutputTracePanel` 在 generation stage 激活时渲染，`PlaygroundShell` 根据 `activeStage.id` 条件切换。

**技术栈：** Next.js App Router、OpenAI-compatible JSON mode、React、Tailwind CSS、TypeScript

---

## 文件清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/app/api/pipeline/generation/route.ts` | 修改 | 新增 product-persona / selling-points / content-ideas 三个方法 |
| `app/lib/stageRegistry.ts` | 修改 | 新增三个方法的 params 定义 |
| `app/components/playground/GenerationOutputPanel.tsx` | 新建 | 卡片式展示面板，根据 methodId 渲染不同内容 |
| `app/components/playground/PlaygroundShell.tsx` | 修改 | 条件渲染 GenerationOutputPanel 替代 OutputTracePanel |

---

## 任务 1：generation/route.ts — 新增三个方法

**文件：**
- 修改：`app/app/api/pipeline/generation/route.ts`

- [ ] **步骤 1：新增输出类型定义**

在文件现有 `GenerationOutput` 接口之后追加：

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
}

export interface SellingPoint {
  title: string;
  description: string;
  evidenceIds: string[];
}

export interface SellingPointsOutput {
  sellingPoints: SellingPoint[];
  differentiators: string[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
}

export interface ContentIdea {
  title: string;
  angle: string;
  format: string;
  evidenceIds: string[];
}

export interface ContentIdeasOutput {
  ideas: ContentIdea[];
  summary: string;
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
}
```

- [ ] **步骤 2：新增三个方法处理函数**

在 `extractEvidenceIds` 函数之后、Route Handler 之前追加：

```typescript
// ─── product-persona ──────────────────────────────────────────────────────────

const PRODUCT_PERSONA_SYSTEM = `你是一个专业的产品营销策略师。
基于用户提供的产品资料，生成目标用户画像，输出严格 JSON，字段如下：
{
  "targetSegment": "目标人群描述（1-2句话）",
  "painPoints": ["痛点1", "痛点2", "痛点3"],
  "coreNeeds": ["需求1", "需求2", "需求3"],
  "summary": "markdown格式的整体画像摘要（3-5句）",
  "citedEvidenceIds": ["[1]", "[2]"]
}
规则：所有内容必须基于提供的资料；citedEvidenceIds 填写资料中引用的编号如 [1]、[2]；
若资料不足，painPoints/coreNeeds 可少于3条但不能为空；不要编造资料中没有的内容。`;

async function handleProductPersona(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  systemPrompt: string,
  userPrompt: string,
  params: Record<string, unknown>
): Promise<ProductPersonaOutput> {
  const warnings: string[] = [];
  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: PRODUCT_PERSONA_SYSTEM + "\n\n背景：" + systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<ProductPersonaOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("LLM 输出无法解析为 JSON，请检查模型是否支持 JSON mode");
    parsed = {};
  }

  const targetAudience = String(params.targetAudience || "").trim();
  return {
    targetSegment: parsed.targetSegment ?? (targetAudience || "未能生成"),
    painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
    coreNeeds: Array.isArray(parsed.coreNeeds) ? parsed.coreNeeds : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: Array.isArray(parsed.citedEvidenceIds) ? parsed.citedEvidenceIds : [],
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── selling-points ───────────────────────────────────────────────────────────

const SELLING_POINTS_SYSTEM = `你是一个专业的产品营销策略师。
基于用户提供的产品资料，提炼核心卖点和差异化优势，输出严格 JSON，字段如下：
{
  "sellingPoints": [
    { "title": "卖点标题（5-10字）", "description": "卖点说明（2-3句）", "evidenceIds": ["[1]"] }
  ],
  "differentiators": ["差异化优势1", "差异化优势2"],
  "summary": "markdown格式的卖点总结",
  "citedEvidenceIds": ["[1]", "[2]"]
}
规则：sellingPoints 3-5条；differentiators 2-3条；所有内容基于资料，引用编号如 [1]、[2]；
不要编造资料中没有的内容。`;

async function handleSellingPoints(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  systemPrompt: string,
  userPrompt: string,
  _params: Record<string, unknown>
): Promise<SellingPointsOutput> {
  const warnings: string[] = [];
  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: SELLING_POINTS_SYSTEM + "\n\n背景：" + systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<SellingPointsOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("LLM 输出无法解析为 JSON，请检查模型是否支持 JSON mode");
    parsed = {};
  }

  const allEvidenceIds = Array.isArray(parsed.citedEvidenceIds)
    ? parsed.citedEvidenceIds
    : (parsed.sellingPoints ?? []).flatMap((sp) => sp.evidenceIds ?? []);

  return {
    sellingPoints: Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints : [],
    differentiators: Array.isArray(parsed.differentiators) ? parsed.differentiators : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: [...new Set(allEvidenceIds)],
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}

// ─── content-ideas ────────────────────────────────────────────────────────────

const CONTENT_IDEAS_SYSTEM = `你是一个专业的内容营销策略师。
基于用户提供的产品资料，生成可执行的营销内容创意，输出严格 JSON，字段如下：
{
  "ideas": [
    {
      "title": "内容标题",
      "angle": "切入角度（一句话）",
      "format": "推荐内容形式（如：短视频/图文/文章/海报/直播等）",
      "evidenceIds": ["[1]"]
    }
  ],
  "summary": "markdown格式的创意思路总结",
  "citedEvidenceIds": ["[1]", "[2]"]
}
规则：生成 {ideaCount} 条 idea；所有 idea 必须基于资料中的事实；
每条 idea 的 evidenceIds 标注该创意的资料依据；不要编造。`;

async function handleContentIdeas(
  llmConfig: Awaited<ReturnType<typeof createLLMClient>>,
  resolvedModel: string,
  systemPrompt: string,
  userPrompt: string,
  params: Record<string, unknown>
): Promise<ContentIdeasOutput> {
  const warnings: string[] = [];
  const ideaCount = Number(params.ideaCount ?? 5);
  const systemWithCount = CONTENT_IDEAS_SYSTEM.replace("{ideaCount}", String(ideaCount));

  const completion = await llmConfig.client.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "system", content: systemWithCount + "\n\n背景：" + systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<ContentIdeasOutput>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("LLM 输出无法解析为 JSON，请检查模型是否支持 JSON mode");
    parsed = {};
  }

  const allEvidenceIds = Array.isArray(parsed.citedEvidenceIds)
    ? parsed.citedEvidenceIds
    : (parsed.ideas ?? []).flatMap((idea) => idea.evidenceIds ?? []);

  return {
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
    summary: parsed.summary ?? "",
    citedEvidenceIds: [...new Set(allEvidenceIds)],
    model: resolvedModel,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    warnings,
  };
}
```

- [ ] **步骤 3：在 Route Handler 的 switch/if 中加入三个新方法**

找到 `if (methodId !== "marketing-ideas")` 这个检查，改为处理四种 methodId：

```typescript
  const model = String(params.model || "").trim() || undefined;
  const warnings: string[] = [];

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

  const resolvedModel = model || llmConfig.defaultModel;

  const ALLOWED_METHODS = ["marketing-ideas", "product-persona", "selling-points", "content-ideas"];
  if (!ALLOWED_METHODS.includes(methodId)) {
    return NextResponse.json(
      { error: { code: "unknown_method", message: `未知方法: ${methodId}` } },
      { status: 400 }
    );
  }

  try {
    // marketing-ideas：保留原有自由格式逻辑
    if (methodId === "marketing-ideas") {
      const completion = await llmConfig.client.chat.completions.create({
        model: resolvedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      });
      const generatedContent = completion.choices[0]?.message?.content ?? "";
      if (!generatedContent) warnings.push("LLM 返回了空内容");
      const citedEvidenceIds = extractEvidenceIds(generatedContent);
      if (citedEvidenceIds.length === 0 && Boolean(params.includeEvidence ?? true)) {
        warnings.push("生成内容中未检测到 evidence 引用标注");
      }
      const output: GenerationOutput = {
        generatedContent, citedEvidenceIds, model: resolvedModel,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        warnings,
      };
      return NextResponse.json({
        output,
        trace: { methodId, model: resolvedModel, originalQuery, inputTokens: output.inputTokens, outputTokens: output.outputTokens, citedCount: citedEvidenceIds.length, durationMs: Date.now() - startMs },
        durationMs: Date.now() - startMs,
        warnings,
      });
    }

    // 三种结构化方法
    let output: ProductPersonaOutput | SellingPointsOutput | ContentIdeasOutput;
    if (methodId === "product-persona") {
      output = await handleProductPersona(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
    } else if (methodId === "selling-points") {
      output = await handleSellingPoints(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
    } else {
      output = await handleContentIdeas(llmConfig, resolvedModel, systemPrompt, userPrompt, params);
    }

    return NextResponse.json({
      output,
      trace: {
        methodId, model: resolvedModel, originalQuery,
        inputTokens: output.inputTokens, outputTokens: output.outputTokens,
        citedCount: output.citedEvidenceIds.length,
        durationMs: Date.now() - startMs,
      },
      durationMs: Date.now() - startMs,
      warnings: output.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("401") || message.includes("Incorrect API key") ? "api_auth_failed"
      : message.includes("429") ? "rate_limited"
      : message.includes("model") ? "invalid_model"
      : "llm_failed";
    return NextResponse.json({ error: { code, message } }, { status: 500 });
  }
```

注意：上面的代码要**完整替换**原有的从 `const model = ...` 到文件末尾的全部内容（保留前面的 import、类型定义、extractEvidenceIds 和新增的三个 handler 函数）。

- [ ] **步骤 4：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 5：Commit**

```bash
git add app/app/api/pipeline/generation/route.ts
git commit -m "feat: add product-persona, selling-points, content-ideas methods to generation route"
```

---

## 任务 2：stageRegistry — 新增三个方法定义

**文件：**
- 修改：`app/lib/stageRegistry.ts`

- [ ] **步骤 1：在 generation 的 methods 数组中追加三个方法**

找到 `id: "generation"` 的 methods 数组，在现有 `marketing-ideas` 之后追加：

```typescript
      {
        id: "product-persona",
        label: "产品画像",
        params: [
          { key: "model", label: "模型", type: "text", default: "qwen-plus", placeholder: "qwen-plus / gpt-4o / deepseek-chat" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { key: "targetAudience", label: "目标受众（可选提示）", type: "text", default: "", placeholder: "如：独立开发者、中小企业运营" },
        ],
      },
      {
        id: "selling-points",
        label: "卖点地图",
        params: [
          { key: "model", label: "模型", type: "text", default: "qwen-plus", placeholder: "qwen-plus / gpt-4o / deepseek-chat" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { key: "targetAudience", label: "目标受众（可选提示）", type: "text", default: "", placeholder: "如：独立开发者、中小企业运营" },
        ],
      },
      {
        id: "content-ideas",
        label: "内容 Idea",
        params: [
          { key: "model", label: "模型", type: "text", default: "qwen-plus", placeholder: "qwen-plus / gpt-4o / deepseek-chat" },
          { key: "apiKey", label: "API Key（可选）", type: "password", default: "", placeholder: "留空则读取 LLM_API_KEY / OPENAI_API_KEY 环境变量" },
          { key: "baseUrl", label: "API Base URL（可选）", type: "text", default: "", placeholder: "留空则读取 LLM_BASE_URL，Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { key: "targetAudience", label: "目标受众（可选提示）", type: "text", default: "", placeholder: "如：独立开发者、中小企业运营" },
          { key: "ideaCount", label: "生成 Idea 数量", type: "number", default: 5, min: 1, max: 20 },
        ],
      },
```

- [ ] **步骤 2：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 3：Commit**

```bash
git add app/lib/stageRegistry.ts
git commit -m "feat: add product-persona, selling-points, content-ideas to stageRegistry"
```

---

## 任务 3：GenerationOutputPanel 组件

**文件：**
- 新建：`app/components/playground/GenerationOutputPanel.tsx`

- [ ] **步骤 1：创建完整组件文件**

```typescript
"use client";

import { useState } from "react";
import { StepRun } from "@/lib/types";
import type {
  ProductPersonaOutput,
  SellingPointsOutput,
  ContentIdeasOutput,
} from "@/app/api/pipeline/generation/route";

interface Props {
  runs: StepRun[];
}

export default function GenerationOutputPanel({ runs }: Props) {
  const [selectedRunIdx, setSelectedRunIdx] = useState(0);
  const run = runs[selectedRunIdx];

  return (
    <aside className="w-80 shrink-0 bg-zinc-50 flex flex-col overflow-hidden border-l border-zinc-200">
      {/* 标题栏 + 运行历史选择 */}
      <div className="px-4 py-3 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">营销内容</h3>
        {runs.length > 1 && (
          <select
            value={selectedRunIdx}
            onChange={(e) => setSelectedRunIdx(Number(e.target.value))}
            className="text-[10px] text-zinc-500 bg-transparent border-none outline-none cursor-pointer"
          >
            {runs.map((r, i) => (
              <option key={r.id} value={i}>
                Run #{runs.length - i} {r.status === "success" ? "✓" : r.status === "error" ? "✗" : "…"}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">
        {!run ? (
          <EmptyGenState />
        ) : (
          <>
            <StatusBar run={run} />
            {run.warnings && run.warnings.length > 0 && <WarningsSection warnings={run.warnings} />}
            {run.error && <ErrorSection error={run.error} />}
            {run.output !== undefined && run.status === "success" && (
              <GenOutputSection methodId={run.methodId} output={run.output} />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// ─── 空状态 ───────────────────────────────────────────────────────────────────

function EmptyGenState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-16 px-4">
      <div className="w-8 h-8 rounded border border-zinc-200 bg-white flex items-center justify-center text-zinc-300 text-lg">💡</div>
      <p className="text-xs text-zinc-400">
        运行 <span className="font-medium text-zinc-500">Generation</span> 后，营销内容将显示在这里。
      </p>
    </div>
  );
}

// ─── 状态栏 ───────────────────────────────────────────────────────────────────

function StatusBar({ run }: { run: StepRun }) {
  const color =
    run.status === "running" ? "bg-blue-50 text-blue-700 border-blue-200"
    : run.status === "success" ? "bg-green-50 text-green-700 border-green-200"
    : "bg-red-50 text-red-700 border-red-200";
  return (
    <div className={`flex items-center gap-2 px-4 py-2 border-b text-xs font-medium ${color}`}>
      {run.status === "running" && <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />}
      <span>{run.status === "running" ? "生成中…" : run.status === "success" ? "成功" : "错误"}</span>
      {run.durationMs !== undefined && <span className="ml-auto opacity-70">{run.durationMs}ms</span>}
      <span className="opacity-50 font-mono text-[10px]">{run.methodId}</span>
    </div>
  );
}

function WarningsSection({ warnings }: { warnings: string[] }) {
  return (
    <div className="px-4 py-2 border-b border-zinc-200 bg-amber-50">
      {warnings.map((w, i) => (
        <p key={i} className="text-[10px] text-amber-700">⚠ {w}</p>
      ))}
    </div>
  );
}

function ErrorSection({ error }: { error: { code: string; message: string } }) {
  return (
    <div className="px-4 py-3 border-b border-zinc-200">
      <p className="text-[10px] font-mono text-red-500 mb-1">{error.code}</p>
      <p className="text-xs text-red-700 leading-relaxed">{error.message}</p>
    </div>
  );
}

// ─── 内容区路由 ───────────────────────────────────────────────────────────────

function GenOutputSection({ methodId, output }: { methodId: string; output: unknown }) {
  if (methodId === "product-persona") {
    return <PersonaSection output={output as ProductPersonaOutput} />;
  }
  if (methodId === "selling-points") {
    return <SellingPointsSection output={output as SellingPointsOutput} />;
  }
  if (methodId === "content-ideas") {
    return <ContentIdeasSection output={output as ContentIdeasOutput} />;
  }
  // marketing-ideas：回退到简单文本展示
  const o = output as { generatedContent?: string; citedEvidenceIds?: string[] };
  return (
    <div className="px-4 py-3 space-y-3">
      <pre className="text-[10px] font-mono text-zinc-700 whitespace-pre-wrap break-all leading-relaxed">
        {o.generatedContent ?? ""}
      </pre>
      {(o.citedEvidenceIds ?? []).length > 0 && (
        <EvidenceFooter ids={o.citedEvidenceIds!} />
      )}
    </div>
  );
}

// ─── 产品画像 ─────────────────────────────────────────────────────────────────

function PersonaSection({ output }: { output: ProductPersonaOutput }) {
  return (
    <div className="px-4 py-3 space-y-4">
      <div>
        <SectionLabel>目标人群</SectionLabel>
        <p className="text-xs text-zinc-700 leading-relaxed mt-1">{output.targetSegment}</p>
      </div>
      <div>
        <SectionLabel>核心痛点</SectionLabel>
        <ul className="mt-1 space-y-1">
          {output.painPoints.map((p, i) => (
            <li key={i} className="text-xs text-zinc-700 flex gap-1.5">
              <span className="text-red-400 shrink-0">•</span>{p}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionLabel>核心需求</SectionLabel>
        <ul className="mt-1 space-y-1">
          {output.coreNeeds.map((n, i) => (
            <li key={i} className="text-xs text-zinc-700 flex gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>{n}
            </li>
          ))}
        </ul>
      </div>
      {output.citedEvidenceIds.length > 0 && <EvidenceFooter ids={output.citedEvidenceIds} />}
      {output.summary && <MarkdownSummary text={output.summary} />}
    </div>
  );
}

// ─── 卖点地图 ─────────────────────────────────────────────────────────────────

function SellingPointsSection({ output }: { output: SellingPointsOutput }) {
  return (
    <div className="px-4 py-3 space-y-4">
      <div>
        <SectionLabel>核心卖点</SectionLabel>
        <div className="mt-1 space-y-2">
          {output.sellingPoints.map((sp, i) => (
            <div key={i} className="border-l-2 border-violet-300 pl-2">
              <div className="flex items-start justify-between gap-1">
                <p className="text-[11px] font-semibold text-zinc-800">{sp.title}</p>
                {sp.evidenceIds.length > 0 && (
                  <span className="text-[9px] text-violet-500 font-mono shrink-0">{sp.evidenceIds.join(" ")}</span>
                )}
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed mt-0.5">{sp.description}</p>
            </div>
          ))}
        </div>
      </div>
      {output.differentiators.length > 0 && (
        <div>
          <SectionLabel>差异化优势</SectionLabel>
          <ul className="mt-1 space-y-1">
            {output.differentiators.map((d, i) => (
              <li key={i} className="text-xs text-zinc-700 flex gap-1.5">
                <span className="text-violet-400 shrink-0">★</span>{d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {output.citedEvidenceIds.length > 0 && <EvidenceFooter ids={output.citedEvidenceIds} />}
      {output.summary && <MarkdownSummary text={output.summary} />}
    </div>
  );
}

// ─── 内容 Idea ────────────────────────────────────────────────────────────────

function ContentIdeasSection({ output }: { output: ContentIdeasOutput }) {
  return (
    <div className="px-4 py-3 space-y-3">
      <SectionLabel>内容创意（{output.ideas.length} 条）</SectionLabel>
      {output.ideas.map((idea, i) => (
        <div key={i} className="bg-white border border-zinc-200 rounded p-2.5 space-y-1">
          <div className="flex items-start justify-between gap-1">
            <p className="text-[11px] font-semibold text-zinc-800">
              <span className="text-zinc-400 font-mono mr-1">{String(i + 1).padStart(2, "0")}</span>
              {idea.title}
            </p>
            <span className="text-[9px] bg-zinc-100 text-zinc-500 rounded px-1 py-0.5 shrink-0 font-mono">{idea.format}</span>
          </div>
          <p className="text-[10px] text-zinc-600 leading-relaxed">{idea.angle}</p>
          {idea.evidenceIds.length > 0 && (
            <p className="text-[9px] text-violet-500 font-mono">{idea.evidenceIds.join(" ")}</p>
          )}
        </div>
      ))}
      {output.citedEvidenceIds.length > 0 && <EvidenceFooter ids={output.citedEvidenceIds} />}
      {output.summary && <MarkdownSummary text={output.summary} />}
    </div>
  );
}

// ─── 共用子组件 ───────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">{children}</p>
  );
}

function EvidenceFooter({ ids }: { ids: string[] }) {
  return (
    <div className="pt-2 border-t border-zinc-100">
      <p className="text-[9px] text-zinc-400">
        📎 引用 evidence：
        <span className="font-mono text-violet-500 ml-1">{ids.join(" ")}</span>
      </p>
    </div>
  );
}

function MarkdownSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-zinc-100 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[9px] text-zinc-400 hover:text-zinc-600 flex items-center gap-1"
      >
        {open ? "▾" : "▸"} {open ? "折叠摘要" : "展开 markdown 摘要"}
      </button>
      {open && (
        <pre className="mt-2 text-[10px] font-mono text-zinc-600 whitespace-pre-wrap break-all leading-relaxed">
          {text}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **步骤 2：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 3：Commit**

```bash
git add app/components/playground/GenerationOutputPanel.tsx
git commit -m "feat: add GenerationOutputPanel with card layout for three generation methods"
```

---

## 任务 4：PlaygroundShell — 条件渲染

**文件：**
- 修改：`app/components/playground/PlaygroundShell.tsx`

- [ ] **步骤 1：追加 import**

在现有 import 区域追加：
```typescript
import GenerationOutputPanel from "./GenerationOutputPanel";
```

- [ ] **步骤 2：替换右侧面板的渲染逻辑**

找到当前的：
```tsx
<OutputTracePanel stage={activeStage} runs={stepRuns[activeStage.id] ?? []} />
```

替换为：
```tsx
{activeStage.id === "generation" ? (
  <GenerationOutputPanel runs={stepRuns["generation"] ?? []} />
) : (
  <OutputTracePanel stage={activeStage} runs={stepRuns[activeStage.id] ?? []} />
)}
```

- [ ] **步骤 3：运行 typecheck + lint**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck && npm run lint
```
预期：0 错误，0 警告

- [ ] **步骤 4：Commit**

```bash
git add app/components/playground/PlaygroundShell.tsx
git commit -m "feat: conditionally render GenerationOutputPanel for generation stage"
```

---

## 任务 5：最终验证

- [ ] **步骤 1：运行 init.sh**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker && ./init.sh
```
预期：全部通过

- [ ] **步骤 2：更新 feature_list.json**

将 `feat-005` 状态从 `in-progress` 改为 `done`，并补充 evidence：
```json
{
  "id": "feat-005",
  "name": "Marketing Generation",
  "description": "生成产品画像、卖点地图和内容 idea，并携带 evidence chunk references。",
  "dependencies": ["feat-004.5"],
  "status": "done",
  "evidence": "2026-05-20 实现：generation/route.ts 新增 product-persona / selling-points / content-ideas 三个 JSON-mode 方法；stageRegistry 补充三种方法 params；新建 GenerationOutputPanel.tsx（卡片式专属展示面板）；PlaygroundShell 条件渲染。typecheck + lint + init.sh 全部通过。"
}
```

- [ ] **步骤 3：更新 progress.md + session-handoff.md**

在 `progress.md` 顶部追加：

```markdown
## 2026-05-20（会话 11）

### 已完成

- 实现 `feat-005` Marketing Generation：
  - `generation/route.ts` 新增 `product-persona`（产品画像）、`selling-points`（卖点地图）、`content-ideas`（内容 idea）三种 JSON-mode 方法；保留 `marketing-ideas` 向后兼容。
  - `stageRegistry.ts` 补充三种方法的 params 定义（model/apiKey/baseUrl/targetAudience/ideaCount）。
  - 新建 `GenerationOutputPanel.tsx`：产品画像显示三段式；卖点地图显示卡片列表；内容 idea 显示编号卡片；公共 evidence 引用脚注和折叠 markdown summary。
  - `PlaygroundShell.tsx`：当 activeStage.id === "generation" 时切换至专属面板。
  - typecheck + lint + init.sh 全部通过。

### 当前状态

- `feat-005` 完成。
- 下一步：`feat-006` RAG Quality Evaluation。

---
```

在 `session-handoff.md` 更新：
- 最后更新 → `2026-05-20（会话 11）`
- 已完成 features 表格加入 feat-005
- HEAD 更新为最新 commit SHA（运行 `git rev-parse --short HEAD` 获取）

- [ ] **步骤 4：最终 commit**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker
git add feature_list.json progress.md session-handoff.md
git commit -m "docs: update harness state for feat-005 marketing generation"
```
