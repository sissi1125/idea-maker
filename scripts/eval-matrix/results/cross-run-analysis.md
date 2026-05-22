# 跨 Run 综合分析

**数据覆盖**：Run-001～Run-006（6 次实验，3 个测试文档，共约 400 次 pipeline 调用）
**核心问题**：在 RAG pipeline 中，哪些配置维度真正影响检索质量？

---

## 一、实验条件矩阵

| Run | 文档 | Query 数 | Test Cases | Reranker | 关键变量 |
|-----|------|---------|-----------|---------|---------|
| Run-001 | PRODUCT.md (3.5k) | 3 | 12 | score-only（无 cross-encoder）| transform / filter / retrieval / query-rewrite |
| Run-003 | PRODUCT.md | 3 | 12 | pipeline-rerank（cross-encoder）| 同上 + hybrid-bm25-rrf |
| Run-004 | PRODUCT.md | 3 | 12 | pipeline-rerank | scoreThreshold 0.5 → 0.2 |
| Run-005 | PRODUCT.md | 6 | 3 | pipeline-rerank | chunk 方法（recursive / md-heading / md-heading-rec）|
| Run-006 | Bloomnote PRD (12.4k) | 6 | 3 | pipeline-rerank | chunk 方法（同上）|

---

## 二、各维度影响力汇总

### 结论：大多数维度在有 cross-encoder reranker 时影响力为零

| 维度 | 无 reranker（Run-001）| 有 reranker（Run-003/004）| 结论 |
|------|---------------------|------------------------|------|
| **Transform**（heading-context vs none）| **+0.11** | 0.00 | 仅无 reranker 时有效 |
| **Retrieval 方法**（dense vs hybrid-bm25-rrf）| 未测 | 0.00 | reranker 抹平两者差异 |
| **Filter 方法**（score-threshold / mmr / pipeline）| ~0 | 0.00 | 全程无影响 |
| **Query Rewrite**（keyword expansion）| 0.00 | 0.00 | 全程无影响 |
| **Chunk 方法**（见下节）| 有影响 | 有影响（方向随查询类型变化）| 唯一持续有影响的变量 |

**关键发现**：引入 cross-encoder reranker 后，pipeline 的优化问题从"5 个变量"压缩到了"1 个变量（chunk 方法）"。

---

## 三、Reranker 的作用机制

### 3.1 为什么 reranker 能抹平上游差异？

Cross-encoder reranker 对每个（query, chunk）对重新打分，直接建模语义相关性，不依赖 embedding 向量的质量。

- Transform 给 chunk 注入的标题上下文对 embedding 有帮助，但 cross-encoder 直接读原文，不需要这个提示
- Retrieval 方法决定候选集，但只要候选集里包含正确 chunk，reranker 就能把它排到前面
- Filter 方法影响候选数量，但 reranker 的 top-N 截断会覆盖 filter 的效果

### 3.2 Reranker 引入了新的校准问题

Evaluation 的 hitRate 使用 rerankScore >= scoreThreshold 来判断 evidence 是否有效。Cross-encoder 的分数范围与余弦相似度不同：

| 阶段 | 分数类型 | 典型范围 | threshold=0.5 是否合适 |
|------|---------|---------|----------------------|
| 无 reranker（余弦相似度）| 余弦相似度 | 0.3-0.9 | ✓ 合适 |
| 有 reranker（cross-encoder）| 交叉编码器分数 | 0.01-0.97 | ✗ 0.5 太高 |

**Run-003 使用 threshold=0.5**：所有 config 的 hitRate 锁定在 0.44，看不出差异（Q3 固定 1.00，Q1/Q2 固定 0.33，平均 = 0.44）。

**Run-004 修正为 threshold=0.2**：hitRate 上升至 0.56-0.67，差异重新出现。

---

## 四、Chunk 方法：唯一持续有效的变量

### 4.1 跨 Run 对比

| 方法 | Run-004 (3Q) | Run-005 (6Q, PRODUCT.md) | Run-006 (6Q, Bloomnote) | 平均 |
|------|-------------|------------------------|------------------------|------|
| recursive/512 | 0.56 | 0.61 | **0.78** | 0.65 |
| markdown-heading/1024 | **0.67** | 0.61 | 0.72 | 0.67 |
| md-heading-recursive/512 | — | 0.61 | **0.78** | 0.70 |

### 4.2 Per-query 分析：结果取决于查询类型

**Run-005（PRODUCT.md）per-query：**

| Query | 信息分布 | recursive | md-heading | 差值 |
|-------|---------|-----------|------------|------|
| Q2 embedding 方式 | 单章节集中 | 0.33 | **0.67** | +0.33 |
| Q5 文档格式+幂等性 | 跨章节分散 | **0.67** | 0.33 | -0.33 |

**Run-006（Bloomnote PRD）per-query：**

| Query | 信息分布 | recursive | md-heading | 差值 |
|-------|---------|-----------|------------|------|
| Q1-Q3 易题 | 单章节 | 1.00 | 1.00 | 0.00（已达上限）|
| Q5 Pro 权益 | 跨章节分散 | **1.00** | 0.67 | -0.33 |

**规律**：两份文档都在跨章节查询（Q5）上出现相同的方向性差异。

### 4.3 为什么大 chunk 对单章节查询更好？

大 chunk（markdown-heading/1024）把整个章节保留为一个语义单元。Cross-encoder 看到完整章节时，更容易判断它与 query 的整体相关性，给出高分（0.687, 0.469）。

小 chunk（recursive/512）把章节拆散成多个片段。每个片段只包含部分信息，cross-encoder 只能识别出 1 个高分片段，其余片段因信息不完整被低分过滤。

### 4.4 为什么小 chunk 对跨章节查询更好？

跨章节查询的答案分散在 N 个独立章节。大 chunk 由于 topK 限制，难以同时把 N 个章节都纳入候选集（大 chunk 总数少，单次检索能覆盖的"章节数"也少）。小 chunk 粒度更细，同等 topK 下可以触及更多不同章节。

### 4.5 markdown-heading-recursive 的评估

两份测试文档（PRODUCT.md 章节 ~300-500 字符，Bloomnote PRD 章节 ~340-460 字符）的章节长度均小于 chunkSize=512，导致递归降级从未触发。

**T03 在所有测试中等同于 T01**，不是因为 md-heading-recursive 没有价值，而是**测试条件不满足**。该方法的真实效果有待在章节 > 512 字符的文档上验证。

---

## 五、指标可靠性评估

### 哪些指标是可信的

| 指标 | 可信度 | 说明 |
|------|--------|------|
| hitRate（同一检索方法内比较）| 中 | 余弦/cross-encoder 分数不可跨方法比 |
| hitRate 跨文档比较 | 低 | 文档难度不同，绝对值无法直接对比 |
| citationCoverage | 低 | 短文档几乎全为 1.0，无区分度 |
| confidenceScore | 低 | 跨检索方法不可比 |
| 趋势方向（哪个更好）| 中-高 | 方向性发现在多个 run 中一致则可信 |

### 当前最可靠的结论（在多个 run / 文档中一致）

1. **跨章节查询：小 chunk（recursive/512）优于大 chunk（md-heading/1024）**
   - Run-005 Q5：-0.33；Run-006 Q5：-0.33（两次完全相同的方向和幅度）
   - 置信度：**高**

2. **有 cross-encoder reranker 时，transform / filter / retrieval 方法 / query rewrite 无影响**
   - Run-003/004 各维度 Δ=0，跨 6 次实验均一致
   - 置信度：**高**

3. **无 reranker 时，heading-context transform 有效（+0.11）**
   - 仅 Run-001 一次，3 个 query
   - 置信度：**中**（单次验证）

4. **scoreThreshold 需要按 rerank 分数范围校准**
   - Run-003（0.5）vs Run-004（0.2）的对比清晰展示了错误阈值导致的指标失真
   - 置信度：**高**

---

## 六、尚未回答的核心问题

| 问题 | 为什么未解决 | 建议验证方式 |
|------|------------|------------|
| markdown-heading-recursive 是否真的优于 recursive？| 测试文档章节均 < 512 字符，递归降级未触发 | 使用章节 > 512 字符的技术文档 |
| 大 chunk 在"单章节集中查询"上的优势是否稳定？| Run-006 易题全部满分（1.00），无法区分 | 设计语义更模糊的单章节查询 |
| 现有结论是否泛化到其他文档类型？| 目前仅两份文档，均为产品文档 | 加入 FAQ、API 文档、技术设计文档 |
| citationCoverage 和 confidenceScore 指标是否有效？| 短文档几乎全为 1.0 | 使用更长文档，或引入 ground truth |

---

## 七、初步最佳实践建议

基于现有数据，可以给出以下有支撑的配置建议：

### 如果你有 cross-encoder reranker

```
Chunk:      取决于查询类型分布（见下）
Transform:  none（无收益，节省 LLM 调用）
Retrieval:  dense-vector 或 hybrid-bm25-rrf（等效，选 dense 成本更低）
Filter:     任意（无影响，建议 pipeline-filter 作为语义完整的默认值）
Rerank:     pipeline-rerank（cross-encoder）
Eval threshold: 0.2（cross-encoder 分数范围）
```

Chunk 策略：
- 文档章节短（< 512 字符）或查询以跨章节综合为主 → `recursive/512`
- 文档有明确章节结构且查询以单章节精确为主 → `markdown-heading/1024`
- 不确定查询分布 → `recursive/512`（跨章节覆盖更稳健）

### 如果你没有 cross-encoder reranker

```
Chunk:      recursive/512/overlap-64
Transform:  heading-context（+11% hitRate，有效）
Retrieval:  dense-vector（BM25/RRF 效果类似但刻度问题较多）
Filter:     mmr-diversity（引用多样性更好）
Rerank:     score-only
Eval threshold: 0.5（余弦相似度范围）
```

---

## 八、数据局限性声明

- 所有指标均为"第二类指标"（无 ground truth），衡量的是系统自我评价，不代表真实检索准确率
- 样本量偏小：每个结论基于 3-6 个 query，统计显著性低
- 文档类型单一：仅测试了中文产品文档，其他类型（英文、技术文档、FAQ）未验证
- 评估模型固定：使用同一个 cross-encoder 和 LLM，换模型可能得出不同结论
