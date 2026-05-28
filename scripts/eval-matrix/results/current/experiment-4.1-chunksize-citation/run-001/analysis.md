# 实验 4.1：chunkSize × Citation 模式 网格

**Run ID**: `current/experiment-4.1-chunksize-citation/run-001`
**日期**: 2026-05-25
**文档**: Bloomnote 产品需求文档（12,358 字符，~30 章节）
**Query 集**: Q1-Q6（与实验 4.0 一致，便于纵向对比）

---

## 实验设计

固定 retrieval (dense-vector) / filter (pipeline-filter) / rerank (pipeline-rerank)，
只变两个维度：

| | chunkSize=256 | chunkSize=512 | chunkSize=1024 |
|---|---|---|---|
| **chunk-citation** | T01（小 chunk 基线） | T03（中等基线，复现 4.0）| T05（大 chunk 基线）|
| **section-citation/section** | **T02（关键测试）** | T04（中等基线，复现 4.0）| ✗ T06（embedding API 欠费失败）|

T03/T04 设计目的是**与实验 4.0 run-001 横向对照**，验证可复现性。

---

## 总均值结果

| TID | 配置 | hitRate | citationCoverage | confidence | ctxLen | avgEvidence | ideas |
|---|---|---:|---:|---:|---:|---:|---:|
| T01 | 256 / chunk | 0.67 | 0.94 | 0.52 | **900** | 300 | 3.0 |
| T02 | 256 / section | 0.67 | 0.94 | 0.53 | **1402** | 468 | 3.7 |
| T03 | 512 / chunk | 0.72 | **1.00** | 0.58 | **1757** | 586 | 3.7 |
| T04 | 512 / section | 0.72 | 0.94 | 0.60 | **1848** | 616 | 4.0 |
| T05 | 1024 / chunk | 0.72 | 0.89 | 0.60 | **3466** | 1155 | 4.3 |
| T06 | 1024 / section | — | — | — | — | — | — |

---

## 🎯 核心假设验证

**假设**：chunkSize 越小，每个 section 内 chunk 数越多，section-citation 反查能拿到更多兄弟节点，扩展量越显著。

**结果**：

| chunkSize | chunk-citation ctxLen | section-citation ctxLen | 扩展倍数 | 是否真扩展 |
|---:|---:|---:|---:|---|
| **256** | 900 | 1402 | **×1.56** | ✅ **真扩展** |
| 512 | 1757 | 1848 | ×1.05 | ❌ 几乎不扩展 |
| 1024 | 3466 | — | — | （未跑完，但 DB 验证每 source_ref 仍是 1 chunk，预期也不扩展） |

**假设完全验证**：section-citation 的有效性强依赖于 `chunkSize : section_size` 的比例。

---

## 实验 4.0 vs 4.1 复现性确认

| | 4.0 run-001 T01 | 4.1 run-001 T03 | 一致？ |
|---|---:|---:|---|
| 配置 | 512 / chunk | 512 / chunk | ✅ |
| ctxLen | 1757 | 1757 | ✅ **完全一致** |
| hitRate | 0.72 | 0.72 | ✅ |
| citationCoverage | 1.00 | 1.00 | ✅ |

| | 4.0 run-001 T03 | 4.1 run-001 T04 | 一致？ |
|---|---:|---:|---|
| 配置 | 512 / section | 512 / section | ✅ |
| ctxLen | 1848 | 1848 | ✅ |
| hitRate | 0.72 | 0.72 | ✅ |
| citationCoverage | 0.94 | 0.94 | ✅ |

**两次实验完全一致**，pipeline 行为稳定可复现。

---

## 出乎意料的发现：扩展了 ≠ 质量更好

T01 → T02 ctxLen 涨 56%，但**所有质量指标几乎不变**：

| | T01 (256/chunk) | T02 (256/section) | 变化 |
|---|---:|---:|---|
| hitRate | 0.67 | 0.67 | 0 |
| citationCoverage | 0.94 | 0.94 | 0 |
| confidence | 0.52 | 0.53 | +0.01 |
| ideas | 3.0 | 3.7 | +23% |

**多出的 ~500 字上下文没有让 LLM 生成更准确的引用，只是输出了稍多一点的 idea。**

这跟实验 4.0 T02（adjacent 模式）的发现一致：**长上下文 ≠ 高质量**。
甚至 4.0 T02 的 adjacent 模式（ctxLen ×2.85）反而拉低了引用准确率（-22%）。

---

## chunkSize 本身的影响（独立维度）

只看 chunk-citation 这一列（T01/T03/T05），观察 chunkSize 的纯粹影响：

| chunkSize | ctxLen | hitRate | citationCoverage | confidence |
|---:|---:|---:|---:|---:|
| 256 | 900 | **0.67 ↓** | 0.94 | 0.52 |
| **512** | 1757 | **0.72** | **1.00** | 0.58 |
| 1024 | 3466 | 0.72 | **0.89 ↓** | 0.60 |

- **256 偏小**：chunk 语义不完整，hitRate 跌到 0.67（语义检索失准）
- **1024 偏大**：单 chunk 信息密度低，citationCoverage 跌到 0.89（LLM 引用对不上具体片段）
- **512 是 sweet spot**：hit/cite 同时最优

ctxLen 跟 chunkSize 几乎线性（900 → 1757 → 3466，约 1:2:4），符合"chunk-citation 把 chunk 原文当 evidence"的预期。

---

## 综合结论

### 1. section-citation 在小 chunk 下确实生效，但收益有限

chunkSize=256 时 section 把上下文从 900 扩到 1402（×1.56），但**质量没显著提升**。
LLM 在 ~900 字时已经能给出和 1402 字差不多的答案——扩展贡献的是冗余信息。

### 2. 仅靠"扩展上下文"无法提升 RAG 质量

实验 4.0 + 4.1 共同证明：
- 4.0 adjacent (×2.85)：质量下降
- 4.0 section (×1.05)：几乎无变化
- 4.1 chunkSize=256 section (×1.56)：几乎无变化

**结论**：上下文是否够用是个阶梯函数，超过阈值后多给 LLM 不会更好。

### 3. chunkSize=512 + chunk-citation 仍然是最优默认值

- hitRate 0.72（最高之一）
- citationCoverage 1.00（最高）
- token 消耗适中（1757，约 1024 配置的一半）
- 实现最简单，不依赖 DB 反查

---

## 对 RAG Pipeline 默认配置的建议

| 配置项 | 建议值 | 理由 |
|---|---|---|
| chunkSize | **512** | 实验确认 512 是 hit/cite 最优 sweet spot |
| citation method | **chunk-citation** | section-citation 在常见 chunk 配置下无显著收益 |
| 何时考虑 section-citation | chunkSize ≤ 256 且文档章节明显大于 256 字 | 唯一可能真正生效的情形 |

section-citation 留作"工具箱"里的可选方案，**不作为默认推荐**。

---

## 已发现的局限 & 未来实验

1. **结论局限于当前文档**：Bloomnote PRD 是结构化产品文档，章节本身就紧凑。
   换一类文档（学术论文、技术规范、长篇报告）section size 可能远大于 chunk size，
   届时 section-citation 在 chunkSize=512 也可能生效。

2. **缺 T06 数据**：embedding API 欠费导致 chunkSize=1024 / section 缺失。
   但根据 1024 时 DB 里仍是"每 source_ref 1 chunk"，可合理外推 T06 ≈ T05。

3. **未验证卖点提取场景**：当前指标（hitRate / citationCoverage）是 Q&A 视角。
   实验 4.3（卖点提取专用 query）才能验证"覆盖率视角"下 section 是否更有价值。

---

## 下一步建议

- **实验 4.2**（preprocess 输出粗粒度 sourceRef）：让 section 反查跨多个 ### 子章节，
  本质改变 chunk-section 比例，可能是让 section-citation 真正有用的关键改动。
- **实验 4.3**（卖点提取专用 query）：换评估指标看 section 是否对"全面覆盖"型任务有帮助。
