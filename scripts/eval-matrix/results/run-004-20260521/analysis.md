# 测试分析报告 — Run 004

**日期**：2026-05-21
**测试文档**：`docs/PRODUCT.md`（约 3500 中文字符，H1/H2/H3 三层结构）
**测试 Query**：Q1 宽泛语义 / Q2 精确关键词 / Q3 语义模糊
**变化**：evaluation scoreThreshold 从 0.5 → **0.2**（适配 cross-encoder rerankScore 范围）
**其他配置**：与 Run-003 完全相同（pipeline-rerank / hybrid-bm25-rrf / pipeline-filter）

---

## 对比表

```
ID   │ Label                        │ hitRate │ citation │ confidence │ retrieved │ avgScore │ cited
T01  │ Run-002 基准                   │ 0.56    │ 0.89     │ 0.44       │ 8.0       │ 0.47     │ 5.7
T02  │ heading-context + pipeline-f │ 0.56    │ 1.00     │ 0.46       │ 8.0       │ 0.48     │ 3.3
T03  │ summary-keywords（新）          │ 0.56    │ 1.00     │ 0.46       │ 8.0       │ 0.48     │ 4.3
T04  │ markdown-heading + summary   │ 0.67 ★  │ 1.00     │ 0.38       │ 4.0       │ 0.49     │ 4.0
T05  │ hybrid-bm25-rrf 基准           │ 0.56    │ 1.00     │ 0.43       │ 8.0       │ 0.03     │ 4.7
T06  │ heading-context + bm25-rrf   │ 0.56    │ 1.00     │ 0.43       │ 8.0       │ 0.03     │ 4.7
T07  │ summary-keywords + bm25-rrf  │ 0.56    │ 0.89     │ 0.42       │ 8.0       │ 0.03     │ 4.7
T08  │ markdown-heading + bm25-rrf  │ 0.67 ★  │ 1.00     │ 0.38       │ 4.0       │ 0.03     │ 4.0
T09  │ filter：score-threshold       │ 0.56    │ 1.00     │ 0.46       │ 8.0       │ 0.48     │ 3.7
T10  │ filter：mmr-diversity         │ 0.56    │ 1.00     │ 0.45       │ 8.0       │ 0.48     │ 4.3
T11  │ query 扩展 + bm25-rrf          │ 0.56    │ 0.89     │ 0.44       │ 8.0       │ 0.03     │ 3.3
T12  │ 全新特性叠加                       │ 0.67 ★  │ 1.00     │ 0.38       │ 4.0       │ 0.03     │ 4.0
```

---

## Run-003 → Run-004 hitRate 变化（scoreThreshold 0.5 → 0.2）

| 配置类型 | Run-003 hitRate | Run-004 hitRate | delta |
|---------|----------------|----------------|-------|
| recursive chunk（T01-T03, T05-T11）| 0.44 | **0.56** | +0.11 |
| markdown-heading chunk（T04, T08, T12）| 0.33 | **0.67** | **+0.33** |

阈值调低让 Q1（宽泛语义 query）从 hitRate=0 → 0.33，原来被错误报告为"检索失败"的配置现在能正常计分。markdown-heading 的提升幅度（+0.33）是 recursive 的三倍，原因见下节。

---

## 核心发现：markdown-heading 在有 Reranker 时反超 recursive

**Run-001（无 cross-encoder reranker）**：markdown-heading hitRate=0.67 < recursive hitRate=0.78，markdown-heading 更差。

**Run-004（有 pipeline-rerank）**：markdown-heading hitRate=0.67 > recursive hitRate=0.56，markdown-heading 更好。

### 原因分析（Q2："产品支持哪些 embedding 和检索方式"）

**recursive chunk（T01）** 的 rerank scores：
```
0.729 → 产品说明 > 阶段1（仅1个chunk高分）
0.105 → 产品说明 > 阶段1（另一片段）
0.098 → 产品说明 > 阶段3
0.047 → 产品说明 > 阶段2
0.016 → 产品说明
```
→ citation 取 top-3：[0.729, 0.105, 0.098]，threshold=0.2 时 **1/3 达标** → hitRate=0.33

**markdown-heading chunk（T04）** 的 rerank scores：
```
0.687 → 产品说明 > 阶段1（完整章节，包含所有技术细节）
0.469 → 产品说明 > 阶段2（完整章节，含 pgvector 等技术栈）
0.024 → 产品说明
0.002 → 产品说明 > 阶段5
```
→ citation 取 top-3：[0.687, 0.469, 0.024]，threshold=0.2 时 **2/3 达标** → hitRate=0.67

**机制**：markdown-heading 按标题边界切分，每个 chunk 包含一个完整的技术章节。Q2 问的是"支持哪些 embedding 和检索方式"，这个信息完整地存在于"阶段1"和"阶段2"两个章节内。cross-encoder 对完整章节的语义理解更准确，给出了 0.687 和 0.469 的高分。recursive 切分则把章节内容打散成多个小片段，每个片段只包含部分信息，cross-encoder 只认出了一个高分片段。

**结论**：对有明确章节结构的文档，当下游有 cross-encoder reranker 时，markdown-heading 的完整性优势会被充分利用。

---

## 其他维度结论（Run-003 结论延续）

### Transform：heading-context ≈ summary-keywords ≈ none（有 reranker 时）

T01（none）= T02（heading-context）= T03（summary-keywords）= 0.56。三种 transform 效果等同。cross-encoder 直接对 query-chunk 对进行语义判断，transform 对 embedding 质量的影响被 reranker 抵消。

### 检索方法：dense-vector ≈ hybrid-bm25-rrf（有 reranker 时）

T01（dense）= T05（bm25-rrf）= 0.56。reranker 对不同检索路径的候选集给出相同质量的筛选结果。

### Filter 策略：无影响

T02（pipeline-filter）= T09（score-threshold）= T10（mmr-diversity）= 0.56。filter 阶段的差异被 pipeline-rerank 截断（top-5）完全覆盖。

---

## 跨 Run 结论汇总（Run-001 ～ Run-004）

| 结论 | 有 reranker 时 | 无 reranker 时 | 置信度 |
|------|--------------|--------------|-------|
| markdown-heading chunk 表现 | **更好**（hitRate 0.67 vs 0.56）| **更差**（0.67 vs 0.78）| 高 |
| heading-context transform 收益 | 无明显收益 | +11% hitRate | 高 |
| dense vs hybrid-bm25-rrf | 无差异 | BM25 刻度不可比 | 高 |
| filter 策略影响 | 无差异 | 无差异 | 高 |
| query 扩展（keyword-expansion）影响 | 无差异 | 无差异 | 高 |

**总结**：reranker 的存在是决定上游配置选择的分水岭。

- **无 reranker**：transform（heading-context）和 chunk 粒度（recursive/512）对召回质量影响显著
- **有 reranker**：chunk 的结构完整性（markdown-heading）成为主要优化方向，transform/filter/retrieval 方法的差异被抹平

---

## 最优配置推荐（基于 Run-001～004 综合）

### 场景 A：有 TEI cross-encoder reranker

```
Chunk:      markdown-heading / headingDepth=2 / chunkSize=1024
Transform:  none（无显著收益，可省略）
Retrieval:  dense-vector 或 hybrid-bm25-rrf（等效）
Filter:     pipeline-filter（无显著差异，选组合过滤以备扩展）
Rerank:     pipeline-rerank（Metadata Boost → TEI Cross-encoder）
Evaluation: scoreThreshold=0.2
```

### 场景 B：无 reranker（仅 score-only 排序）

```
Chunk:      recursive / chunkSize=512 / overlap=64
Transform:  heading-context（+11% hitRate，有效）
Retrieval:  dense-vector
Filter:     mmr-diversity（引用多样性更好）
Rerank:     score-only
Evaluation: scoreThreshold=0.5
```

---

## 指标校准状态

| 指标 | 当前状态 |
|------|---------|
| hitRate（有 reranker）| scoreThreshold=0.2，可用 ✓ |
| hitRate（无 reranker）| scoreThreshold=0.5，可用 ✓ |
| citationCoverage | 短文档仍偏高（多数=1.0），区分度低 |
| confidenceScore | markdown-heading 偏低（0.38 vs 0.45）反映 evidence 尾部质量差，属正常 |
| avgScore | dense=0.47 vs bm25-rrf=0.03，刻度不同，不可横向比较 |
