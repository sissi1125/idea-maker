# 面试题 — Retrieval Pipeline（feat-004.1～004.5）

相关文件：
- `app/app/api/pipeline/query-rewrite/route.ts`
- `app/app/api/pipeline/retrieval/route.ts`
- `app/app/api/pipeline/filter/route.ts`
- `app/app/api/pipeline/rerank/route.ts`
- `app/app/api/pipeline/citation/route.ts`

---

## Q1：Query Rewrite 为什么能提升 RAG 召回率？RRF 是什么？

**答：**

**Query Rewrite 的作用：**
单个 query 的词汇覆盖面有限，embedding 相似度对"措辞不同但语义一致"的 chunk 容易漏检。通过生成 N 个变体（不同角度、不同措辞），对每个变体分别检索后合并，可以覆盖更多语义相近的 chunk。

典型效果：1 个 query 扩展到 3 个，Hit Rate@10 可提升 15-30%（取决于文档领域）。

**RRF（Reciprocal Rank Fusion）：**

合并多路检索结果时，各路的分数不具有可比性（向量相似度 vs. BM25 得分）。RRF 只看"排名"：

```
RRF score = Σ 1/(k + rank_i)
```

其中 k=60 是平滑常数，防止第 1 名权重过高。两路检索都排前的 chunk 得分高，只有一路命中的得分低。

优点：不需要归一化各路分数，鲁棒性强。缺点：RRF score 不是语义相似度，不能直接用于过滤阈值。

---

## Q2：Dense Vector 检索、Full-text 检索、Hybrid 检索各自适合什么场景？

**答：**

| 方法 | 优点 | 缺点 | 适合场景 |
|------|------|------|----------|
| Dense Vector | 语义相似，处理同义词和表达变体 | 需要 embedding API，成本高；对关键词精确匹配弱 | 通用 RAG、语义问答 |
| Full-text | 速度快，零 API 依赖；关键词精确匹配 | 无语义理解，中文需要 pg_jieba 等分词扩展 | 关键词搜索、英文文档 |
| Hybrid RRF | 兼顾语义和关键词，通常效果最佳 | 需要两路都运行，成本和延迟加倍 | 生产系统首选 |

本项目 Full-text 使用 PostgreSQL 的 simple 字典（按 ASCII 切词），对中文只能按空格分词，效果有限。生产环境中文文档建议用 pg_jieba 或 zhparser 扩展。

---

## Q3：MMR（Maximal Marginal Relevance）是什么？为什么需要它？

**答：**

**问题背景：**
纯按相似度排序的 top-K 结果往往"扎堆"在同一话题的相似表达上，导致送给 LLM 的 context 信息密度低（同一个意思说了 5 遍）。

**MMR 算法：**
```
score_mmr(d) = λ × score(d) - (1-λ) × max_{d'∈S} similarity(d, d')
```
每轮从剩余候选中选"和已选集合最不相似、同时和 query 最相关"的 chunk，直到达到数量上限。

- λ=1：完全按相关性（等同于普通排序）
- λ=0：完全按多样性
- λ=0.5：平衡，实践中常用

本项目用 Jaccard 词集重叠代替向量余弦（filter stage 不持有 embedding 向量），精度稍低但不依赖额外 API。

---

## Q4：Rerank 阶段的 Cross-encoder 和 Bi-encoder 有什么区别？

**答：**

| | Bi-encoder | Cross-encoder |
|--|--|--|
| 工作原理 | query 和 doc 各自独立 encode → 向量点积 | query + doc 拼接后一次 encode → 直接输出相关性分数 |
| 精度 | 中（向量无法捕捉 query-doc 交互） | 高（joint encoding 可捕获细粒度交互） |
| 速度 | 快（doc 向量可预先存储） | 慢（每对 query-doc 都要跑一次 forward pass） |
| 用途 | 粗检索（top-K 召回）| 精排（对召回结果重排序）|

**本项目的做法（Cascaded Retrieval）：**
1. Bi-encoder（embedding）做粗检索：从百万 chunk 中快速找出 top-50 候选
2. Cross-encoder（TEI reranker）做精排：对 50 个候选重排，取 top-5

这是业界标准 Two-stage retrieval pipeline 模式。

---

## Q5：Citation 阶段在 RAG 中起什么作用？evidenceId 的设计意图是什么？

**答：**

**Citation 的作用：**
1. **格式化 context**：将 ranked chunk 转为 LLM 可用的标准化引用格式（含来源标注），帮助 LLM 生成时明确指明"据此内容"
2. **控制 token 消耗**：snippet-citation 只截取关键片段，减少 context 长度
3. **保留溯源链**：每个 evidence 有 evidenceId，LLM 输出可以包含这些 ID，后端据此追溯到原始 chunk 和文档

**evidenceId 格式：`{documentId}_v{version}_c{chunkIndex}`**

设计意图：
- `documentId`：知道是哪份文档
- `version`：知道是文档的哪个版本（文档更新后旧引用仍可追溯）
- `chunkIndex`：知道是文档中的第几个 chunk

这实现了产品原则中的 **"Evidence first"**：每个生成声明都能回溯到具体的原始文档片段，而不是 LLM 凭空生成。
