# 面试题 — Pipeline Context & Preprocess Stage（feat-002.6 + feat-003.2）

相关文件：
- `app/lib/pipelineDeps.ts`
- `app/components/playground/StageConfigPanel.tsx`（getBlockReason / checkUpstreamStale）
- `app/app/api/pipeline/preprocess/route.ts`

---

## Q1：你的 RAG Pipeline 各 stage 之间如何传递依赖？如果上游没跑完，下游怎么处理？

**答：**
在 `lib/pipelineDeps.ts` 中定义了一个静态依赖图（`STAGE_DEPS`），记录每个 stage 的直接上游。前端的 `getBlockReason()` 函数在渲染 stage 配置面板时检查：

1. 是否已选文档（所有 ingestion stage 的前提）
2. 直接上游是否已成功运行（`stepRuns[upstreamId]?.[0]?.status === "success"`）

如果条件不满足，显示具体的阻塞原因（"需要先成功运行「文档幂等性检查」才能继续"），而不是泛泛的错误提示。这样用户能清楚知道卡在哪一步。

---

## Q2：你如何检测"上游重跑但下游没跟进"的过时状态？

**答：**
`checkUpstreamStale()` 函数比较时间戳：如果上游最新 run 的 `startedAt` 晚于当前 stage 最新 run 的 `startedAt`，就说明上游在当前 stage 之后又运行了，当前结果可能基于旧数据。

```typescript
return !!upstreamRun && upstreamRun.startedAt > currentRun.startedAt;
```

这是一个轻量级的版本追踪方案，不需要引入额外的 "inputRef version" 字段。

---

## Q3：为什么 RAG 系统需要预处理步骤？直接对原始文本做 embedding 不行吗？

**答：**
直接对原始 Markdown/PDF 嵌入有几个问题：

1. **噪音引入**：`## 标题`、`[链接文字](url)`、`**加粗**` 等 Markdown 符号会被当作语义内容编码，干扰向量的语义质量
2. **结构丢失**：embedding 模型只看文本，不懂 Markdown 结构；预处理时记录 heading path，可以在 chunking 阶段保留"这段话属于哪个章节"的 metadata，对检索结果的可解释性非常重要
3. **PDF 乱序**：PDF 提取的文本常有页眉页脚、列变换导致的乱序，需要先整理

本项目的 `sourceRefs` 记录了每段文字在文档中的 heading 路径，后续 citation 阶段可以用这个路径生成精确的引用。

---

## Q4：你的 Markdown 预处理用了什么思路来保留文档结构？

**答：**
使用"heading path 栈"：一个长度为 6 的数组对应 h1~h6，遇到 `# 标题` 时更新对应层级并清空更深层级，始终维护当前所在的完整 heading 路径，例如 `["产品介绍", "核心功能", ""]`。

每个段落被处理时，把当前 heading path 作为 `sourceRef` 记录：
```
{ type: "paragraph", value: "产品介绍 > 核心功能", charStart: 60, charEnd: 78 }
```

这个设计的价值：chunking 阶段可以按 heading 边界切分，每个 chunk 自带位置信息；citation 阶段可以直接展示"来自产品介绍 > 核心功能"的引用，而不是裸的字符偏移量。

---

## Q5：为什么 preprocess 不直接把结果写入数据库，而是返回给前端展示？

**答：**
这是"可调试 Playground"设计哲学的体现：

- **可观察性优先**：用户能在右侧 Output 面板实时看到 cleanText 和 sourceRefs，发现解析错误可以立即调整参数重跑，而不是等到 retrieval 时才发现数据不对
- **职责分离**：preprocess 只负责文本处理，不做存储决策。存储是 Storage Stage（feat-003.6）的职责，它会决定用哪个版本的预处理结果写入 PostgreSQL
- **参数可调**：同一份文档可以用不同参数多次预处理（例如 `preserveHeadings=true/false`），对比哪种效果更好，之后再选择写入

在生产 RAG 系统里，这些步骤通常是一个黑盒 batch job，问题难以定位。本项目把它变成可交互的调试界面，这正是作品集的差异化价值所在。
