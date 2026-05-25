# Run-009 分析报告（实验目录：run-016-20260522）

**日期**：2026-05-22  
**前置条件**：feat-009 库标准化已合并（jieba 分词、stopword 内联、`maxPerDocument` bug fix）  
**目标**：验证 jieba 修复后 pipeline-rerank 是否真的优于纯 hf-tei-rerank，并测试 `boostPassN` 截断策略的边界

---

## 结果汇总

| | T01 score-only | T02 pure bge | T03 pipeline boostPassN=20 | T04 pipeline boostPassN=3 |
|---|---|---|---|---|
| hitRate | **0.889** | 0.722 | 0.722 | **0.667 ↓** |
| citationCoverage | 0.889 | 1.000 | 1.000 | 1.000 |
| confidenceScore | 0.606 | 0.582 | 0.582 | 0.520 |

### Per-query hitRate

| Query | T01 | T02 | T03 | T04 |
|-------|-----|-----|-----|-----|
| Q1 块式编辑器 | 1.00 | 0.67 | 0.67 | 0.67 |
| Q2 导出格式 | 1.00 | 1.00 | 1.00 | 1.00 |
| Q3 系统入口 | 1.00 | 1.00 | 1.00 | 1.00 |
| Q4 设计风格 | 0.67 | 0.33 | 0.33 | 0.33 |
| Q5 免费vs Pro | 1.00 | 1.00 | 1.00 | **0.67** |
| Q6 数据存储 | 0.67 | 0.33 | 0.33 | 0.33 |

---

## 三个核心发现

### 发现 1：T03 完全 = T02（per-query 也完全一致）

预测命中。`boostPassN=20 > 候选数 5`，所有 chunk 都进入 bge，boost 排序对 bge 的独立打分无任何影响。**架构限制确认**。

### 发现 2：T04 Q4 没有改善（仍 0.33）—— 预测被证伪

**预测**：boostPassN=3 排除 `导航`（不相关），Q4 hitRate ↑ 至 0.67-1.00  
**实际**：Q4 hitRate 仍为 0.33，T04 输出包含 `导航`

**根因（关键）**：`feat-009` 修复 `filterCombined` 的 `maxPerDocument` bug 后，单文档（Bloomnote PRD）下 filter 只输出 **5 个 chunk，不是 pre-analysis 假设的 10 个**。

| 预分析（基于 10 个 chunk）| 实际（5 个 chunk）|
|--------------------------|-------------------|
| 1. 色彩方案 0.603 | 1. 色彩方案 0.602 |
| 2. 字体布局 0.565 | 2. 字体布局 0.530 |
| 3. **个性化 0.539** | 3. **导航 0.502** ← bad chunk 没被截断 |
| 4. **导航 0.502** ← 预期被 boostPassN=3 截断 | 4. 个性化 0.491 |
| 5. ... | 5. Q&A 0.428 |

候选集从 10 个缩到 5 个后，原本排在第 6-10 名的低余弦分 chunk 消失，**`导航` 的相对位置反而上升到 boost 排名第 3**，落在 boostPassN=3 内，送入 bge 后被打回 rank1（0.821），其他两个相关 chunk 分别只有 0.011 / 0.002，全部 < threshold 0.2。

**Q6 同样情况**：`业务规则与校验` 余弦分 0.480 也太高，无法被 boost 排到 top-3 之外。

### 发现 3：T04 Q5 反而变差（1.00 → 0.67）—— 紧截断的副作用

| | bge 输入（5 个）| bge 输出 top-3 | hitRate |
|---|---|---|---|
| T02 | 全部 5 个 | 通知行为(0.764)、订阅升级(0.745)、业务规则(0.633) — 3 个 ≥ 0.2 | **1.00** |
| T04 | boost top-3：产品概念、业务规则、订阅升级 | 通知行为(0.764)、订阅升级(0.745)、产品概念(0.127) — 2 个 ≥ 0.2 | **0.67** |

T04 把 `通知与后台产品行为` 截断了（boost rank5），但**它实际上是 Q5 最相关的 chunk**（bge 打 0.764）。boost 关键词匹配在它身上失败，因为 Q5 的关键词（免费/Pro/权益）出现在 chunk text 内但不在 sourceRef 里，而 `通知行为` 的 text 包含 `用户/功能` 等较弱信号。

---

## 综合结论

### Run-009 三个假设的最终判定

| 假设 | 预测 | 实际 | 判定 |
|------|------|------|------|
| H1: T03 = T02（架构限制）| 完全相同 | 完全相同 | ✅ **证实** |
| H2: T04 Q4 改善 | 0.33 → 0.67+ | 0.33 → 0.33 | ❌ **证伪** |
| H3: pipeline-rerank 可超过 pure bge | T04 > T02 | T04 (0.67) < T02 (0.72) | ❌ **证伪** |

### 真正的发现

**Metadata Boost 在单文档 RAG 场景下无法挽救 cross-encoder 的语义错误**，原因有二：

1. **boost 修正力度不足**：boost 最大 +0.2 × (hits/total)（约 +0.05-0.07），无法翻转 cross-encoder 的 winner-take-all 分数（0.821 vs 0.011，差 0.81）

2. **boostPassN 截断有副作用**：
   - 紧截断（=3）会误伤"sourceRef 无关键词但 chunk text 强相关"的 chunk（Q5 案例）
   - 松截断（=20）等于不截断，boost 完全失效

**pipeline-rerank 的有效场景**（推测，未验证）：
- 多文档场景（filter 输出 10 个来自多个文档的 chunk，截断空间大）
- sourceRef 与 query 词汇高度匹配的场景（如 FAQ、目录式文档）
- bge 分数分布相对平滑的场景（避免 winner-take-all）

---

## 工程教训

### 1. 实验预分析必须基于真实 pipeline 行为

Run-009 的 pre-analysis 基于 Run-008 的 10-chunk 假设，但同时进行的 `filterCombined` bug fix 把候选数缩到 5。**实验设计与代码修改并行时，必须重新建立基线**。

### 2. `maxPerDocument` 在单文档场景下是个尴尬约束

参数本意是"防止某一文档主导结果"，但 RAG playground 测试时通常只有 1 个文档。`maxPerDocument=5` 让单文档可贡献的 chunk 上限永远是 5，`finalTopK=10` 永远只是名义上限。

建议：未来测试增加多文档语料，或在 playground 增加自适应逻辑（单文档时禁用 maxPerDocument）。

### 3. Cross-encoder 的极度集中分布是结构性问题

bge-reranker-v2-m3 给 Q4 `导航` 打 0.821，给真正相关的 `色彩方案` 打 0.011，差距 75 倍。这不是 boost 能弥补的。

**Run-008 的结论再次得到确认**：在中文产品文档场景下，**score-only**（0.889）和 **LLM reranker**（0.94）仍是 hitRate 最高的两个方案，bge 类 cross-encoder 不论搭配什么策略都跑不过它们。

---

## Cross-Run 更新

| 结论 | 之前置信度 | 现在 |
|------|-----------|------|
| pipeline-rerank 比 pure bge 更好 | 假设未验证（Run-008 bug 导致 T03=T02）| ❌ **证伪**（Run-009 在修复 jieba 后，T03 仍 = T02，T04 反而更差）|
| boostPassN 紧截断能排除错误 chunk | 假设（Run-008 后提出）| ❌ **证伪**（单文档场景下副作用更大）|
| bge cross-encoder domain mismatch 不可修复 | 高（Run-007/008）| ✅ **再次确认**（Run-009 即使加 boost 也无效）|

---

## 下一步建议

1. **关闭 pipeline-rerank 优化探索**：在中文产品文档场景下，已确认这条路走不通
2. **生产配置**：维持 Run-008 结论
   - 实时场景：`score-only`，threshold=0.5（hitRate 0.89）
   - 离线/质量优先：`llm-relevance-rerank`（Qwen），threshold=0.5（hitRate 0.94）
3. **后续实验方向**：
   - 多文档语料下重新测试 pipeline-rerank（boostPassN 真正能发挥过滤作用的场景）
   - LLM reranker 用 `qwen-turbo` 降延迟，测试是否能用在准实时场景
