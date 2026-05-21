# 自动化评估矩阵（Eval Matrix Runner）

## 功能定位

feat-008 是一个离线自动化测试工具，用于对 RAG pipeline 的不同配置组合进行系统性对比评估。它不是产品功能，而是开发者工具——帮助回答"哪种 chunk + retrieval + transform 组合对这份文档效果最好"。

## 设计背景

RAG pipeline 有大量可配置参数。用户在 Playground 里手动调参效率低，且无法系统性对比多个配置。本工具通过预定义的测试矩阵，自动串行运行 N 个配置组合，收集每次运行的质量指标，输出对比报告。

---

## 核心概念

### 测试维度（Dimensions）

影响 pipeline 输出质量的参数被归纳为 5 个维度，分为一级（必须覆盖）和二级（覆盖边界）：

**一级维度**

| 维度 | 参数位置 | 影响范围 |
|------|---------|---------|
| D1 Chunk 策略 | Chunk stage method + params | Ingestion，决定向量粒度 |
| D2 Retrieval 方法 | Retrieval stage method | Retrieval，决定召回路径 |
| D3 Transform 增强 | Transform stage method | Ingestion，影响 embedding 语义质量 |

**二级维度**

| 维度 | 参数位置 | 影响范围 |
|------|---------|---------|
| D4 Filter 策略 | Filter stage method + params | Retrieval，影响精度 vs 多样性 |
| D5 Query Rewrite | Query-rewrite stage method | Retrieval，影响检索入口 |

**固定维度**（所有 test case 相同，不参与矩阵）

| 维度 | 固定值 |
|------|-------|
| Preprocess | markdown-structure |
| Embedding | openai-3-small / dim-1024 |
| Rerank | score-only |
| Generation | marketing-ideas |
| Citation | chunk-citation |
| Evaluation | rag-metrics-only |

---

## 测试矩阵（12 个 Test Case）

| ID | Chunk | Retrieval | Transform | Filter | Query Rewrite | 测试意图 |
|----|-------|-----------|-----------|--------|---------------|---------|
| T01 | recursive/512/overlap-64 | dense-vector | none | score-0.6 | none | 基准 happy path |
| T02 | recursive/512/overlap-64 | hybrid-rrf | none | score-0.6 | none | 混合检索 vs 纯向量 |
| T03 | recursive/512/overlap-64 | bm25-chinese | none | score-0.6 | none | 关键词检索 vs 向量 |
| T04 | fixed-size/256/overlap-32 | dense-vector | none | score-0.6 | none | 小 chunk 对精度的影响 |
| T05 | markdown-heading/depth-2 | dense-vector | none | score-0.6 | none | 结构化切分 |
| T06 | recursive/512/overlap-64 | dense-vector | heading-context | score-0.6 | none | Transform 对向量质量的增益 |
| T07 | recursive/512/overlap-64 | hybrid-rrf | heading-context | score-0.6 | none | Transform + 混合检索叠加 |
| T08 | recursive/512/overlap-64 | dense-vector | none | mmr-diversity | none | 多样性过滤 vs 精度过滤 |
| T09 | recursive/512/overlap-64 | dense-vector | none | score-0.6 | rule-keyword-expansion | Query 扩展对召回的影响 |
| T10 | fixed-size/256/overlap-32 | hybrid-rrf | heading-context | score-0.6 | rule-keyword-expansion | 多维叠加（中间配置）|
| T11 | markdown-heading/depth-2 | hybrid-rrf | heading-context | mmr-diversity | rule-keyword-expansion | 结构化文档最优假设 |
| T12 | fixed-size/256/overlap-32 | bm25-chinese | none | score-0.6 | none | 预期最差配置（对比基准）|

---

## 测试文档

**文件**：`docs/PRODUCT.md`

选择理由：
- 有 H1 / H2 / H3 三层 Markdown 标题结构，适合测试 markdown-heading chunk 策略
- 约 3500 中文字符，递归切分 512 可产生 15-20 个 chunk
- 包含用户场景、功能描述、产品原则等语义差异明显的 section
- 包含中文关键词，适合测试 BM25 中文分词

---

## 测试 Query（固定 3 个）

每个 test case 运行时使用相同的 3 个 query，指标取平均值：

| ID | Query | 测试意图 |
|----|-------|---------|
| Q1 | 这个产品的目标用户是谁，解决什么问题？ | 宽泛语义，考察用户/场景内容召回 |
| Q2 | 产品支持哪些 embedding 和检索方式？ | 精确关键词，考察技术功能内容召回 |
| Q3 | 如何用这个工具生成营销内容 idea？ | 语义模糊，考察工作流描述内容召回 |

---

## 评估指标

使用**第二类指标**（无需 ground truth，直接从 pipeline trace 和输出计算）：

| 指标 | 来源 | 含义 |
|------|------|------|
| `hitRate` | evaluation stage | evidence 中高于阈值分数的比例 |
| `citationCoverage` | evaluation stage | 被 idea 引用的 evidence 比例 |
| `confidenceScore` | evaluation stage | 被引用 evidence 的平均分 |
| `retrievedCount` | retrieval trace | 实际返回的 chunk 数量 |
| `avgScore` | 手算（retrieval matches 均值）| 检索结果平均相似度 |
| `ideaCount` | generation output | 实际生成的 idea 数量 |
| `totalDurationMs` | 各 stage trace 求和 | 全流程耗时 |

最终对每个 test case 汇总 3 个 query 的指标均值。

---

## 脚本架构

### 文件结构

```
scripts/
  eval-matrix/
    test-matrix.json      # 12 个 test case 配置
    run-matrix.ts         # 主执行脚本（串行调用各 stage API）
    collect-metrics.ts    # 从 evaluation 输出提取并汇总指标
    report.ts             # 终端对比报告生成
    results/              # 每次运行输出（gitignore）
      T01_q1.json
      T01_q2.json
      ...
      summary.json        # 12 × 3 query 对比汇总
```

### 执行流程（每个 test case）

```
docs/PRODUCT.md 文本
  → POST /api/pipeline/preprocess   (markdown-structure，固定)
  → POST /api/pipeline/chunk        (D1：method + params)
  → POST /api/pipeline/transform    (D3：none / heading-context)
  → POST /api/pipeline/embedding    (固定：openai-3-small/1024)
  → POST /api/pipeline/storage      (truncateTable: true，隔离各 test case)
  → [对 Q1、Q2、Q3 各执行一次 ↓]
  → POST /api/pipeline/query-rewrite  (D5：none / rule-keyword-expansion)
  → POST /api/pipeline/retrieval      (D2：dense / hybrid-rrf / bm25)
  → POST /api/pipeline/filter         (D4：score-threshold / mmr-diversity)
  → POST /api/pipeline/rerank         (固定：score-only)
  → POST /api/pipeline/prompt-build   (固定：marketing-template)
  → POST /api/pipeline/generation     (固定：marketing-ideas)
  → POST /api/pipeline/citation       (固定：chunk-citation)
  → POST /api/pipeline/evaluation     (固定：rag-metrics-only)  ← 收集指标
```

### DB 隔离策略

每个 test case 的 storage stage 使用 `truncateTable: true`，在写入前清空 `rag_chunks` 表，确保各 test case 的向量互不干扰。test case 串行执行（不并行），每次 ingestion 完成后再运行 3 个 retrieval query。

### 输出格式（summary.json）

```json
[
  {
    "testId": "T01",
    "label": "基准 happy path",
    "config": {
      "chunk": "recursive/512/overlap-64",
      "retrieval": "dense-vector",
      "transform": "none",
      "filter": "score-threshold/0.6",
      "queryRewrite": "none"
    },
    "metrics": {
      "hitRate": 0.70,
      "citationCoverage": 0.80,
      "confidenceScore": 0.72,
      "retrievedCount": 8.3,
      "avgScore": 0.68,
      "ideaCount": 5,
      "totalDurationMs": 4200
    }
  }
]
```

---

## 交付标准

- `scripts/eval-matrix/run-matrix.ts` 可以通过 `npx ts-node` 或 `tsx` 直接运行
- 运行前提：Next.js dev server 启动（`cd app && npm run dev`）；PostgreSQL 可访问；`DATABASE_URL` 和 `EMBEDDING_API_KEY` / `LLM_API_KEY` 已设置
- 脚本运行完成后在终端输出对比表（每行一个 test case，列为各指标）
- `results/summary.json` 保存完整原始数据

---

## 范围边界

- 本工具不引入新的 API 路由，完全调用已有 `/api/pipeline/*` endpoints
- 不实现 Web UI，只是 CLI 脚本
- 不实现 ground truth / golden dataset（第一类指标），留待后续阶段
- 不并行执行 test case（避免 DB 向量污染）

---

## 测试手册

### 前置条件

```bash
# 1. 启动 PostgreSQL
docker compose up postgres

# 2. 启动 Next.js dev server（另开终端）
cd app && npm run dev

# 3. 确认环境变量已配置（在 app/.env.local 中）
DATABASE_URL=postgresql://...
EMBEDDING_API_KEY=...   # 或 LLM_API_KEY / OPENAI_API_KEY
LLM_API_KEY=...
# 可选：
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 运行完整矩阵

```bash
# 从项目根目录运行
npx tsx scripts/eval-matrix/run-matrix.ts
```

运行时间约 30–60 分钟（12 test case × 3 query，每次含 LLM generation 调用）。

### 断点续跑

```bash
# 跳过前面已完成的 test case，从 T05 开始继续
START_FROM=T05 npx tsx scripts/eval-matrix/run-matrix.ts
```

### 更换 dev server 地址

```bash
BASE_URL=http://localhost:3001 npx tsx scripts/eval-matrix/run-matrix.ts
```

### 查看结果

每次运行的结果保存在独立文件夹中：

```
scripts/eval-matrix/results/
  run-001-20260520/
    summary.json          # 12 个 test case 的指标汇总
    analysis.md           # 人工分析结论
    T01_Q1.json           # 每个 test case × query 的完整 pipeline 输出
    T01_summary.json      # 单个 test case 的 3 query 均值
    ...
  run-002-YYYYMMDD/       # 后续每次运行
    ...
```

新的测试运行**不会覆盖旧结果**。`results/` 目录纳入 git 版本控制，每次运行后提交。

### 如何解读指标

| 指标 | 含义 | 注意 |
|------|------|------|
| `hitRate` | evidence 中分数超过阈值的比例 | 仅 dense-vector 结果可横向比较；BM25 永远≈1，hybrid-rrf 永远≈0（刻度问题）|
| `citationCoverage` | 被 idea 引用的 evidence 比例 | 短文档中通常接近 1.0，区分度低 |
| `confidenceScore` | 被引用 evidence 的平均分 | 同 hitRate，跨检索方法不可比 |
| `retrieved` | retrieval 返回的 chunk 数 | 受 topK 和 threshold 共同影响 |
| `avgScore` | 所有 retrieved chunk 的平均相似度 | BM25/RRF 不是余弦相似度，数值含义不同 |
| `cited` | 生成内容引用的 evidence 数量 | 反映引用多样性，MMR filter 通常更高 |
| `ms` | 全流程耗时（3 query 累计）| 包含 embedding + LLM 调用时间 |

### 已知局限性

1. **hitRate 跨检索方法不可比**：各方法分数刻度不同（cosine/RRF/rerankScore）。建议只在同一检索方法内比较不同配置。
2. **hitRate 跨 rerank 方法需重新校准**：pipeline-rerank（cross-encoder）的分数范围与余弦相似度不同，scoreThreshold=0.5 对 rerankScore 偏严格，建议改为 0.2。
3. **citationCoverage 区分度低**：对于短文档，generation 模型倾向于引用所有 evidence。长文档或多文档场景下会更有意义。
4. **单文档局限**：结论基于特定文档类型，换文档可能得到不同结论。

### 测试历史

| Run | 日期 | 主要变化 | 核心发现 |
|-----|------|---------|---------|
| run-001 | 2026-05-20 | 基础矩阵，score-only rerank | heading-context transform +11% hitRate；256 chunk -22%；最优配置 T06（hitRate=0.89）|
| run-002 | 2026-05-20 | 数据丢失（worktree 删除前未提交）| — |
| run-003 | 2026-05-20 | pipeline-rerank（TEI cross-encoder）+ hybrid-bm25-rrf + pipeline-filter + intent-recognition | reranker 主导质量信号，ingestion/retrieval 差异被抹平；scoreThreshold 需重新校准为 0.2 |
| run-004 | 2026-05-21 | scoreThreshold 0.5 → 0.2 | markdown-heading 反超 recursive（0.67 vs 0.56）；有 reranker 时 transform/filter/retrieval 方法差异消失 |
