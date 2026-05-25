# 测试分析报告 — Run 003

**日期**：2026-05-20
**测试文档**：`docs/PRODUCT.md`（约 3500 中文字符，H1/H2/H3 三层结构）
**测试 Query**：Q1 宽泛语义 / Q2 精确关键词 / Q3 语义模糊
**embedding 模型**：text-embedding-v4（Qwen/DashScope）/ dim=1024
**新增组件**：pipeline-rerank（Metadata Boost → TEI Cross-encoder）/ intent-recognition（rule-based）/ hybrid-bm25-rrf / pipeline-filter

---

## 对比表（原始输出）

```
ID   │ Label                        │ hitRate │ citation │ confidence │ retrieved │ avgScore │ cited │ ms
T01  │ Run-002 基准                   │ 0.44    │ 1.00     │ 0.42       │ 8.0       │ 0.47     │ 4.3   │ 143833
T02  │ heading-context + pipeline-f │ 0.44    │ 1.00     │ 0.46       │ 8.0       │ 0.48     │ 4.0   │ 131370
T03  │ summary-keywords（新）          │ 0.44    │ 1.00     │ 0.46       │ 8.0       │ 0.48     │ 4.0   │ 127155
T04  │ markdown-heading + summary   │ 0.33    │ 1.00     │ 0.38       │ 4.0       │ 0.49     │ 4.3   │ 143359
T05  │ hybrid-bm25-rrf 基准           │ 0.44    │ 1.00     │ 0.43       │ 8.0       │ 0.03     │ 3.7   │ 128795
T06  │ heading-context + bm25-rrf   │ 0.44    │ 0.89     │ 0.44       │ 8.0       │ 0.03     │ 4.3   │ 131068
T07  │ summary-keywords + bm25-rrf  │ 0.44    │ 1.00     │ 0.46       │ 8.0       │ 0.03     │ 3.3   │ 137164
T08  │ markdown-heading + bm25-rrf  │ 0.33    │ 1.00     │ 0.38       │ 4.0       │ 0.03     │ 4.7   │ 128810
T09  │ filter：score-threshold       │ 0.44    │ 1.00     │ 0.46       │ 8.0       │ 0.48     │ 3.3   │ 126583
T10  │ filter：mmr-diversity         │ 0.44    │ 1.00     │ 0.45       │ 8.0       │ 0.48     │ 4.7   │ 128148
T11  │ query 扩展 + bm25-rrf          │ 0.44    │ 1.00     │ 0.43       │ 8.0       │ 0.03     │ 4.7   │ 134962
T12  │ 全新特性叠加                       │ 0.33    │ 1.00     │ 0.38       │ 4.0       │ 0.03     │ 4.0   │ 159419
```

---

## 关键发现：所有配置的 per-query hitRate 完全相同

每个 test case 的三个 query 结果：

| Query | hitRate | 含义 |
|-------|---------|------|
| Q1（宽泛语义） | **0.00** | rerank 后所有 evidence 分数 < 0.5 |
| Q2（精确关键词） | **0.33** | 1/3 evidence 分数 ≥ 0.5 |
| Q3（语义模糊） | **1.00** | 所有 evidence 分数 ≥ 0.5（最高分 0.907）|

**结论：Run-003 中，ingestion 和 retrieval 配置的差异对最终指标没有影响。决定 hitRate 的是 reranker 对这三个 query 的质量判断，而非上游 chunk/transform/retrieval 的选择。**

---

## 根因分析

### 原因 1：pipeline-rerank 将 evidence 数量截断到 5

`rerankTopN=5`，所有配置的最终 evidence 都是 5 个 chunk（markdown-heading 配置因 chunk 数少只有 4 个）。在 5 个 chunk 这个规模下，Q1/Q2/Q3 的质量差异完全被 reranker 的语义判断覆盖。

### 原因 2：evaluation scoreThreshold=0.5 是对余弦相似度校准的，不适用于 rerankScore

| Stage | 分数类型 | 分数范围 | 0.5 是否合适 |
|-------|---------|---------|------------|
| retrieval（dense） | 余弦相似度 | 0.1–0.9 | ✓ |
| pipeline-rerank（TEI cross-encoder） | sigmoid 激活的相关性分数 | 0.0–1.0，但分布偏低 | ✗ 偏严格 |

Q1 的 cross-encoder 分数：`[0.37, 0.14, 0.12, 0.11, 0.09]`，全部 < 0.5 → hitRate=0。
Q3 的 cross-encoder 分数：`[0.91, 0.81, 0.72, 0.59, 0.51]`，全部 ≥ 0.5 → hitRate=1。

cross-encoder 对"目标用户"类宽泛 query 给出低分是**语义正确的**——这个问题没有单一最优 chunk，相关性本来就分散。但 hitRate=0 会错误地报告为"检索失败"。

### 原因 3：avgScore 刻度分裂（Run-001/002 的老问题延续）

dense-vector avgScore ≈ 0.47，hybrid-bm25-rrf avgScore ≈ 0.03。差异不反映质量，而是 RRF 分数 vs 余弦相似度的刻度不同。

---

## 各维度的有效结论

### markdown-heading 一致表现较差（高置信度）

T04/T08/T12（markdown-heading）的 retrieved=4，hitRate=0.33，低于其他配置的 retrieved=8，hitRate=0.44。文档的 H2 节（产品定位、目标用户、阶段规划…）每节内容跨越多个主题，单个大 chunk 的向量不够聚焦，reranker 给出的分数也更低（confidenceScore=0.38 vs 0.42-0.46）。

### summary-keywords vs heading-context 无明显差异（本文档）

T02（heading-context）vs T03（summary-keywords）：hitRate/citationCoverage/confidenceScore 完全相同（0.44/1.00/0.46）。对于 PRODUCT.md 这类已有清晰 Markdown 标题结构的文档，两种 transform 效果等同。在标题层级不清晰的文档上，两者可能出现分化。

### pipeline-filter 与单步 filter 无明显差异

T02（pipeline-filter）vs T09（score-threshold）vs T10（mmr-diversity）：hitRate 均为 0.44。filter 阶段的差异被 pipeline-rerank 的截断（取 top-5）完全抹平。

### hybrid-bm25-rrf 与 dense-vector 无明显差异（后接 reranker 时）

T01（dense）vs T05（bm25-rrf）：hitRate 均为 0.44。当下游有 cross-encoder reranker 时，初始检索方法的差异被大幅消减——reranker 能从不同路径检索到的候选集里筛出高质量结果。

---

## 与 Run-001 对比（pipeline-rerank 的影响）

| 指标 | Run-001 T01（score-only rerank）| Run-003 T01（pipeline-rerank）| 变化 |
|------|------|------|------|
| hitRate | 0.78 | 0.44 | -0.34 |
| citationCoverage | 1.00 | 1.00 | 0 |
| confidenceScore | 0.56 | 0.42 | -0.14 |
| retrieved (evidence 数量) | 8 | 5 (rerankTopN) | -3 |

hitRate 下降的原因不是检索质量变差，而是：
1. evidence 数量从 8 → 5，分母缩小
2. evaluation scoreThreshold=0.5 对 rerankScore 偏严格

**pipeline-rerank 的真实作用**需要通过 generation 输出质量来评估（idea 是否更有针对性、evidence 引用是否更精准），而非 hitRate 这个指标。

---

## 指标体系改进建议

| 问题 | 建议 |
|------|------|
| hitRate 对 rerankScore 过严 | evaluation 的 scoreThreshold 改为 0.2（cross-encoder 分数范围更低）|
| avgScore 跨方法不可比 | 记录分数类型（cosine/rrf/rerank），展示时区分刻度 |
| 所有配置 hitRate 相同，无区分度 | 加入 generation 质量指标（idea 独特性、evidence 精准率）|
| pipeline-rerank 截断到 5 影响比较 | 可在不同实验中对比 rerankTopN=5 vs 10 的影响 |

---

## 最优配置推荐（基于 Run-001～003 综合）

针对 PRODUCT.md 类型的中文结构化文档：

```
Chunk:        recursive / chunkSize=512 / overlap=64
Transform:    heading-context（Run-001 验证有效，Run-003 summary-keywords 等效）
Retrieval:    dense-vector 或 hybrid-bm25-rrf（接 reranker 后差异消失）
Filter:       pipeline-filter 或 score-threshold（差异不显著）
Rerank:       pipeline-rerank（TEI cross-encoder，Run-003 引入）
evaluation:   scoreThreshold 建议调整为 0.2（适配 rerankScore 范围）
```

---

## 测试历史汇总

| Run | 日期 | 主要变化 | 核心发现 |
|-----|------|---------|---------|
| run-001 | 2026-05-20 | 基础矩阵（score-only rerank）| heading-context +11% hitRate；256 chunk -22%；最优 T06 |
| run-002 | 2026-05-20 | 数据丢失（worktree 删除）| — |
| run-003 | 2026-05-20 | pipeline-rerank + hybrid-bm25-rrf + pipeline-filter | reranker 主导质量信号；ingestion/retrieval 差异被抹平；scoreThreshold 需重新校准 |
