# 面试题 — Query Rewrite Stage（feat-004.1）

相关文件：`app/app/api/pipeline/query-rewrite/route.ts`

---

## Q1：Query Rewrite 在 RAG pipeline 中的位置和作用是什么？

**答：**

Query Rewrite 是 Retrieval Pipeline 的第一步，位于用户输入 query 之后、向量检索之前。

**核心问题：** 单个用户 query 的词汇覆盖面有限。用户表达"产品有什么优势"，文档里写的是"核心竞争力"——两者语义相近但词汇不同，embedding 相似度可能漏检。

**解决方案：** 生成 N 个语义等价但措辞不同的 query 变体，对每个变体分别检索后合并去重。典型效果：1 个 query 扩展到 3 个，Hit Rate@10 可提升 15-30%。

本项目三种方法：
- `none`：直接透传，用于 baseline 对比
- `rule-keyword-expansion`：TF 词频提取关键词 + 营销场景模板扩展，零 API 成本
- `llm-marketing-rewrite`：OpenAI JSON mode 生成，质量最高但有 latency 和费用

---

## Q2：rule-keyword-expansion 的 TF 停用词过滤是如何实现的？有什么局限？

**答：**

**实现：**
1. 分词（按非字母数字切分 + 中文 2-gram）
2. 过滤停用词（"的"、"了"、"and"、"the" 等）
3. 计算每个词的 TF（Term Frequency）= 出现次数 / 总词数
4. 按 TF 降序取 top-N 关键词
5. 将关键词代入预设营销模板（"[kw] 的核心优势是什么"、"[kw] 适合哪些用户"）

**局限：**
- **无语义理解**：高频词不等于关键概念，"产品"、"功能"这类泛词可能 TF 很高但无检索价值
- **模板固定**：生成的变体都是同一套模板，不能理解用户真实意图
- **中文分词粗糙**：2-gram 切分会产生大量无意义双字词

生产环境中应结合 LLM 方法或专用关键词抽取模型（如 KeyBERT）。

---

## Q3：LLM-based Query Rewrite 为什么用 JSON mode 而不是普通补全？

**答：**

Query Rewrite 需要返回**结构化的 query 列表**（数组），如果用普通补全：
- LLM 可能返回带序号的文本、markdown 列表、或夹带解释性文字
- 解析这些格式需要大量正则或后处理逻辑，容易出错

JSON mode 强制 LLM 输出合法 JSON，配合 system prompt 定义 schema：
```json
{"queries": ["rewrite1", "rewrite2", "rewrite3"]}
```

直接 `JSON.parse` 即可，解析可靠，下游不需要特殊处理。

代价：JSON mode 通常比普通补全慢 10-20%，且需要显式在 system prompt 中说明格式要求。

---

## Q4：生成多个 query 变体后，如何防止下游检索结果爆炸？

**答：**

多 query 扩展会让下游检索结果数量 × N。本项目的控制策略：

1. **maxQueries 参数限制变体数**（默认 3），防止过多变体
2. **下游按 stageId 去重**：`retrieval` stage 对多个 query 的结果按 `chunkId` 去重，每个 chunk 保留最高分
3. **topK 统一控制最终输出数量**：无论多少个 query，retrieval 输出最多 topK 个 chunk
4. **filter + rerank 进一步精简**：后续 stage 再按 score threshold 和多样性过滤

这是 Multi-query RAG 的标准设计：扩召回 → 合并去重 → 精排截断。

---

## Q5：query-rewrite 的输出如何传递给 retrieval stage？在代码里如何体现？

**答：**

本项目通过 `upstreamOutput` 机制传递：`PlaygroundShell.handleRun` 在调用每个 stage API 时，自动从 `STAGE_DEPS` 查找当前 stage 的上游 stageId，并将上游最新的 `StepRun.output` 作为 `upstreamOutput` 一起 POST 给 API。

`retrieval` route 从 `upstreamOutput` 中读取：
```typescript
const queries: string[] = upstreamOutput?.rewrittenQueries ?? [body.query]
```

这样设计的好处：
- 每个 stage 的 API 是无状态的（不依赖服务端 session）
- 上游输出完整记录在 `StepRun` 中，方便调试和回放
- 可以单独测试任意 stage（直接 POST 构造好的 upstreamOutput）
