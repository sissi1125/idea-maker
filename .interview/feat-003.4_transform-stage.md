# 面试题 — Transform Stage（feat-003.4）

相关文件：
- `app/app/api/pipeline/transform/route.ts`
- `app/lib/stageRegistry.ts`（transform 方法 schema）

---

## Q1：为什么 RAG pipeline 需要 Transform 步骤？直接对 chunk 原文做 embedding 不够吗？

**答：**

原始 chunk 通常是一段孤立的正文片段，缺少上下文信息。embedding 模型（尤其是短文本模型如 `all-MiniLM-L6-v2`）对孤立片段的编码质量较差，导致检索时出现语义漂移。

**典型问题举例：**
- chunk 原文："支持多格式上传，包括 Markdown、TXT 和 PDF"
- 用户 query："产品核心功能有哪些"
- 两者余弦相似度很低，因为 chunk 里没有"产品"或"核心功能"等关键词

**Transform（heading-context）注入后：**
```
产品介绍 > 核心功能

支持多格式上传，包括 Markdown、TXT 和 PDF
```
embedding 同时编码了章节语义，与 query 的相似度显著提升。

Transform 本质上是在不改变原始文本的前提下，给 chunk 注入"坐标"和"摘要"，让 embedding 向量携带更丰富的上下文信息。

---

## Q2：`heading-context` 方法注入的 `enhancedText` 和原始 `text` 都保留了，为什么不直接替换？

**答：**

两者用途不同：

- **`enhancedText`**：用于 embedding，包含注入的前缀/后缀，语义更丰富
- **`text`**：用于展示给用户，作为检索结果返回时呈现原始内容，不含注入噪音

如果直接替换，当 chunk 被检索命中后，LLM 接收到的上下文会包含重复的标题信息，影响生成质量（例如 "产品介绍 > 核心功能\n\n产品介绍 > 核心功能\n支持..."）。

保留原始 `text` 还有另一个好处：可以在 Playground 的 Output 面板对比 `text` 和 `enhancedText`，直观验证注入效果，不符合预期时可以调整参数重跑。

---

## Q3：`summary-keywords` 使用的是规则方法（TF 词频），而不是 LLM，这个选择的权衡是什么？

**答：**

**规则方法（TF 词频 + 停用词过滤）的优缺点：**

| | 优点 | 缺点 |
|---|---|---|
| 速度 | 本地计算，无网络延迟 | — |
| 成本 | 零 API 费用 | — |
| 离线 | 无需 API Key | — |
| 质量 | — | 中文分词不准（按空格/标点切，jieba 效果更好）；无法理解语义（"不好用"和"好用"词频一样但语义相反） |
| 可扩展 | — | 无法做跨文档关键词重要性评估（缺 IDF） |

**LLM 方法的优缺点：**
- 优点：理解语义，关键词质量高，可生成真正的摘要（不只是截断句子）
- 缺点：每个 chunk 需一次 API 调用，100 个 chunk 的文档需 100 次调用，成本和延迟不可忽视

**本项目的选择：**
规则方法足够演示"Transform 阶段的作用"，且不需要 API Key 就能运行。LLM 版本留给后续 `llm-summary` 方法扩展——只需在同一个 switch 分支里增加 case，不影响其他方法。

---

## Q4：如何评估 Transform 阶段的效果？你会用什么指标？

**答：**

Transform 效果最终体现在检索质量上，常用的评估指标：

**定量指标（需要标注 query-chunk 相关性数据）：**
- **Hit Rate@K**：Top-K 检索结果中，正确 chunk 出现的比例。比较 `none` vs `heading-context` 的 hit rate
- **MRR（Mean Reciprocal Rank）**：正确 chunk 在结果列表中的平均倒数排名，越高越好
- **NDCG**：考虑排名权重的综合指标

**定性验证（本项目 Playground 的做法）：**
- 在 Output 面板对比 `text` 和 `enhancedText`，检查注入内容是否合理
- 跑完 embedding 后，在 storage 阶段查看向量分布（PCA 降维可视化）
- 手工构造几个典型 query，看检索召回的 chunk 是否正确

**实践中的经验规律：**
`heading-context` 对结构化文档（产品文档、技术文档）效果显著，对自由文本（新闻、对话）效果有限。应该根据文档类型选择 transform 方法。

---

## Q5：Transform 之后的 chunk 被存入向量库，如果文档更新了，如何处理旧的 enhanced chunk？

**答：**

这是 RAG 系统中常见的"版本管理"问题，有几种策略：

**方案 A：版本化存储（本项目设计方向）：**
- 每次重新跑 pipeline 生成新版本的 chunk 和 embedding
- storage stage 的 `new-version` 模式保留历史版本，`replace-version` 替换旧版本
- 检索时可以指定只检索最新版本的 chunk（通过 metadata filter）

**方案 B：增量更新：**
- 对比新旧文档，只更新变化的段落对应的 chunk
- 需要精确的 diff 算法和段落级别的 ID 追踪，复杂度高

**方案 C：全量替换：**
- 文档更新时删除所有旧 chunk，重新 ingest
- 最简单，适合文档量小的场景

**本项目选择方案 A 的原因：**
`docStore.ts` 已经在文档层面维护 `version` 字段和 `hash`，pipeline 的每次运行结果也带有时间戳，天然支持版本化检索。生产环境只需在 PostgreSQL 的 chunks 表加 `document_version` 列，filter 时加 `WHERE document_version = $latest` 即可。
