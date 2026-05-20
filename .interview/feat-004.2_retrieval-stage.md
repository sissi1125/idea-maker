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

---

## Q6：BM25 和 ts_rank 都基于词频，为什么 BM25 在 RAG 场景更合适？

**答：**

`ts_rank`（PostgreSQL 内置）和 BM25 的关键差异：

| 特性 | ts_rank | BM25 |
|------|---------|------|
| 词频 TF | ✓ | ✓ |
| 逆文档频率 IDF | ✗ | ✓ |
| 文档长度归一化 | 部分 | ✓（参数 b 控制） |
| 词频饱和 | ✗ | ✓（参数 k1 控制） |

**IDF 的重要性：** IDF 惩罚高频通用词（"的"、"是"、"这个"），让稀有关键词获得更高权重。RAG 场景中用户查询通常包含领域关键词（如"向量索引"、"HNSW"），这些词应比"介绍"、"说明"权重高，ts_rank 做不到这一点。

**词频饱和（k1）：** BM25 的 TF 贡献随词频增加而饱和（k1 控制速度）。避免某个词在 chunk 里出现 50 次就获得过高分数——长文档中的重复词应被压制。

**长度归一化（b）：** 长 chunk 因词数多自然有更高 TF，b 参数让不同长度的 chunk 在同一尺度下比较。

---

## Q7：字符 bigram 分词的原理是什么？和词典分词（jieba）相比有哪些优缺点？

**答：**

**字符 bigram 原理：**
对中文字符序列做 2 字滑窗，生成所有相邻 2 字组合：
```
"北京天气怎么样" → ["北京", "京天", "天气", "气怎", "怎么", "么样"]
```
每个 bigram 都是检索的最小单元，用 `ILIKE '%北京%'` 即可匹配含"北京"的 chunk。

| 维度 | 字符 bigram | 词典分词（jieba） |
|------|-------------|-----------------|
| 依赖 | 零依赖 | 需要词典文件 + 分词库 |
| 准确性 | 产生大量噪声 bigram（"京天"无意义）| 按词边界切分，准确 |
| 召回率 | 高（暴力覆盖所有 2 字组合）| 依赖词典，OOV 词可能漏召 |
| 查询效率 | terms 数量多，ILIKE 扫描开销大 | terms 少，查询更精准 |
| 中文长词 | 无法识别"自然语言处理"为整体 | 可识别多字词 |

本项目选择 bigram 的原因：零依赖、适合 playground 演示 BM25 概念。生产系统应使用 `nodejieba`（Node.js）或 `pg_jieba`（PostgreSQL 扩展）。

---

## Q8：hybrid-bm25-rrf 和 hybrid-rrf 的区别是什么？中文场景下为什么前者更好？

**答：**

两种方法都用 RRF 融合两路检索，区别在于稀疏路：

| 方法 | 稀疏路 | 中文支持 |
|------|--------|---------|
| hybrid-rrf | PostgreSQL `tsvector` + `simple` 字典 | 不支持（按空格切词，中文无空格） |
| hybrid-bm25-rrf | 字符 bigram + JS 层 BM25 计分 | 支持 |

**`simple` 字典对中文为何无效：**
`to_tsvector('simple', '北京天气')` 会把整段中文当成一个 token，`@@` 匹配运算符无法精确命中单个词，中文文档的全文路召回率为零。

**hybrid-bm25-rrf 的优势：**
- 密集路（dense vector）捕获语义相似（"北京"和"首都"能关联）
- BM25 路捕获关键词精确匹配（query 中的专有名词、术语不被向量平滑掉）
- 两路 RRF 融合后，语义理解和关键词精确匹配互补，召回率比单路高

**代价：** 需要额外 1 次 embedding API 调用（dense 路）+ 2 次 DB 查询，延迟比纯 BM25 高。
