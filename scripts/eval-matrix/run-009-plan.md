# Run-009 实验方案：pipeline-rerank 重验证

**创建日期**：2026-05-23  
**前置条件**：feat-009（jieba 分词修复）已合并  
**背景**：Run-008 T03（pipeline-rerank）因 tokenizer bug 导致 Metadata Boost 完全失效，等价于纯 bge 重排（T02）。本次实验验证修复后的真实效果，同时测试不同 boostPassN 策略的边界。

---

## 核心问题

| 问题 | 对应对比 |
|------|---------|
| jieba 修复后，boostPassN=20 是否改变结果？ | T03 vs T02 |
| boostPassN=3（紧截断）能否排除错误 chunk？| T04 vs T02 |
| boostPassN=3 对 Q4 和 Q6 的效果是否不同？| T04 per-query |

---

## 预分析（实验前预测）

基于对 Run-008 filter 输出数据的 boost 重计算（jieba 修复后）：

### Q4：产品的整体设计风格和主题色方案是什么？

| boost 后排名 | chunk | boost score | 是否正确 |
|------------|-------|------------|---------|
| rank1 | 设计风格 > 色彩方案 | 0.603 | ✓ |
| rank2 | 设计风格 > 字体布局 | 0.565 | ✓ |
| rank3 | 个性化与主题 | 0.505 | ✓ |
| **rank4** | **导航与信息架构** | **0.502** | **✗ BAD** |
| rank5 | Q&A | 0.450 | — |

→ `boostPassN=3`：排除 `导航`（rank4 > 3）**Q4 有望修复**  
→ `boostPassN=5`：包含 `导航`（rank4 ≤ 5）不改善  
→ `boostPassN=20`：全部送 bge，与 Run-008 T02 结果相同  

### Q6：用户数据如何存储与同步，后台有哪些自动行为？

| boost 后排名 | chunk | boost score | 是否正确 |
|------------|-------|------------|---------|
| rank1 | 通知与后台产品行为 | 0.537 | ✓ |
| rank2 | 产品概念与业务对象 | 0.500 | — |
| **rank3** | **业务规则与校验** | **0.480** | **✗ BAD** |
| rank4 | 导航与信息架构 | 0.460 | — |

→ 任何合理的 `boostPassN`（≥3）都包含 `业务规则`（rank3）  
→ **Q6 无法通过 boostPassN 修复**（需要 boostPassN=2，但 topN=5 时候选严重不足）  
→ Q6 的根本问题：`业务规则` 原始余弦分（0.48）高于候选集中其他有 boost 的 chunk  

---

## 实验设计

**固定变量**（与 Run-008 保持一致）：
- 文档：Bloomnote PRD
- Chunk：recursive/512/overlap-64
- Transform：none
- Retrieval：dense-vector，text-embedding-v4，topK=10
- Filter：pipeline-filter，finalTopK=10

**变量**：Reranker 方法 + boostPassN

| ID | Label | Reranker | boostPassN | scoreThreshold | 测试目的 |
|----|-------|----------|------------|----------------|---------|
| T01 | score-only（基准）| score-only | — | 0.5 | 不变基准，与 Run-008 可比 |
| T02 | hf-tei-rerank（bge 参考）| hf-tei-rerank | — | 0.2 | 纯 bge，作为 pipeline-rerank 对照 |
| T03 | pipeline-rerank（boostPassN=20）| pipeline-rerank | 20 | 0.2 | jieba 修复 + 无有效截断（预测 ≈ T02）|
| T04 | pipeline-rerank（boostPassN=3）| pipeline-rerank | 3 | 0.2 | 紧截断，排除 Q4 错误 chunk（预测 Q4↑, Q6 不变）|

---

## 预期结论矩阵

| 对比 | Q1–Q3（易题）| Q4（设计风格）| Q5（免费 vs Pro）| Q6（数据存储）|
|------|------------|-------------|----------------|-------------|
| T03 vs T02 | 相同 | 相同（导航仍在 bge 输入）| 相同 | 相同 |
| T04 vs T02 | 可能略有差异 | **改善（导航被排除）** | 相同 | **不改善（业务规则仍在）**|
| T01 vs T04 | T01 ≈ T04 | T01=0.67 vs T04=? | 相同 | T01=0.67 vs T04=0.33 |

如果实验结果符合预测：
- 证明 **tokenizer 修复必要但不充分**（T03=T02 确认架构限制）
- 证明 **boostPassN 紧截断在"有明确 sourceRef 关键词匹配"的 query 上有效**（T04 Q4 改善）
- 证明 **对高余弦分的错误 chunk，boost 无法排除**（T04 Q6 不变）

如果 T03 ≠ T02：
- 说明 jieba 分词改变了 bge 前的排序，影响了某些 query 的候选集（非预期发现）

---

## test-matrix.json 配置

```json
[
  {
    "id": "T01",
    "label": "score-only（基准）",
    "chunk":        { "methodId": "recursive",      "params": { "chunkSize": 512, "overlap": 64, "separators": ["\\n\\n","\\n"," ",""], "minChunkSize": 64 } },
    "transform":    { "methodId": "none",            "params": {} },
    "queryRewrite": { "methodId": "none",            "params": {} },
    "retrieval":    { "methodId": "dense-vector",    "params": { "embeddingProvider": "openai", "embeddingModel": "text-embedding-v4", "embeddingDimension": 1024, "topK": 10, "threshold": 0.1 } },
    "filter":       { "methodId": "pipeline-filter", "params": { "requiredSourceTypes": [], "minScore": 0.2, "maxPerDocument": 5, "finalTopK": 10, "mmrLambda": 0.7 } },
    "rerank":       { "methodId": "score-only",      "params": {} },
    "scoreThreshold": 0.5
  },
  {
    "id": "T02",
    "label": "hf-tei-rerank / bge-v2-m3（纯 bge 参考）",
    "chunk":        { "methodId": "recursive",      "params": { "chunkSize": 512, "overlap": 64, "separators": ["\\n\\n","\\n"," ",""], "minChunkSize": 64 } },
    "transform":    { "methodId": "none",            "params": {} },
    "queryRewrite": { "methodId": "none",            "params": {} },
    "retrieval":    { "methodId": "dense-vector",    "params": { "embeddingProvider": "openai", "embeddingModel": "text-embedding-v4", "embeddingDimension": 1024, "topK": 10, "threshold": 0.1 } },
    "filter":       { "methodId": "pipeline-filter", "params": { "requiredSourceTypes": [], "minScore": 0.2, "maxPerDocument": 5, "finalTopK": 10, "mmrLambda": 0.7 } },
    "rerank":       { "methodId": "hf-tei-rerank",   "params": { "rerankTopN": 5 } },
    "scoreThreshold": 0.2
  },
  {
    "id": "T03",
    "label": "pipeline-rerank / boostPassN=20（jieba 修复，无有效截断）",
    "chunk":        { "methodId": "recursive",      "params": { "chunkSize": 512, "overlap": 64, "separators": ["\\n\\n","\\n"," ",""], "minChunkSize": 64 } },
    "transform":    { "methodId": "none",            "params": {} },
    "queryRewrite": { "methodId": "none",            "params": {} },
    "retrieval":    { "methodId": "dense-vector",    "params": { "embeddingProvider": "openai", "embeddingModel": "text-embedding-v4", "embeddingDimension": 1024, "topK": 10, "threshold": 0.1 } },
    "filter":       { "methodId": "pipeline-filter", "params": { "requiredSourceTypes": [], "minScore": 0.2, "maxPerDocument": 5, "finalTopK": 10, "mmrLambda": 0.7 } },
    "rerank":       { "methodId": "pipeline-rerank", "params": { "boostPassN": 20, "rerankTopN": 5 } },
    "scoreThreshold": 0.2
  },
  {
    "id": "T04",
    "label": "pipeline-rerank / boostPassN=3（紧截断，Q4 导航排除验证）",
    "chunk":        { "methodId": "recursive",      "params": { "chunkSize": 512, "overlap": 64, "separators": ["\\n\\n","\\n"," ",""], "minChunkSize": 64 } },
    "transform":    { "methodId": "none",            "params": {} },
    "queryRewrite": { "methodId": "none",            "params": {} },
    "retrieval":    { "methodId": "dense-vector",    "params": { "embeddingProvider": "openai", "embeddingModel": "text-embedding-v4", "embeddingDimension": 1024, "topK": 10, "threshold": 0.1 } },
    "filter":       { "methodId": "pipeline-filter", "params": { "requiredSourceTypes": [], "minScore": 0.2, "maxPerDocument": 5, "finalTopK": 10, "mmrLambda": 0.7 } },
    "rerank":       { "methodId": "pipeline-rerank", "params": { "boostPassN": 3, "rerankTopN": 3 } },
    "scoreThreshold": 0.2
  }
]
```

> 注：T04 使用 `rerankTopN=3` 与 `boostPassN=3` 对齐，因为送入 bge 的候选数只有 3 个，topN=5 无意义。评估指标 hitRate 基于 cited evidence，不受 topN 绝对值影响。

---

## 运行命令

```bash
# 确认 rerank 服务运行（bge-reranker-v2-m3）
curl http://localhost:8080/health

# 关闭 Clash TUN 模式（DashScope embedding 需要直连）

# 运行（预计 30-40 分钟）
npx tsx scripts/eval-matrix/run-matrix.ts
```

---

## 分析要点

运行完成后，重点对比：

1. **T03 vs T02（per-query hitRate 对比）**
   - 若 T03 = T02：确认 boostPassN=20 无效（架构限制），tokenizer 修复仅影响排序不影响结果
   - 若 T03 ≠ T02：需分析是哪些 query 产生了差异，以及 boost pre-sorting 对 bge 的意外影响

2. **T04 Q4 hitRate**
   - 预测：从 0.33（T02）提升至 0.67 或 1.00（因导航被排除）
   - 若不提升：说明 bge 在 3 个候选中依然对 色彩方案 打分极低，问题在 bge 模型本身

3. **T04 Q6 hitRate**
   - 预测：维持 0.33（业务规则仍在 top-3 boost 候选中）
   - 若提升：需检查 boost 计算是否改变了 Q6 候选集

4. **T04 总体 hitRate vs T01**
   - T04 rerankTopN=3（证据最多 3 条）vs T01 rerankTopN=5
   - 若 T04 hitRate ≥ T01：说明"更精准但更少的证据"优于"更多但有噪声的证据"
   - 若 T04 < T01：召回率损失代价过高

---

## 后续实验方向（根据结果决定）

| 结果 | 后续行动 |
|------|---------|
| T03=T02, T04 Q4↑ | pipeline-rerank 有条件有效；设计 boostPassN 自适应策略（根据 boost 分差动态截断）|
| T03=T02, T04 Q6 不变 | Q6 问题根源是 bge 语义错误，非架构问题；考虑 LLM reranker 作为 Q6 类查询的后备 |
| T03≠T02 | 分析 jieba pre-sorting 对 bge 的意外影响，可能发现新的优化方向 |
| 所有 T 相同 | 证明 bge winner-take-all 是不可克服的，记录并关闭 pipeline-rerank 优化探索 |
