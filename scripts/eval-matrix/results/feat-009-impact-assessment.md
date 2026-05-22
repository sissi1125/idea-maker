# feat-009 对历史测试结果的影响评估

**评估日期**：2026-05-23  
**关联**：`docs/feat-009_lib-standardization.md`  
**问题来源**：全局代码审计（2026-05-23）发现 9 处手写实现缺陷

---

## 评估方法

对每个发现的 bug，判断：
1. 它影响哪些 Run 的哪些 Test Case
2. 影响方向：是否让所有配置均等受损（相对比较仍有效）还是只影响某些配置（比较结论失效）
3. 是否需要重新测试

---

## Bug-by-Bug 影响分析

### Bug 1：Metadata Boost tokenizer 失效（空格切分 → boost 恒为 0）

| 项目 | 内容 |
|------|------|
| 影响方法 | `metadata-boost`、`pipeline-rerank` |
| 影响 Run | **Run-008 T03**（pipeline-rerank / bge-v2-m3）|
| 影响程度 | **致命**：T03 的 Metadata Boost 完全未生效，等价于纯 `hf-tei-rerank`（T02）|
| 对结论的影响 | Run-008 结论"pipeline-rerank 无增量"是 **bug 导致的假象**，不是真实的架构结论 |
| 其他 Run | Run-001～007 均未使用 `pipeline-rerank`，不受影响 |
| **需要重测** | **是** — 需要 Run-009 验证 jieba 修复后 pipeline-rerank 的真实效果 |

### Bug 2：llm-relevance-rerank 静默失败（warnings 作用域错误 + model 参数缺失）

| 项目 | 内容 |
|------|------|
| 影响方法 | `llm-relevance-rerank` |
| 影响 Run | **Run-008 T04 原始数据**（已作废，已用 run-014 重跑替换）|
| 影响程度 | **致命**：T04 所有分数 ≡ T01（余弦分），数据无效 |
| 已修复 | ✅ run-014-20260522 是有效数据，已合并到 run-008-reranker/ |
| 对结论的影响 | Run-008 最终结论基于修复后数据，**有效** |
| **需要重测** | **否**（已完成 run-014）|

### Bug 3：手写中文 BM25（bigram 分词 + IDF 只计算候选集）

| 项目 | 内容 |
|------|------|
| 影响方法 | `hybrid-bm25-rrf` 检索 |
| 影响 Run | **Run-003**（使用 `hybrid-bm25-rrf` 的配置组合）|
| 影响程度 | **中等**：BM25 分数质量下降，但 RRF 融合后影响被稀释 |
| 对结论的影响 | Run-003 结论是"dense-vector 与 hybrid-bm25-rrf 效果相当"——bigram BM25 质量低，本该表现更差却表现相当，说明 **dense > hybrid** 的可能性被低估了；但"reranker 抹平两者差异"的核心结论不受影响 |
| **需要重测** | **可选**：若需精确比较 dense vs hybrid，需用 jieba 修复后的 BM25 重测；当前结论保守有效 |

### Bug 4：三份独立停用词表（内容发散）

| 项目 | 内容 |
|------|------|
| 影响方法 | `heading-context` transform、`keyword-expansion` query-rewrite |
| 影响 Run | Run-001（transform 对比）、Run-003/004（query-rewrite 对比）|
| 影响程度 | **轻微**：停用词表较小（~40词），三者差异仅在几个词，对关键词覆盖率影响 < 5% |
| 对结论的影响 | Run-001 的 transform +0.11 已被 Run-007 证伪为边界效应；Run-003/004 的 query-rewrite 无效结论在多次实验中一致。停用词差异不改变这些结论 |
| **需要重测** | **否** |

### Bug 5：`chars/4` 估算 token 数

| 项目 | 内容 |
|------|------|
| 影响方法 | chunk overlap 计算、prompt-build context 截断 |
| 影响 Run | 所有 Run（全部使用 `recursive/512` 或类似 chunk 配置）|
| 影响程度 | **均等影响**：所有配置使用相同的 tokenizer，相对比较不受影响；但 Chinese 实际 overlap 可能比预期小 |
| 对结论的影响 | 所有 test case 受同等影响，cross-configuration 比较结论 **有效** |
| **需要重测** | **否**（等修复 `js-tiktoken` 后可做一次基准测试）|

### Bug 6：Jaccard MMR 中 `filterCombined` 缺 `maxPerDocument` 检查

| 项目 | 内容 |
|------|------|
| 影响方法 | `pipeline-filter`（所有 Run 都使用）|
| 影响程度 | **轻微**：`maxPerDocument=5` 未被 `filterCombined` 强制执行；但 `finalTopK=10` 作为总量上限仍有效，单文档最多贡献 10 条（理论上限），实际超出 5 条的情况很少 |
| 对结论的影响 | 所有配置均受同等影响，相对比较 **有效**；某些 query 可能获得了比预期更多的同文档 chunk，hitRate 可能被轻微高估 |
| **需要重测** | **否**（修复后建议做一次校验，但结论方向不变）|

### Bug 7：Markdown 清洗 regex 不完整 / Bug 8：HTML 检测 regex

| 影响 Run | 所有使用 Markdown 文档的 Run |
| 影响程度 | 极轻微，测试文档（PRODUCT.md、Bloomnote PRD）都是规范 Markdown，边缘情况未触发 |
| **需要重测** | **否** |

---

## 汇总：需要重测的 Run

| Run | 是否需要重测 | 原因 | 优先级 |
|-----|------------|------|--------|
| **Run-008 T03** | **是** | Metadata Boost tokenizer 失效，pipeline-rerank 真实效果未知 | P0 |
| Run-003 | 可选 | BM25 分词质量低，dense vs hybrid 对比可能有偏差 | P2 |
| 其他所有 Run | 否 | 均等影响或影响可忽略，相对结论有效 | — |

---

## Run-009 计划（pipeline-rerank 重验证）

**目标**：验证 jieba tokenizer 修复后，pipeline-rerank 是否真的优于 hf-tei-rerank

**设计**：

| ID | Label | Reranker | boostPassN | scoreThreshold |
|----|-------|----------|------------|----------------|
| T01 | score-only（基准）| score-only | — | 0.5 |
| T02 | hf-tei-rerank | bge-v2-m3 | — | 0.2 |
| T03 | pipeline-rerank（jieba修复）| bge-v2-m3 | **20**（默认，验证 tokenizer 修复）| 0.2 |
| T04 | pipeline-rerank（tight boostPassN）| bge-v2-m3 | **5**（验证截断策略）| 0.2 |

**判断标准**：
- T03 > T02 → tokenizer 修复有效（boost 影响了输入排序，且 boostPassN 足够小时有截断效果）
- T04 > T03 → 更紧的 boostPassN 有额外收益
- T03 = T02 → tokenizer 修复不足以改变结果（bge winner-take-all 架构限制确认）

**测试文档**：Bloomnote PRD（与 Run-008 一致，保持可比性）  
**Query**：同 Run-008 的 6 个 query

---

## 结论

**历史实验结论可靠性评估：**

| 结论 | 可靠性 | 说明 |
|------|--------|------|
| bge cross-encoder 在中文产品文档有 domain mismatch | ✅ 高 | T02 结果有效，非受影响配置 |
| LLM reranker (Qwen) hitRate=0.94 最高 | ✅ 高 | T04 有效数据来自 run-014（修复后重跑）|
| score-only hitRate=0.89 稳定基准 | ✅ 高 | T01 不涉及任何受影响组件 |
| pipeline-rerank = hf-tei-rerank（无增量）| ❌ **无效** | tokenizer bug 导致 Boost 未生效，需 Run-009 重验证 |
| transform 效果不稳定（边界效应）| ✅ 高 | transform 逻辑不涉及 BM25/boost |
| chunk 方法是唯一持续有效的变量 | ✅ 高 | chunk 阶段不受本次 bug 影响 |
| dense-vector ≈ hybrid-bm25-rrf | ⚠️ 中 | BM25 分词质量低，hybrid 可能被低估；但"reranker 抹平"结论仍有效 |
