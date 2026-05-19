# feat-005 Marketing Generation 设计规格

## 背景

RAG pipeline 完成文档检索、过滤、重排、prompt 构造后，进入 Generation stage 生成营销内容。现有实现仅有 `marketing-ideas` 单一方法，输出自由格式文本。

本 feature 扩展为三种独立的结构化内容生成方法，并新增专属展示面板。

---

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 方法数量 | 3 个独立方法 | 每种内容类型可独立运行、独立对比，符合 Playground 可调试原则 |
| 输出格式 | JSON + markdown summary | 可编程处理（JSON）+ 人类可读（markdown）|
| LLM 调用方式 | JSON mode | 保证输出可解析，避免格式错误 |
| UI 呈现 | 右侧专属面板，条件替换 OutputTracePanel | 不破坏现有布局，generation stage 自然接管右侧 |
| 现有 marketing-ideas | 保留 | 不做 breaking change |

---

## 后端

### 文件变更

- **修改**：`app/app/api/pipeline/generation/route.ts` — 新增 3 个方法
- **修改**：`app/lib/stageRegistry.ts` — 新增 3 个方法的 params 定义

### 新增方法和输出类型

#### `product-persona`（产品画像）

**LLM System Prompt 要求**：基于产品资料，描述目标用户画像，输出 JSON。

**输出 schema**：
```typescript
interface ProductPersonaOutput {
  targetSegment: string;    // 目标人群描述（1-2 句）
  painPoints: string[];     // 3 个核心痛点
  coreNeeds: string[];      // 3 个核心需求
  summary: string;          // markdown 摘要
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
}
```

**params**：model / apiKey / baseUrl / targetAudience

---

#### `selling-points`（卖点地图）

**LLM System Prompt 要求**：提炼产品核心卖点和差异化优势，输出 JSON。

**输出 schema**：
```typescript
interface SellingPointsOutput {
  sellingPoints: {
    title: string;           // 卖点标题（5-10 字）
    description: string;     // 卖点说明（2-3 句）
    evidenceIds: string[];   // 支撑该卖点的 evidence
  }[];                       // 3-5 条
  differentiators: string[]; // 2-3 条差异化优势
  summary: string;           // markdown 总结
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
}
```

**params**：model / apiKey / baseUrl / targetAudience

---

#### `content-ideas`（内容 idea）

**LLM System Prompt 要求**：基于产品资料生成可执行的营销内容创意，输出 JSON。

**输出 schema**：
```typescript
interface ContentIdeasOutput {
  ideas: {
    title: string;           // idea 标题
    angle: string;           // 切入角度（一句话）
    format: string;          // 推荐内容形式（短视频/图文/文章/海报等）
    evidenceIds: string[];   // 该 idea 的 evidence 依据
  }[];                       // ideaCount 条（默认 5）
  summary: string;           // markdown 汇总
  citedEvidenceIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  warnings: string[];
}
```

**params**：model / apiKey / baseUrl / targetAudience / ideaCount（number, default 5, min 1, max 20）

---

### LLM 调用规范

- **JSON mode**：`response_format: { type: "json_object" }`（OpenAI compatible）
- **temperature**：0.7（创意类任务）
- **System prompt**：每个方法内置，包含"输出必须严格 JSON"和 schema 说明
- **上游**：`PromptBuildOutput`（来自 prompt-build stage 的 systemPrompt + userPrompt + originalQuery）
- **evidence 引用提取**：从各输出字段的 evidenceIds 汇总到 citedEvidenceIds

### 错误处理

与现有 marketing-ideas 相同：
- 缺少 API Key → `missing_api_key`（400）
- LLM 认证失败 → `api_auth_failed`（500）
- Rate limit → `rate_limited`（500）
- JSON 解析失败 → `llm_output_parse_failed`（500，附上原始响应）

---

## 前端

### 文件变更

- **新建**：`app/components/playground/GenerationOutputPanel.tsx`
- **修改**：`app/components/playground/PlaygroundShell.tsx` — 条件渲染 GenerationOutputPanel

### GenerationOutputPanel 规格

**触发条件**：`activeStage.id === "generation"` 时替换右侧 `OutputTracePanel`。

**Props**：
```typescript
interface GenerationOutputPanelProps {
  runs: StepRun[];   // stepRuns["generation"]
}
```

**通用布局**（复用 OutputTracePanel 的运行历史选择器 + 状态栏）：

```
[Run #N ▾]  ← 运行历史下拉（多次运行时显示）
● 成功  selling-points  1.2s  ← 状态栏
────────────────────────────────────────
[方法对应的内容卡片区域]
────────────────────────────────────────
📎 引用 evidence：[doc1_v1_c3] [doc1_v1_c7]
[▾ 展开 markdown 摘要]
```

**product-persona 渲染**：
- 目标人群：一段描述文字
- 痛点：`• ` 列表（3 条）
- 核心需求：`• ` 列表（3 条）
- Evidence 汇总 + 折叠 markdown summary

**selling-points 渲染**：
- 卖点卡片列表（border-l-2 accent 色）：标题 + 描述 + `[1][2]` 引用编号
- 差异化优势：`• ` 列表
- Evidence 汇总 + 折叠 markdown summary

**content-ideas 渲染**：
- 编号列表（`01` `02`...）：标题加粗 + 角度 + 形式标签（pill）+ `[1][2]` 引用
- Evidence 汇总 + 折叠 markdown summary

**无运行记录**：显示"运行 Generation stage 后，营销内容将显示在这里"空状态。

**有运行记录但为错误**：显示 ErrorSection（复用 OutputTracePanel 的样式）。

---

## 不在本 feature 范围内

- 生成内容的编辑、保存、导出功能
- 多轮对话式生成（需要 feat-006 支持）
- marketing-ideas 方法的修改（保持现状）
