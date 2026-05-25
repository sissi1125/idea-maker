# 测试分析报告 — Run 005（实际目录 run-007）

**日期**：2026-05-22
**测试文档**：`docs/PRODUCT.md`（约 3500 中文字符，H1/H2/H3 三层结构）
**测试 Query**：6 个（Q1-Q4 沿用前序，Q5/Q6 新增跨章节综合题）
**核心问题**：有 cross-encoder reranker 时，三种 chunk 方法质量是否有稳定差异？

> run-005/run-006 为中途失败的测试（embedding 连接问题），run-007 为完整运行结果。

---

## 对比表

```
ID   │ Label                            │ hitRate │ citation │ confidence │ retrieved │ ms
T01  │ recursive/512（基准）               │ 0.61    │ 1.00     │ 0.50       │ 8.0       │ 287902
T02  │ markdown-heading/1024（章节整块）    │ 0.61    │ 1.00     │ 0.37       │ 4.0       │ 309553
T03  │ markdown-heading-recursive/512   │ 0.61    │ 1.00     │ 0.50       │ 8.0       │ 281408
```

三者平均 hitRate 完全相同，但 per-query 分布差异显著。

---

## Per-query hitRate 明细

| Query | T01 recursive | T02 md-heading | T03 md-heading-rec | 难度 | 特征 |
|-------|-------------|--------------|-------------------|------|------|
| Q1 目标用户是谁，解决什么问题 | 0.33 | 0.33 | 0.33 | 易 | 宽泛语义 |
| Q2 支持哪些 embedding 和检索方式 | 0.33 | **0.67** | 0.33 | 易 | 信息集中于单章节 |
| Q3 如何生成营销内容 idea | 1.00 | 1.00 | 1.00 | 中 | 全配置均命中 |
| Q4 核心设计原则是什么 | 0.33 | 0.33 | 0.33 | 中 | 全配置均未命中 |
| Q5 支持哪些文档格式，如何处理重复导入 | **0.67** | 0.33 | **0.67** | 难 | 信息分散于多章节 |
| Q6 产品分哪些阶段，各阶段目标 | 1.00 | 1.00 | 1.00 | 难 | 全配置均命中 |
| **平均** | **0.61** | **0.61** | **0.61** | | |

---

## 核心发现

### 发现 1：T02（大 chunk）在 Q2 赢、在 Q5 输，两者相互抵消

**Q2（"支持哪些 embedding 和检索方式"）**：所需信息集中在"阶段1"章节内。

T02 rerank scores：[0.687, 0.469, 0.024, 0.002]
→ 2/3 evidence 超过 threshold=0.2 → hitRate=0.67

T01/T03 rerank scores：[0.729, 0.152, 0.105, 0.098, 0.047]
→ 1/3 evidence 超过 threshold → hitRate=0.33

T02 完整章节让 cross-encoder 更容易判断相关性，第二块"阶段2"也因包含完整技术描述获得高分（0.469）。

**Q5（"支持哪些文档格式，如何处理重复导入"）**：所需信息分散在两个独立章节（文档上传章节 + 幂等性章节）。

T01/T03 rerank scores：[0.847, 0.611, 0.051, ...]
→ 2/3 evidence 超过 threshold → hitRate=0.67

T02 rerank scores：[0.775, 0.064, 0.016, ...]
→ 只有 1/3 evidence 超过 threshold → hitRate=0.33

T02 只有 4 个大 chunk，两个章节的信息无法同时进入 top-3 evidence。T01/T03 的 8 个小 chunk 分别覆盖了两个章节。

**结论**：大 chunk 有利于单章节集中查询，小 chunk 有利于跨章节综合查询。对于 PRODUCT.md 这份文档，这两类查询各占一半，最终平均相同。

---

### 发现 2：T03（markdown-heading-recursive）与 T01（recursive）完全等效

**原因**：PRODUCT.md 的绝大多数章节长度均 ≤ 512 字符。

markdown-heading-recursive 的逻辑：
- 章节长度 ≤ chunkSize(512) → 整章保留（等同于 markdown-heading 行为）
- 章节长度 > chunkSize(512) → recursive 语义切分（与 recursive 行为相同）

对于这份文档，recursive fallback 几乎不触发，T03 产出的 8 个 chunk 与 T01 几乎一致，rerank scores 也高度相似。

**markdown-heading-recursive 的优势会在以下文档类型中显现：**
- 长技术文档（章节普遍超过 512 字符）
- 用户手册、API 文档（有标题层级，且内容密集）
- PDF 转换后的 Markdown（段落可能很长）

对于 PRODUCT.md 这类短章节文档，三种方法等效。

---

### 发现 3：confidenceScore 差异反映 evidence 质量分布

T02 的 confidenceScore=0.37，低于 T01/T03 的 0.50。

原因：T02 只有 4 个 chunk，当命中的 chunk 少时，被迫引用低相关性 chunk；T01/T03 有 8 个 chunk，top-3 evidence 中高相关性 chunk 比例更高。

confidenceScore 可以辅助判断 evidence 质量：低于 0.4 说明 retrieved chunks 整体相关性偏低。

---

## 跨 Run 结论汇总（Run-001 ～ Run-005）

### chunk 方法选择指南

| 场景 | 推荐 chunk 方法 | 原因 |
|------|--------------|------|
| 查询集中于单章节（精确问题）| markdown-heading（大 chunk）| 完整章节语义，reranker 易识别 |
| 查询需要跨章节综合（综合问题）| recursive 或 md-heading-recursive | 更多 chunk，覆盖多个信息点 |
| 文档章节普遍 < chunkSize | 三者等效 | md-heading-recursive 的递归降级不触发 |
| 文档章节普遍 > chunkSize | markdown-heading-recursive（首选）| 兼顾章节边界和语义切分 |

### reranker 对 chunk 方法选择的影响（核心结论）

| 状态 | 最优 chunk | 次优 | 说明 |
|------|-----------|------|------|
| 无 reranker | recursive/512 + heading-context | markdown-heading | embedding 质量主导，小 chunk 向量更聚焦 |
| 有 cross-encoder reranker | 取决于查询类型 | — | reranker 对完整语义敏感，大小 chunk 各有适用场景 |

**最重要的结论**：不存在对所有查询类型都最优的单一 chunk 方法。chunk 策略的选择应该基于目标查询的信息分布特征——查询通常集中于单一章节，选大 chunk；查询需要综合多个章节，选小 chunk。

---

## 指标局限性

1. **hitRate 区分度仍然有限**：6 个 query 中 Q3/Q6 全部命中、Q1/Q4 全部不中，只有 Q2/Q5 有差异。有效鉴别力只来自 2 个 query，置信度仍然偏低。

2. **citationCoverage 无区分度**：全部 1.00，短文档依然没有区分信号。

3. **单文档局限**：所有结论仅基于 PRODUCT.md。不同类型文档（长技术文档、FAQ、PDF）可能得出不同结论，特别是对 markdown-heading-recursive 的评估。

---

## 建议的后续方向

1. **换一份长文档**（章节 > 512 字符）重跑 Run-006，验证 markdown-heading-recursive 是否真正优于其他两种方法
2. **增加 query 数量至 15+**，覆盖更多信息分布模式，让 hitRate 均值更稳定
3. **引入 ground truth**（第一类指标），直接标注哪些 chunk 应该被召回，解决"系统自评"的根本局限
