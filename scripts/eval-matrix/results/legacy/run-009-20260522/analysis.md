# 测试分析报告 — Run 007

**日期**：2026-05-22
**实验设计**：2×2 因子实验（Transform × Reranker）
**测试文档**：Bloomnote PRD（12,358 字符）
**核心问题**：
1. pipeline-rerank（cross-encoder）真的提升了 hitRate 吗？
2. heading-context transform 在无 reranker 时有效的结论（Run-001）是否可复现？

---

## 对比表

```
          │ 无 transform          │ 有 transform（heading-context）
──────────┼───────────────────────┼──────────────────────────────────
无 reranker│ T01: hitRate=0.89     │ T02: hitRate=0.83
          │ (score-only, th=0.5)  │ (score-only, th=0.5)
──────────┼───────────────────────┼──────────────────────────────────
有 reranker│ T03: hitRate=0.78     │ T04: hitRate=0.78
          │ (pipeline-rerank,th=0.2)│(pipeline-rerank, th=0.2)
```

**因子效果：**

| 维度 | 效果 | 说明 |
|------|------|------|
| Reranker（T01→T03）| **−0.11** | 有 reranker 反而更差 |
| Transform（T01→T02）| −0.06 | 略微变差（但见下文分析） |
| Transform × Reranker 交互 | 0.00 | T03=T04，有 reranker 时无影响 |

---

## Per-query 明细

| Query | T01 | T02 | T03 | T04 | 有无差异 |
|-------|-----|-----|-----|-----|---------|
| Q1 块式编辑器 | 1.00 | 1.00 | 1.00 | 1.00 | = |
| Q2 导出格式 | 1.00 | 1.00 | 1.00 | 1.00 | = |
| Q3 系统入口 | 1.00 | 1.00 | 1.00 | 1.00 | = |
| Q4 设计风格与主题色 | **0.67** | 0.33 | 0.33 | 0.33 | △ |
| Q5 免费 vs Pro | 1.00 | 1.00 | 1.00 | 1.00 | = |
| Q6 数据存储与后台 | **0.67** | **0.67** | 0.33 | 0.33 | △ |
| **平均** | **0.89** | **0.83** | **0.78** | **0.78** | |

差异只来自 Q4 和 Q6。

---

## 核心发现 1：pipeline-rerank 比 score-only 表现更差（−0.11）

这是本次最意外的结论。Cross-encoder reranker 在 Q4 和 Q6 上犯了明显的语义错误：

**Q4（"产品的整体设计风格和主题色方案是什么？"）**

| 方法 | top 命中 | score | 是否相关 |
|------|---------|-------|---------|
| score-only | 色彩方案 | 0.536 | ✓ 直接答案 |
| pipeline-rerank | **导航与信息架构** | **0.901** | ✗ 与设计风格无关 |

cross-encoder 把"导航与信息架构"打了 0.901 的高分，但这个章节讲的是 App 的页面层级结构，不是设计风格。真正含有颜色/主题信息的"色彩方案"章节只得到 0.024 分。Qwen text-embedding-v4 的余弦相似度则正确识别"色彩方案"（0.536）为最相关的 chunk。

**Q6（"用户数据如何存储与同步，后台有哪些自动行为？"）**

| 方法 | evidence | 分数 | threshold | 是否命中 |
|------|---------|------|-----------|---------|
| score-only | 通知与后台产品行为 | 0.504 | 0.5 | ✓ |
| score-only | 产品概念与业务对象 | 0.500 | 0.5 | ✓ |
| pipeline-rerank | **业务规则与校验** | **0.650** | 0.2 | ✓（但非最优）|
| pipeline-rerank | 通知与后台产品行为 | **0.173** | 0.2 | ✗（低于 threshold）|

cross-encoder 把"业务规则与校验"排到第一（0.650），把直接包含后台行为信息的"通知与后台产品行为"降到 0.173，低于 threshold=0.2 而被计为未命中。

**根本原因：任务分布不匹配（Domain Mismatch）**

需要纠正一个误解：bge-reranker-base 是 BAAI（北京智源人工智能研究院）出品的中英双语模型，不是英文专用模型。问题不在语言，而在**训练任务与当前文档类型的差距**：

- bge-reranker-base 的训练数据以 QA 检索任务为主（MSMARCO、DuReader 等），这类数据中 query 和 passage 的相关性通常比较明确
- 产品文档查询（"整体设计风格是什么"）语义较模糊，query 中的关键词（"整体"、"风格"）在文档多个章节中都有弱相关，cross-encoder 难以准确区分
- cross-encoder 的分数分布极度集中（top-1 得 0.9+，其余 <0.03），对产品文档这类"答案分散在多个章节"的场景不友好

相比之下，Qwen text-embedding-v4 的余弦相似度分布更平滑（0.46-0.54），在多个相关章节上都能给出合理的分数，threshold=0.5 时能选出 2/3 的有效 evidence。

**结论**：当前场景下 cross-encoder reranker 比 score-only 更差，根本原因是 domain mismatch，不是语言问题。Reranker 的价值取决于模型是否与目标文档类型和查询风格匹配，不是引入 cross-encoder 就一定更好。

---

## 核心发现 2：Transform 效果无法复现，Run-001 结论存疑

Run-001 结论：heading-context transform +0.11（0.78→0.89）
本次结论：heading-context transform −0.06（0.89→0.83）

差异完全来自 Q4 这一个 query：

| | 色彩方案 score | 导航与信息架构 score | hitRate |
|---|---|---|---|
| T01（无 transform）| 0.536 ✓ | 0.502 ✓（≥0.5）| 0.67 |
| T02（有 transform）| 0.523 ✓ | **0.496** ✗（<0.5）| 0.33 |

heading-context transform 给 chunk 注入了标题路径，轻微改变了 embedding，使"导航与信息架构"的余弦相似度从 0.502 降到了 0.496，刚好跌过 threshold=0.5 的边界。**这 0.006 的分差就是本次 transform 效果的全部来源。**

这是一个阈值边界效应，不是真实的语义质量差异。如果 threshold=0.49，T02 和 T01 完全相同。

**Run-001 transform 结论的重新评估**：
- Run-001 基于 PRODUCT.md（不同文档）+ 3 个 query + threshold=0.5
- 本次基于 Bloomnote PRD + 6 个 query + threshold=0.5
- 两次结论方向相反，且都只受 1-2 个 query 的边界效应驱动
- **Run-001 的 +0.11 transform 发现不可靠，不应作为最佳实践依据**

---

## 核心发现 3：Transform × Reranker 无交互效应（T03=T04）

有 cross-encoder reranker 时，transform 对 hitRate 没有影响（0.78=0.78）。
这和 Run-003/004 的结论一致，置信度高。

---

## 跨 Run 结论更新

| 结论 | 之前状态 | 本次更新 |
|------|---------|---------|
| heading-context transform 在无 reranker 时有效 | 中置信（单次 Run-001）| **低置信**（本次反向，均为边界效应）|
| 有 reranker 时 transform 无效 | 高置信（Run-003/004）| **高置信**（再次确认）|
| pipeline-rerank 提升检索质量 | 假设未验证 | **证伪**：在中文文档上 score-only 更好（bge-reranker-base 语义错误）|

---

## 实践建议修订

**关于 reranker 的选择**：

Cross-encoder reranker 不是万能的。在中文 RAG 场景下：
- bge-reranker-base 以英文为主，对中文文档语义理解有偏差
- 如果使用 reranker，应选择中文优化的模型，例如：
  - `BAAI/bge-reranker-v2-m3`（多语言版本）
  - `maidalun1020/bce-reranker-base_v1`（中文优化）
  - Qwen 系列的 reranker（如果可用）
- **在验证 reranker 质量之前，score-only 可能是更安全的选择**

**关于 transform 的选择**：

目前没有足够可靠的证据支持 heading-context transform 带来稳定收益。可以暂时设为 `none`，等有更多数据再决定。

---

## 实验局限性

1. **threshold 不统一**：T01/T02 用 0.5（cosine），T03/T04 用 0.2（cross-encoder），绝对值不可直接比较，但方向性结论（reranker 使 Q4/Q6 从 0.67 降到 0.33）是可信的
2. **只有 2 个 query 有差异**（Q4/Q6），样本量仍然偏小
3. **仅测试一个 reranker 模型**（bge-reranker-base）；换中文优化模型可能得到不同结果
