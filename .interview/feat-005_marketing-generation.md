# 面试题 — Marketing Generation（feat-005）

相关文件：
- `app/app/api/pipeline/generation/route.ts` — 四种生成方法
- `app/app/api/pipeline/prompt-build/route.ts` — Prompt 构造（RAG/营销模板）
- `app/components/playground/GenerationOutputPanel.tsx` — 专属展示面板

---

## Q1：本项目的 generation stage 支持哪几种方法？各自的适用场景是什么？

**答：**

| 方法 | 输出格式 | 适用场景 |
|------|---------|---------|
| `marketing-ideas` | 自由格式 Markdown 文本 | 探索性头脑风暴，快速获取营销创意 |
| `product-persona` | JSON（targetSegment / painPoints / coreNeeds / summary） | 结构化用户画像，用于受众定向决策 |
| `selling-points` | JSON（sellingPoints[] / differentiators[] / summary） | 卖点提炼，用于广告文案和销售话术 |
| `content-ideas` | JSON（ideas[]{title/angle/format} / summary） | 内容营销排期，输出可执行的内容创意 |

三种结构化方法（product-persona / selling-points / content-ideas）均使用 OpenAI JSON mode（`response_format: { type: "json_object" }`）确保输出格式稳定，可直接被前端解析渲染。

---

## Q2：为什么三种结构化方法使用 JSON mode，而 marketing-ideas 不用？

**答：**

**JSON mode 适合有明确 schema 的输出：** product-persona / selling-points / content-ideas 都需要返回固定字段（数组、嵌套对象），JSON mode 强制 LLM 输出合法 JSON，避免解析失败。

**marketing-ideas 不使用 JSON mode 的理由：** 营销创意头脑风暴是"开放式"的，内容本身就是 Markdown 格式（可以包含列表、标题、强调），没有固定 schema。强制 JSON 会破坏文本的自然结构，反而降低可读性。

**JSON parse 失败的降级处理：**
```typescript
try {
  parsed = JSON.parse(raw);
} catch (parseErr) {
  warnings.push(`LLM 输出无法解析为 JSON，请检查模型是否支持 JSON mode`);
  parsed = {};
}
```
解析失败时，各字段回退到空数组/空字符串，不报错，warning 提示用户。

---

## Q3：evidence-first 原则在 generation 阶段如何体现？

**答：**

**Evidence-first 原则：** 所有营销主张必须有 evidence（从文档检索到的 chunk）作为依据，不允许 LLM 凭空捏造。

**在代码中的落地：**

1. **System prompt 明确要求**：每种方法的 system prompt 都包含"所有内容必须基于提供的资料""不要编造资料中没有的内容"等约束，并要求在 `citedEvidenceIds` 字段标注引用编号。

2. **citedEvidenceIds 提取**：marketing-ideas 方法从生成文本中提取 `[evidence-NNN]` 或 `[1]`、`[2]` 等引用标记；结构化方法让 LLM 在 JSON 中直接返回 `citedEvidenceIds`。

3. **无引用时的 warning**：
   ```typescript
   if (citedEvidenceIds.length === 0 && Boolean(params.includeEvidence ?? true)) {
     warnings.push("生成内容中未检测到 evidence 引用标注");
   }
   ```

4. **UI 层展示**：GenerationOutputPanel 每个 Section 底部都有 `EvidenceFooter` 显示被引用的 evidence ID 列表，让用户可以回溯到原始 chunk。

---

## Q4：GenerationOutputPanel 如何根据 methodId 路由到不同的渲染组件？

**答：**

```typescript
function GenOutputSection({ methodId, output }) {
  if (methodId === "product-persona")  return <PersonaSection output={...} />;
  if (methodId === "selling-points")   return <SellingPointsSection output={...} />;
  if (methodId === "content-ideas")    return <ContentIdeasSection output={...} />;
  // marketing-ideas：回退到简单文本展示
  return <pre>{output.generatedContent}</pre>;
}
```

每种 Section 组件对应不同的数据结构：
- `PersonaSection`：展示 targetSegment、painPoints 列表、coreNeeds 列表
- `SellingPointsSection`：展示 sellingPoints 卡片（title + description）+ differentiators
- `ContentIdeasSection`：展示 ideas 列表（title + angle + format badge）

与 OutputTracePanel（通用 JSON 树形展示）的区别：GenerationOutputPanel 是针对特定业务结构的专属渲染，将 JSON 字段转化为可读的卡片布局，体现了"专属面板"比"通用面板"更好的用户体验。

---

## Q5：prompt-build 的两种模板（rag-template / marketing-template）有什么核心区别？

**答：**

**rag-template（标准 RAG 模板）：**
- System prompt 核心约束："仅基于参考资料回答，信息不足时明确说明"
- 输出导向：事实性问答，优先准确性
- 适合：产品信息查询、规格对比、FAQ 回答

**marketing-template（营销场景模板）：**
- 在标准 RAG 基础上追加三个维度：
  1. **目标受众定向**：`targetAudience` 参数注入 system prompt（"目标受众：B2B SaaS 决策者"）
  2. **输出语气**：`tone` 参数（professional / casual / persuasive）
  3. **内容框架建议**：引导 LLM 输出卖点、使用场景、差异化优势等营销结构
- 输出导向：说服性内容，兼顾准确性和吸引力
- 适合：内容生成、卖点提炼、营销文案撰写

两者共用同一套 evidence 注入逻辑（contextText 来自 citation stage），核心区别在 system prompt 的角色设定和约束条款不同。
