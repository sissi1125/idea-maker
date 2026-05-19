# 面试题 — Rerank Stage（feat-004.4）

相关文件：`app/app/api/pipeline/rerank/route.ts`

---

## Q1：Rerank 阶段在 Two-stage Retrieval Pipeline 中的作用是什么？

**答：**

Two-stage Retrieval 是业界标准模式：
1. **粗检索（Bi-encoder）**：embedding 模型将 query 和所有 chunk 各自编码为向量，向量相似度快速找出 top-K 候选（如 top-50）
2. **精排（Cross-encoder / Reranker）**：对候选集重新打分，精度更高但速度慢，取 top-N（如 top-5）

**为什么不直接用 Cross-encoder 检索全库：**
- Cross-encoder 需要 query 和每个 chunk 拼接后一起 encode，对 100 万个 chunk 要跑 100 万次 forward pass，延迟不可接受
- Bi-encoder 只需要 query 跑一次，chunk 向量预先存储，检索时只做向量点积，速度快 1000 倍以上

Rerank 是在"召回质量"和"响应速度"之间的工程折中。

---

## Q2：Bi-encoder 和 Cross-encoder 的本质区别是什么？

**答：**

| | Bi-encoder | Cross-encoder |
|--|--|--|
| 工作方式 | query 和 doc 各自独立 encode → 向量点积 | query + doc 拼接后一次 encode → 输出相关性分数 |
| 精度 | 中（向量无法捕捉 query-doc 词汇交互） | 高（joint encoding 可捕获细粒度 query-doc 交互） |
| 速度 | 快（doc 向量可预存） | 慢（每对 query-doc 都要跑一次 forward pass） |
| 代表模型 | text-embedding-3-small、BAAI/bge-m3 | BAAI/bge-reranker-v2-m3、ms-marco-MiniLM |
| 用途 | 粗检索（top-K 召回）| 精排（对召回结果重排序）|

**为什么 Cross-encoder 更精确：**
Bi-encoder 的 query 和 doc 向量是独立的，点积只能捕捉"整体语义方向"的相似性。Cross-encoder 把 query 和 doc 拼成 `[CLS] query [SEP] doc [SEP]`，模型中的注意力机制可以直接看到两者的词汇交互（如"苹果"在 query 里指水果还是手机，在拼接的 doc 上下文里可以区分）。

---

## Q3：llm-relevance-rerank 用 Promise.all 并行打分有什么优缺点？

**答：**

**实现：**
```typescript
const scores = await Promise.all(
  chunks.map(chunk => scoreSingleChunk(query, chunk, apiKey))
);
```
对每个 chunk 各发一次 LLM 打分请求，全部并行。

**优点：**
- 延迟 = max(单次请求延迟)，而不是 Σ(所有请求延迟)
- 对 10 个 chunk 打分，并行比串行快约 10 倍

**缺点：**
- **成本不变**：并行不减少 token 消耗，N 个 chunk 就是 N 次 API 调用
- **Rate Limit 风险**：并发太高容易触发 OpenAI / Qwen 的 RPM/TPM 限制
- **无法跨 chunk 对比**：每次只打一个 chunk，LLM 不能做"这个比那个更相关"的相对排序

生产环境通常用 Cross-encoder（TEI Reranker）代替 LLM 打分：单次请求传入全部候选，返回所有分数，延迟固定、成本低、支持相对排序。

---

## Q4：metadata-boost 方法是如何实现关键词加权的？适合什么场景？

**答：**

**实现：**
```typescript
const boost = countKeywordMatches(chunk.text, params.boostKeywords) * params.boostFactor;
const boostedScore = chunk.score + boost;
```

检查 chunk.text 中包含多少个用户指定关键词，每命中一个加 `boostFactor`（默认 0.1）分。

**适合场景：**
1. **领域关键词**：产品代号、专有名词（"AIGC"、"RAG"、"向量数据库"）需要比普通语义匹配更高的权重
2. **用户指定偏好**：用户明确说"我想找关于定价的内容"，"定价"、"价格"、"cost"可以 boost
3. **A/B 测试**：对比是否加 boost 的检索效果差异

**局限：**
- 关键词必须精确匹配（未做 stem / lemmatize）
- 不能理解同义词（"费用"不会 boost "价格"）
- boostFactor 需要实验调参，太大会压制语义相关性

---

## Q5：rankChanges 字段是什么？对 Playground 调试有什么价值？

**答：**

`rankChanges` 记录每个 chunk 在 rerank 前后的排名变化：
```typescript
{
  chunkId: "doc1_v1_c3",
  beforeRank: 5,    // 在 filter 输出中的排名
  afterRank: 1,     // rerank 后的排名
  scoreBefore: 0.72,
  scoreAfter: 0.91
}
```

**调试价值：**

用户在 Playground 里可以直观看到：
- 哪些 chunk 被大幅提升（beforeRank=8 → afterRank=1）：说明 reranker 认为它与 query 比 embedding 以为的更相关
- 哪些 chunk 被大幅下降（beforeRank=1 → afterRank=7）：说明 embedding 高估了它的相关性
- 如果 rerank 前后排名完全不变：说明 embedding 和 reranker 判断一致，不需要 rerank（可以跳过）

这帮助用户判断"我的 Rerank stage 有没有在真正发挥作用"，是 RAG 可调试性的核心体现。
