# 面试题 — Citation Stage（feat-004.5）

相关文件：`app/app/api/pipeline/citation/route.ts`

---

## Q1：Citation Stage 在 RAG Pipeline 中的位置和职责是什么？

**答：**

Citation 是 Retrieval Pipeline 的最后一步，位于 Rerank 之后、LLM 生成（prompt-build）之前。

**职责：**
1. **格式化 evidence**：将 ranked chunk 转为标准化的引用格式，每条 evidence 包含来源标注（documentId、chunkIndex、sourceRef）
2. **控制 token**：snippet-citation 只截取关键片段而非全文，减少 LLM context 长度和成本
3. **保留溯源链**：每个 evidence 分配唯一 `evidenceId`，LLM 输出可以引用这些 ID，后端据此追溯到原始 chunk 和文档版本

没有 Citation stage，LLM 收到的只是一堆原始文本，生成的内容无法追溯来源——这违背了本项目"Evidence first"的核心原则。

---

## Q2：evidenceId 的格式 `{documentId}_v{version}_c{chunkIndex}` 是如何设计的？每个字段的作用是什么？

**答：**

```
doc_abc123_v2_c7
├── documentId: doc_abc123   → 哪份文档
├── version: 2               → 文档的第几个版本
└── chunkIndex: 7            → 文档中的第几个 chunk（从 0 开始）
```

**设计意图：**
- `documentId`：定位到具体文档，跨文档去重
- `version`：文档更新后旧引用仍可追溯。"你在生成结果里引用的这段内容，是文档第 2 版时的，现在是第 3 版，原内容已变更"——这对知识库的内容审计非常重要
- `chunkIndex`：定位到具体 chunk，可以反查原文、上下文、embedding 向量

这三个维度组合后全局唯一，满足：任意一条生成声明都能精确追溯到"哪份文档、哪个版本、第几个片段"。

---

## Q3：三种 citation 方法（chunk-citation / page-aware / snippet）各自适合什么场景？

**答：**

| 方法 | 内容 | 适合场景 |
|------|------|----------|
| chunk-citation | chunk 全文 | 短 chunk（<200 字）、需要完整上下文 |
| page-aware-citation | 提取 "page:N" / "第N页" 标注，附加页码 | PDF 文档、需要页码引用（学术、法律） |
| snippet-citation | 关键词锚点附近窗口（±snippetLength 字符）| 长 chunk（>500 字）、需要精简 context |

**snippet-citation 的实现思路：**
1. 在 chunk.text 中找 query 关键词的位置（首次出现）
2. 取 `[pos - snippetLength, pos + snippetLength]` 窗口
3. 如果找不到关键词，截取文本开头

这是一种轻量级"关键词锚点提取"，效果接近 BM25 passage extraction，但不依赖额外模型。

---

## Q4：contextText 字段的格式是怎样的？它如何帮助 LLM 生成可溯源的内容？

**答：**

`contextText` 是 Citation stage 输出中供 prompt-build 直接使用的格式化字符串，示例：

```
[1] (来源: 产品介绍 > 核心功能, doc_abc_v1_c3)
AIGC 内容生成支持多种格式，包括图文、视频脚本和营销文案。

[2] (来源: 产品介绍 > 定价, doc_abc_v1_c8)
标准版月费 299 元，包含 100 次 AI 生成额度。
```

**LLM prompt 设计：**
```
根据以下内容回答用户问题，并在回答中引用 [编号] 标注来源：

{contextText}

用户问题：{query}
```

LLM 生成时会自然引用 `[1]`、`[2]`，后端可以用正则提取 `[N]`，再映射回 `evidencePack[N-1].evidenceId`，完成声明 → 原始 chunk 的溯源。

---

## Q5：如果 LLM 生成的内容引用了 evidenceId，但该 chunk 在新版本文档里已被删除，应该怎么处理？

**答：**

这是 RAG 系统的"引用失效"问题，本项目的设计给了解决基础：

**当前设计支持：**
- evidenceId 含 version 字段：可以区分"引用的是 v1，当前是 v2"
- `rag_chunks` 表保留历史版本（`pgvector-new-version` 策略不删旧记录）

**完整解决方案（生产实践）：**
1. **版本标记**：查询时标注 evidence 的 version 是否为当前最新版
2. **失效警告**：如果 evidenceId 指向的 chunk 在最新版中不存在，在 UI 展示"该引用来自旧版文档，内容可能已变更"
3. **再验证**：生成结果提交前，用最新版文档重新检索，确认引用的事实仍然成立
4. **Audit log**：记录每次生成时使用的 evidenceId 列表，便于后续内容审计

本项目当前实现了前两层基础（version 记录 + evidenceId 格式），第 3、4 层属于 feat-006（RAG Quality Evaluation）的范围。
