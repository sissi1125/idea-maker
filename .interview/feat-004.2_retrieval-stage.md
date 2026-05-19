# 面试题 — Retrieval Stage（feat-004.2）

相关文件：`app/app/api/pipeline/retrieval/route.ts`

---

## Q1：Dense Vector、Full-text、Hybrid 三种检索方法各自的优缺点是什么？

**答：**

| 方法 | 优点 | 缺点 | 适合场景 |
|------|------|------|----------|
| Dense Vector | 语义相似，处理同义词和措辞变体 | 需要 embedding API，成本高；关键词精确匹配弱 | 通用 RAG、语义问答 |
| Full-text | 速度快，零 API 依赖；关键词精确匹配 | 无语义理解；中文效果差（需分词扩展） | 英文文档、关键词搜索 |
| Hybrid RRF | 兼顾语义和关键词，召回率最高 | 两路都要运行，延迟和成本加倍 | 生产系统首选 |

本项目 Full-text 使用 PostgreSQL `simple` 字典（按 ASCII 切词），对中文只能按空格分，效果有限。生产环境中文建议 `pg_jieba` 或 `zhparser`。

---

## Q2：pgvector 的余弦相似度检索是如何工作的？为什么用 `<=>` 而不是 `<->`？

**答：**

pgvector 提供三种距离算子：
- `<->` L2 欧氏距离
- `<#>` 内积（负值）
- `<=>` 余弦距离（= 1 - cosine_similarity）

**为什么用余弦：**
Embedding 向量通常经过 L2 normalize（模长=1），此时余弦相似度 = 向量点积。余弦相似度只关注方向（语义），不受向量模长影响——不同长度文本的 embedding 模长可能不同，但余弦可以公平比较。

**SQL 示例：**
```sql
SELECT id, text, 1 - (embedding <=> $1::vector) AS score
FROM rag_chunks
ORDER BY embedding <=> $1::vector
LIMIT $2
```

注意：`ORDER BY <=>` 是按"距离升序"（距离越小越相似），返回 `1 - 距离` 作为相似度分数。

---

## Q3：RRF（Reciprocal Rank Fusion）如何合并两路检索结果？k=60 的含义是什么？

**答：**

**RRF 公式：**
```
RRF_score(doc) = Σ 1/(k + rank_i)
```
对每路检索，取文档在该路结果中的排名 rank（从 1 开始），计算 `1/(k+rank)`，再对所有路求和。

**k=60 的含义：**
k 是平滑常数，防止第 1 名权重过高。k=60 时：
- 第 1 名：1/61 ≈ 0.0164
- 第 10 名：1/70 ≈ 0.0143
- 相差不到 15%

k 值越大，各名次权重越均匀；k 值越小，排名靠前的 chunk 权重越突出。k=60 是业界实践中鲁棒性较好的默认值（Cormack et al. 2009）。

**优点：** 不需要归一化各路分数（向量相似度和 BM25 分数量纲不同），只看排名，天然跨路兼容。

---

## Q4：多个 query 变体同时检索时，如何合并和去重结果？

**答：**

本项目的合并策略（dense-vector 方法为例）：

```typescript
// 对每个 query 分别检索，得到多组结果
const allResults = await Promise.all(queries.map(q => searchByVector(q)));

// 按 chunkId 去重，保留最高分
const mergedMap = new Map<string, RetrievedChunk>();
for (const results of allResults) {
  for (const chunk of results) {
    const existing = mergedMap.get(chunk.chunkId);
    if (!existing || chunk.score > existing.score) {
      mergedMap.set(chunk.chunkId, chunk);
    }
  }
}

// 按分数降序，取 topK
return [...mergedMap.values()].sort((a, b) => b.score - a.score).slice(0, topK);
```

这个策略称为 **max-score merge**：同一 chunk 被多个 query 命中时，保留最高相关性分数（保守估计）。另一种策略是 sum-score（求和），适合认为多个 query 同时命中是更强信号的场景。

---

## Q5：connectionString 从表单传入而非只从环境变量读取，这个设计决策的理由是什么？

**答：**

本项目是 Playground 工具，核心价值是**可调试**——用户需要能在不修改环境变量的情况下切换不同的数据库（开发库 vs. 测试库 vs. 生产库）。

如果只读 `DATABASE_URL` env：
- 切换数据库需要重启 dev server
- 不同 stage 无法用不同数据库
- 用户无法在 UI 里直观看到"当前连接的是哪个库"

表单字段的优先级：`params.connectionString` > `process.env.DATABASE_URL`，保持了 12-Factor App 的环境变量规范，同时给 Playground 场景额外的灵活性。

代价：connectionString 可能出现在 trace 中（含密码），需要在 output 序列化时过滤敏感字段。
