# 实验四：Citation 上下文扩展对比

**Run ID**: `run-016-experiment4-citation`
**日期**: 2026-05-25
**文档**: Bloomnote 产品需求文档（功能需求章节，约 8000 字 Markdown）
**测试 Query 数**: 6（覆盖单章节精确/跨章节综合）

---

## 实验配置

固定 retrieval 上游（dense-vector + pipeline-filter + pipeline-rerank），只改 citation：

| TID | citation 方法 | 关键参数 |
|---|---|---|
| T01 | `chunk-citation` | 基线，仅传命中 chunk 原文 |
| T02 | `section-citation` | `expansionMode=adjacent`（chunk±1）|
| T03 | `section-citation` | `expansionMode=section`（同 sourceRef 全部）|

---

## 总均值对比

| TID | 方法 | hitRate | citationCoverage | confidence | ctxLen | avgEvidence | ideas |
|---|---|---:|---:|---:|---:|---:|---:|
| T01 | chunk-citation | 0.72 | **1.00** | 0.58 | 1757 | 586 | 3.8 |
| T02 | section-citation/adjacent | 0.72 | 0.78 ↓ | 0.44 ↓ | 5008 (×2.85) | 1669 | 6.2 ↑ |
| T03 | section-citation/section | 0.72 | 0.94 ↓ | 0.59 | **1848 (×1.05)** ⚠️ | 616 | 3.3 |

**hitRate 三组完全相同**：retrieval/rerank 上游一致，命中的 chunk 完全相同，符合预期。

---

## 🚨 核心发现：section 模式在当前文档下几乎没扩展

T03 (section) 的 ctxLen 跟 T01 基线**几乎 1:1**（1848 vs 1757，只多 5%）。
逐 query 看更明显：

| Query | T01 ctxLen | T03 ctxLen | T03 实际扩展？ |
|---|---:|---:|---|
| Q1 | 1732 | 1732 | ❌ 完全没扩展 |
| Q2 | 1783 | 1783 | ❌ |
| Q3 | 1749 | 1749 | ❌ |
| Q4 | 1818 | 1818 | ❌ |
| Q5 | 1735 | 1735 | ❌ |
| Q6 | 1724 | **2270** | ✅ 唯一扩展的 query |

### 根因：每个 sourceRef 只对应 1 个 chunk

DB 查询确认（`SELECT source_ref, COUNT(*) FROM rag_chunks GROUP BY source_ref`）：

```
 产品概念与业务对象                             | 2  ← Q6 命中这里
 业务规则与校验                                 | 1
 产品功能需求 > 2. 富文本、清单与表格记录       | 1
 产品功能需求 > 3. 图片、扫描、文件与多媒体记录 | 1
 ...
 设计风格与视觉识别 > 色彩方案                  | 1
```

15 个 section 里，14 个只切出 1 个 chunk。section-citation 反查同 sourceRef 时，**返回的就是命中 chunk 自身，等价于 chunk-citation**。

**根本原因**：当前 chunkSize=512 字符，而文档大部分子章节的内容本身就 ≤ 512 字符，preprocess 给每段落分配的 sourceRef 又非常细粒度（`产品功能需求 > 2. 富文本、清单与表格记录`），结果是 section ≈ chunk，没有扩展空间。

---

## T02 (adjacent) 反而拉低质量

T02 把 chunk±1 邻居都拼进上下文，**ctxLen 涨到 2.85 倍，但所有质量指标都跌**：

| 指标 | T01 → T02 | 变化 |
|---|---|---|
| citationCoverage | 1.00 → 0.78 | **-22%** |
| confidenceScore | 0.58 → 0.44 | **-14%** |
| ideas 数量 | 3.8 → 6.2 | +61% |

### 异常 case：T02 Q3

| 指标 | T01 Q3 | T02 Q3 |
|---|---:|---:|
| hitRate | 1.00 | 1.00（命中相同）|
| ctxLen | 1749 | 5129 |
| ideas | 4 | **15**（暴涨）|
| citationCoverage | 1.00 | **0.00** |

LLM 被长上下文里的无关信息（相邻章节）激发，**生成了 15 个 idea，大部分没有合法 citation 依据**，引用覆盖率直接归零。

---

## 结论

### 1. 现有实现 + 现有 chunker 配置下，section-citation 几乎无效

不是 section-citation 代码有 bug，而是**文档结构 + chunker 粒度**导致每个 sourceRef 只对应 1 个 chunk，反查取不到兄弟节点。

### 2. adjacent 模式在当前场景下**有害**

简单粗暴地把相邻 chunk 拼进来，会引入大量无关上下文，让 LLM "脑洞大开"生成更多但更不可靠的内容。**不推荐用于卖点提取场景**。

### 3. 想让 section-citation 真正生效，需要二选一

- **方案 A：减小 chunkSize**（如 256），让大章节被切成多 chunk，再用 section 拼回
- **方案 B：preprocess 输出更粗的 sourceRef**（按 `##` 而不是 `###` 分组），让多个 child chunk 共享同一 parent sourceRef

方案 B 更符合 parent-child chunking 的原意，但需要在 preprocess 阶段控制 sourceRef 层级。

---

## 下一步实验设计建议

### 实验 4.1：chunkSize × citation 模式 网格

| | chunkSize=256 | chunkSize=512（当前）| chunkSize=1024 |
|---|---|---|---|
| chunk-citation | 基线 | 基线 | 基线 |
| section-citation/section | ? | **已验证：无效** | ? |

预期：chunkSize=256 时 section 会真正发挥作用。

### 实验 4.2：sourceRef 粒度控制

修改 preprocess 给 sourceRef 加上 `level` 参数，让用户可选"按 `##` 分组"还是"按 `###` 分组"，再跑同样的 citation 对比。

### 实验 4.3：定向场景验证

针对**卖点提取**任务，造一组测试 query（产品有哪些核心功能、有哪些差异化优势），用 ideaCount 和人工评估的卖点覆盖率作为主指标，再对比三种 citation。

---

## 对 RAG Pipeline 默认配置的建议

**短期（不改 chunker）**：保持 `chunk-citation` 作为默认，section-citation 暂不推荐生产使用。

**中期（调 chunker）**：把 chunkSize 调到 256，让 section-citation 真正生效，再回归本实验验证收益。

**长期（架构）**：考虑在 preprocess 输出里加 `parentSourceRef` 字段（按 `##` 聚合），让 section-citation 反查 parent 级，而不是依赖 sourceRef 精确匹配。
