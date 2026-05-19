# 面试题 — Filter Stage（feat-004.3）

相关文件：`app/app/api/pipeline/filter/route.ts`

---

## Q1：Filter Stage 在 Retrieval Pipeline 中的位置和职责是什么？为什么不在 retrieval 里直接做？

**答：**

Filter 位于 Retrieval 之后、Rerank 之前。职责：从 topK 召回结果中去掉明显不合格的 chunk，降低后续 Rerank 的处理量和噪声。

**为什么单独一个 stage：**
1. **关注点分离**：Retrieval 只管"找得到"，Filter 管"值不值得用"，Rerank 管"怎么排"
2. **可调试**：Playground 里用户可以看到哪些 chunk 被过滤掉、原因是什么（`removedReasons` 字段）
3. **组合灵活**：score-threshold 和 mmr-diversity 是正交需求，都放进 retrieval 会让参数爆炸

如果直接在 retrieval 里做 score 过滤，用户就看不到"有哪些 chunk 本来召回了但被 filter 掉"，失去可观测性。

---

## Q2：MMR（Maximal Marginal Relevance）算法是什么？本项目用 Jaccard 代替向量余弦的取舍是什么？

**答：**

**MMR 算法：**
```
score_mmr(d) = λ × rel(d, query) - (1-λ) × max_{d'∈S} sim(d, d')
```
每轮从剩余候选中选"和 query 最相关、且和已选集合最不相似"的 chunk，直到达到数量上限。

- λ=1：纯相关性（等同于普通排序）
- λ=0：纯多样性
- λ=0.5：平衡，实践中常用

**用 Jaccard 代替向量余弦的取舍：**

本项目 Filter stage 处理的是已经过 retrieval 的 chunk，**不持有 embedding 向量**（向量存在 PostgreSQL，不随 API response 传递）。若要用余弦相似度，需要重新 embed 所有 chunk——引入额外 API 调用和延迟。

Jaccard 词集相似度 = |A∩B| / |A∪B|，只需要词频统计，零 API 成本。代价是精度稍低（忽略语义），对领域内同义词无法区分。

生产环境可以在 retrieval 时将 embedding 随 chunk 一起返回，Filter 直接用向量余弦做 MMR。

---

## Q3：score-threshold 过滤的 minScore 如何合理设定？有什么风险？

**答：**

**如何设定：**
- 没有通用最优值，依赖 embedding 模型和文档领域
- 实践做法：先用 debug-deterministic（FNV-1a 哈希向量）测试流程，不能用于设定 threshold（随机向量分布与真实 embedding 不同）
- 真实 embedding 时，对代表性 query 查看 score 分布：通常相关 chunk 的余弦相似度在 0.7-0.9，无关 chunk 在 0.3-0.6
- 建议先不设 threshold（或 minScore=0）观察分布，再设

**风险：**
- **太高（如 0.85）**：高精确率但低召回，可能过滤掉真正相关的 chunk（尤其跨语言或同义词场景）
- **太低（如 0.3）**：让噪声 chunk 进入 rerank，增加 LLM hallucination 风险
- **不同 embedding 模型分数范围不同**：从 debug-deterministic 换到 OpenAI 时必须重新调 minScore

---

## Q4：metadata-filter 的 sourceRef 白名单过滤在什么场景下有用？

**答：**

**使用场景：**
1. **多文档混合检索**：上传了产品手册、FAQ、竞品分析三份文档，用户只想在产品手册的某几个章节里检索
2. **章节级访问控制**：某些章节只对特定 query 意图开放（如只有"价格相关"query 才检索"定价"章节）
3. **调试定位**：确认某个特定 sourceRef 路径下的 chunk 是否正确被召回

**本项目实现：**
```typescript
// sourceRef 白名单：只保留路径前缀匹配的 chunk
const allowed = params.allowedSourceRefs; // e.g. ["产品介绍 > 核心功能"]
chunk.sourceRef.startsWith(prefix)
```

前缀匹配而非精确匹配，使"产品介绍 > 核心功能 > 子章节"也能被包含进来。

---

## Q5：Filter Stage 的 removedReasons 字段的设计意图是什么？

**答：**

`removedReasons` 是一个 `{chunkId, reason}[]` 数组，记录每个被过滤掉的 chunk 和过滤原因（如 `"score 0.45 < minScore 0.70"` 或 `"sourceRef not in allowedList"`）。

**设计意图：**

这是 Playground 可调试性原则的直接体现。用户在 UI 里运行 Filter 时，右侧 OutputTracePanel 会同时展示：
- `filteredMatches`：留下的 chunk（用于后续 rerank）
- `removedMatches`：被移除的 chunk 原文
- `removedReasons`：每个 chunk 的移除理由

用户可以立即判断："我的 minScore 设得太高了，把相关内容过滤掉了"——然后调低 minScore 重跑，无需修改代码。

这是 RAG 系统可观测性的核心：**不仅展示结果，也展示被丢弃的内容和原因**。
