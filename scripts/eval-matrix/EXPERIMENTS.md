# RAG Pipeline 实验记录与结论

> 项目定位：产品文档 → 卖点提取 → 营销策略 → 运营文案
> 评估重心：citationCoverage（答案覆盖率）> hitRate（召回率）> confidenceScore（置信度）
> 测试文档：Bloomnote 产品需求文档（功能需求章节，12358 字符）
> Embedding：Ollama bge-m3（本地，1024 维，中文优化）
> LLM：智谱 GLM-4-flash
> 测试 Query：6 题（易×2 / 中×2 / 难×2）

---

## 基础设施说明

### Eval Matrix 框架

```
scripts/eval-matrix/
├── test-matrix.json       # 当前实验配置（每次实验覆盖）
├── run-matrix.ts          # 主流程：上传文档 → 逐 case 调 API → 保存结果
├── collect-metrics.ts     # 指标提取：hitRate / citationCoverage / confidenceScore
├── report.ts              # 终端报告渲染
├── types.ts               # TestCase / QueryMetrics 类型定义
└── results/current/       # 按实验系列组织的结果目录
```

### 运行方式

```bash
# NestJS API（端口 3002，避免与主分支 3001 冲突）
API_PORT=3002 \
EMBEDDING_API_KEY=ollama EMBEDDING_BASE_URL=http://localhost:11434/v1 \
EMBEDDING_MODEL=bge-m3 EMBEDDING_DIMENSION=1024 \
LLM_API_KEY=xxx LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/ LLM_MODEL=glm-4-flash \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag \
pnpm --filter @harness/api start:once

# 运行实验
BASE_URL=http://localhost:3002 EXPERIMENT=experiment-N-xxx \
npx tsx scripts/eval-matrix/run-matrix.ts
```

### 实验前检查清单（每次实验必做）

1. 确认 `methodId` 在 switch/case 里有对应实现
2. 确认 test-matrix 参数名与 schema 字段名一致（不靠 zod default 蒙混）
3. 确认关键 boolean flag 显式传入，不依赖 default
4. 确认 score 量纲是否与 filter `minScore` 匹配（BM25/RRF 分数 ≠ 余弦相似度）
5. 确认实现里有无已知局限会影响实验解读

---

## 实验 4.0：Citation 方法对比（基础验证）

**目标**：验证 section-citation（同 sourceRef 章节合并）是否优于 chunk-citation

| ID | 方法 | hitRate | citationCoverage | confidenceScore |
|---|---|---|---|---|
| T03 | section-citation / section | 0.72 | **0.94** | 0.59 |

**注**：本轮只跑了 section-citation，chunk-citation 作为对照在 4.1 中补齐。

---

## 实验 4.1：Chunk 大小 × Citation 方法交叉实验

**目标**：找出 chunkSize 与 citation 方法的最优组合

| ID | chunkSize | citation | hitRate | citationCoverage | confidenceScore |
|---|---|---|---|---|---|
| T01 | 256 | chunk-citation | 0.67 | 0.94 | 0.52 |
| T02 | 256 | section-citation | 0.67 | 0.94 | 0.53 |
| **T03** | **512** | **chunk-citation** | **0.72** | **1.00** | **0.58** |
| T04 | 512 | section-citation | 0.72 | 0.94 | 0.60 |
| T05 | 1024 | chunk-citation | 0.72 | 0.89 | 0.60 |
| T06 | 1024 | section-citation | FAILED | — | — |

**结论**：
- `chunkSize=512 + chunk-citation` 是全局最优（citationCoverage=1.00）
- section-citation 在任何 chunkSize 下都不优于 chunk-citation
- chunkSize=256 hitRate 下降（语义信息不足），1024 citationCoverage 下降（语义被稀释）

---

## 实验 4.2：sourceRefDepth 对 section-citation 的影响

**目标**：验证粗粒度 sourceRef（截断到 N 层）能否让 section-citation 扩展更多上下文

| ID | 方法 | sourceRefDepth | citationCoverage | ctxLen 均值 |
|---|---|---|---|---|
| **T01** | chunk-citation | 全层级 | **0.94** | ~1750 |
| T02 | section-citation | 全层级 | 0.83 | ~1780 |
| T03 | section-citation | depth=1（最粗） | 0.61 | ~4900 |
| T04 | chunk-citation | depth=1（控制组） | 0.89 | ~1750 |

**结论**：
- 粗粒度 sourceRef 让 section-citation 扩展了 ×2.8 的上下文，但 citationCoverage **反而下降了 35%**
- 「更多上下文 ≠ 更好质量」——过长的 context 稀释了关键信息，LLM 引用准确率下降
- chunk-citation 在所有条件下最优，section-citation 方案全部放弃

---

## 实验 1：Chunk 方法对比

**目标**：`recursive`（忽略标题）vs `markdown-heading-recursive`（按标题边界切分）

| ID | chunk 方法 | headingDepth | citationCoverage | confidenceScore | 耗时(ms) |
|---|---|---|---|---|---|
| **T01** | recursive | — | **0.89** | **0.63** | 169173 |
| T02 | markdown-heading-recursive | 3（###） | 0.89 | 0.62 | 185162 |
| T03 | markdown-heading-recursive | 2（##） | 0.89 | 0.62 | 183890 |

**结论**：
- 三种方法 citationCoverage 完全相同，差异在噪声级别
- bge-m3 embedding 能力足够强，分块策略差异被掩盖
- `recursive` 更简单更快（省去标题解析），保持为默认
- `markdown-heading-recursive` 作为备选：文档段落超长、或非标准结构文档时使用

**多文档注意**：格式混合时需按 mimeType 自动路由（PDF → sliding-window，Markdown → markdown-heading-recursive）

---

## 实验 2：检索方法对比

**目标**：纯语义 vs 纯关键词 vs 语义+关键词融合

| ID | 检索方法 | citationCoverage | confidenceScore | avgScore | 耗时(ms) |
|---|---|---|---|---|---|
| **T01** | dense-vector | **0.94** | 0.62 | 0.58 | 176376 |
| T02 | bm25-chinese | 0.89 | 7.07* | 3.72* | 143805 |
| T03 | hybrid-bm25-rrf | 0.72 | 0.03* | 0.03* | 125231 |

> *BM25/RRF 分数量纲不同于余弦相似度，不可直接比较

**结论（单文档）**：
- `dense-vector` 最优：bge-m3 语义能力已饱和（hitRate=1.00），BM25 无增量收益
- `hybrid-bm25-rrf` 最差：RRF 是排名融合，BM25 干扰了 dense 的最优排序，引入噪声
- 根本原因：hybrid 优势在于多文档跨域检索，单文档场景下 BM25 只会扰乱排名

**多文档预期**：hybrid-bm25-rrf 可能翻盘——专有名词/版本号的精确匹配价值在多文档里显现，需重跑实验。`maxPerDocument` 参数在多文档下需从 5 降低，`mmrLambda` 建议调高到 0.8-0.9。

---

## 实验 3：Rerank 方法对比

**目标**：无 rerank vs 规则 rerank vs LLM rerank（TEI cross-encoder 本次未测，需本地服务）

| ID | rerank 方法 | citationCoverage | confidenceScore | cited 均值 | 耗时(ms) |
|---|---|---|---|---|---|
| T01 | score-only（基线） | 0.78 | 0.64 | 2.7 | 175678 |
| **T02** | **metadata-boost** | **0.94** | **0.75** | **3.2** | 164072 |
| T03 | llm-relevance-rerank | 0.72 | 0.70 | 2.2 | 186432 |

**结论**：
- `metadata-boost` 大幅领先：jieba 分词关键词命中率加权，弥合了 embedding 向量和 LLM 评估之间的 gap
- LLM rerank 最差：per-chunk 打分的「相关性（1-10）」维度与「citationCoverage」指标不对齐，GLM-4-flash 判断「相关」的标准不等于「答案完整覆盖」
- `metadata-boost` 零 API 成本，耗时最短，收益最大（+0.16 citationCoverage，+0.11 confidence）

**多文档注意**：多文档语料下关键词区分度下降，`hf-tei-rerank`（cross-encoder）的价值会显现，待 TEI 服务部署后补充实验。

---

## 实验 5：Transform 方法对比

**目标**：chunk 原文 vs 注入标题前缀 vs 注入关键词+摘要

> ⚠️ 初次运行因参数名错误（`keywordTopN` → 应为 `keywordCount`，`summaryMaxChars` → 应为 `summaryMaxTokens`）导致结果偏差，已修正后重跑。

| ID | transform 方法 | citationCoverage | confidenceScore | 耗时(ms) |
|---|---|---|---|---|
| T01 | none（基线） | 0.89 | 0.62 | 157840 |
| T02 | heading-context（注入章节标题路径） | 0.89 | 0.63 | 151521 |
| **T03** | **summary-keywords（注入 TF 关键词+摘要）** | **0.94** | **0.63** | 156650 |

**结论**：
- `summary-keywords` 有效：关键词注入到 embedding 向量，弥合了 query 词汇和 chunk 内容之间的 gap（Q2 导出格式、Q4 设计风格两题覆盖改善）
- `heading-context` 无效：bge-m3 已能理解章节语义，额外注入标题路径收益为零，甚至略微稀释语义密度
- 注意：`summary-keywords` 使用纯 TF（无 IDF），高频词可能占据关键词 top5，多文档场景下区分度会进一步提升

**已知局限**：
- `summaryMaxTokens × 4 ≈ summaryMaxChars` 换算对中文偏大（中文 1 token ≈ 1-2 字符），实际摘要比预期长
- 纯 TF 无 IDF，产品文档中「产品/功能/支持」等高频词可能主导关键词提取

---

## 综合最优配置（单文档场景）

| Pipeline Stage | 推荐方法 | 关键参数 | 备注 |
|---|---|---|---|
| Preprocess | markitdown | — | PDF 用 pdf-pages |
| **Chunk** | recursive | chunkSize=512, overlap=64 | md-heading-recursive 无显著提升 |
| **Transform** | summary-keywords | keywordCount=5, summaryMaxTokens=100, appendToChunk=true | +0.05 citationCoverage |
| Embedding | bge-m3（Ollama） | dimension=1024 | 本地，无 API 成本 |
| **Retrieval** | dense-vector | topK=10, threshold=0.1 | hybrid 单文档下反效果 |
| Filter | pipeline-filter | minScore=0.2, maxPerDocument=5, finalTopK=10, mmrLambda=0.7 | — |
| **Rerank** | metadata-boost | rerankTopN=5 | 零成本，+0.16 citationCoverage |
| Citation | chunk-citation | maxEvidencePerClaim=3 | section-citation 全面劣于 chunk |
| Generation | glm-4-flash | — | 成本最低 |

**理论最优 citationCoverage 叠加估算**：

各实验独立最优值叠加（transform × rerank 均有收益，其他正交）：
- 基线（全 none）：~0.78-0.89
- + summary-keywords transform：+0.05
- + metadata-boost rerank：+0.16
- 预期综合：**~0.94-1.00**

> 注：各实验单独测试，未做组合实验验证叠加效果，待最终配置合并后整体验证。

---

## 后续规划

### 短期（单文档优化完成后）

- [ ] **组合验证实验**：用 `summary-keywords + metadata-boost + dense-vector` 跑一遍 6 题，验证叠加收益
- [ ] **合并最优配置到 main**：更新 stageRegistry 默认值，固化实验结论
- [ ] **实验 4.3**：卖点提取专用 query（高召回模式，topK=30+，无 rerank），验证覆盖率指标

### 中期（多文档支持）

- [ ] **batch-ingest API**：`POST /api/pipeline/batch-ingest`，支持多文档顺序入库，自动按 mimeType 路由 preprocess/chunk 方法
- [ ] **多文件上传 UI**：`DocumentUploadPanel` 支持 `<input multiple>`，顺序上传避免 JSON 竞态
- [ ] **重跑实验 2**（检索方法）：多文档语料下验证 hybrid-bm25-rrf 是否翻盘
- [ ] **重跑实验 3**（rerank）：部署 HF TEI cross-encoder，验证 hf-tei-rerank 在多文档下的表现

### 长期（工程化）

- [ ] **实验 3 TEI rerank**：本地部署 `BAAI/bge-reranker-v2-m3`，补充 `hf-tei-rerank` 和 `pipeline-rerank` 的实验数据
- [ ] **Step1/Step3 双模式**：用 `mode: "extraction" | "copywriting"` 自动切换高召回/高精准参数
- [ ] **LLM 摘要 transform**：`llm-summary` 替代纯 TF 的 `summary-keywords`，改善关键词质量（需 API）
- [ ] **TF-IDF 升级**：集成 `@node-rs/jieba` 的 TfIdf 类，替换当前纯 TF 实现

---

## 面试考点

**Q: 为什么 hybrid-bm25-rrf 在单文档场景下反而比 dense-vector 差？**

A: RRF 是排名融合（`1/(k+rank)`），不是分数融合。当 dense 已经完美召回（hitRate=1.00）时，BM25 只能改变排名，且会把语义最优的 chunk 排名推低（因为 BM25 对自然语言 query 关键词命中率低于语义匹配）。hybrid 的真正价值在多文档跨域检索，需要精确匹配专有名词/版本号。

**Q: metadata-boost 为什么比 LLM rerank 效果好？**

A: LLM 打分（1-10 相关性）和 citationCoverage（答案覆盖完整度）是两个不同的优化目标。LLM 倾向于给「内容精炼、逻辑清晰」的 chunk 高分，但 citationCoverage 需要的是「包含答案所有要点」，可能是一段枚举列表。metadata-boost 的关键词命中率恰好与后者对齐。

**Q: summary-keywords transform 为什么有效，heading-context 无效？**

A: bge-m3 是专门针对中文语义优化的多语言模型，本身已经能理解章节上下文，注入标题路径是冗余信息。而 summary-keywords 注入的 TF 关键词补充了 chunk 原文中词汇密度低的场景（比如「设计风格」一章用的是「清新简约」「珊瑚橙」而不是 query 里的「主题色方案」）。

**Q: 为什么 chunkSize=512 是最优？**

A: 256 太小导致语义信息不完整，embedding 无法捕捉跨句子的关联；1024 太大导致向量被多个不相关话题稀释，检索时与 query 的相似度降低。512 在中文产品文档（段落普遍 200-400 字）下刚好对应一个完整语义单元。
