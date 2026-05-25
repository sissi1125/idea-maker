# 测试分析报告 — Run 001

**日期**：2026-05-20
**测试文档**：`docs/PRODUCT.md`（约 3500 中文字符，H1/H2/H3 三层结构）
**测试 Query**：Q1 宽泛语义 / Q2 精确关键词 / Q3 语义模糊
**embedding 模型**：text-embedding-v4（Qwen/DashScope）/ dim=1024

> ⚠️ 原始 JSON 数据因 results/ 目录未纳入 git 而丢失（工作树删除时一并删除）。
> 本文件根据运行时终端输出重建，指标数据完整，原始 pipeline 输出不可恢复。
> 从 Run-002 起，所有数据已纳入 git 版本控制。

---

## 对比表（终端输出还原）

```
ID   │ Label                  │ hitRate │ citation │ confidence │ retrieved │ avgScore │ cited │ ms
T01  │ 基准 happy path          │ 0.78    │ 1.00     │ 0.56       │ 8.0       │ 0.47     │ 3.7   │ 136377
T02  │ 混合检索 vs 纯向量            │ 0.00    │ 1.00     │ 0.02       │ 8.0       │ 0.02     │ 3.7   │ 164856
T03  │ 关键词检索 vs 向量            │ 1.00    │ 1.00     │ 3.40       │ 9.0       │ 2.13     │ 4.3   │ 155282
T04  │ 小 chunk 对精度的影响         │ 0.56    │ 1.00     │ 0.55       │ 8.0       │ 0.51     │ 3.0   │ 143304
T05  │ 结构化切分                  │ 0.67    │ 1.00     │ 0.56       │ 6.0       │ 0.51     │ 4.3   │ 137538
T06  │ Transform 对向量质量的增益     │ 0.89    │ 1.00     │ 0.54       │ 8.0       │ 0.48     │ 3.0   │ 129938
T07  │ Transform + 混合检索叠加     │ 0.00    │ 1.00     │ 0.02       │ 8.0       │ 0.02     │ 4.0   │ 122151
T08  │ 多样性过滤 vs 精度过滤          │ 0.78    │ 1.00     │ 0.55       │ 8.0       │ 0.47     │ 9.3   │ 139035
T09  │ Query 扩展对召回的影响         │ 0.78    │ 1.00     │ 0.56       │ 8.0       │ 0.48     │ 4.3   │ 144046
T10  │ 多维叠加（中间配置）             │ 0.00    │ 0.89     │ 0.02       │ 10.0      │ 0.02     │ 3.0   │ 144276
T11  │ 结构化文档最优假设              │ 0.00    │ 1.00     │ 0.02       │ 4.0       │ 0.02     │ 4.0   │ 197967
T12  │ 预期最差配置（对比基准）           │ 1.00    │ 1.00     │ 3.74       │ 10.0      │ 2.42     │ 3.3   │ 111656
```

---

## 指标可信范围说明

hitRate 和 confidenceScore **在不同检索方法之间不可比较**：

| 检索方法 | 分数含义 | 典型范围 | evaluation threshold=0.5 是否合适 |
|---|---|---|---|
| dense-vector | 余弦相似度 | 0.1–0.9 | ✓ 合适 |
| hybrid-rrf | RRF 公式结果 | 0.01–0.03 | ✗ 永远=0（刻度问题）|
| bm25-chinese | BM25 词频分数 | 0.5–5.0 | ✗ 永远=1（刻度问题）|

**有效比较范围**：T01 / T04 / T05 / T06 / T08 / T09（均为 dense-vector）

---

## 核心结论

### 结论 1：heading-context Transform 是收益最高的优化（高置信度）

| 配置 | hitRate | 变化 |
|---|---|---|
| T06：recursive + heading-context + dense | **0.89** | +0.11 vs 基准 |
| T01：recursive + none + dense（基准） | 0.78 | — |

给每个 chunk 注入所属标题路径，embedding 能更准确地表达文档结构语义。

### 结论 2：小 chunk（256 字符）对结构性文档有害（高置信度）

| 配置 | hitRate | 变化 |
|---|---|---|
| T01：recursive/512（基准） | 0.78 | — |
| T04：fixed-size/256 | **0.56** | -0.22 |

PRODUCT.md 段落语义跨越 200-400 字，256 字符经常在语义单元中间截断。结论仅适用于连续叙述型文档。

### 结论 3：Filter 策略和 Query Rewrite 对本文档无明显影响（中置信度）

| 配置 | hitRate | cited（引用多样性）|
|---|---|---|
| T01：score-threshold 过滤 | 0.78 | 3.7 |
| T08：mmr-diversity 过滤 | 0.78 | **9.3** |
| T09：rule-keyword-expansion | 0.78 | 4.3 |

MMR 多样性过滤在 hitRate 相同的情况下，让 generation 引用了更多不同的 chunk（9.3 vs 3.7）。

### 结论 4：markdown-heading 切分略逊于默认 recursive（中置信度）

markdown-heading 产出更少 chunk（retrieved=6 vs 8），hitRate=0.67，低于基准的 0.78。

---

## 最优配置推荐

针对 PRODUCT.md 类型的文档（中文、结构化 Markdown、连续叙述）：

```
Chunk:      recursive / chunkSize=512 / overlap=64
Transform:  heading-context
Retrieval:  dense-vector / topK=10 / threshold=0.1
Filter:     mmr-diversity / lambda=0.5（比 score-threshold 引用更多样）
```

对应 T06（hitRate=0.89）+ T08 的 filter 策略。

---

## 指标局限性与后续改进方向

1. **hitRate 跨检索方法不可比**：BM25 和 hybrid-rrf 分数刻度与余弦相似度不同，Run-002 引入 hybrid-bm25-rrf 及调整 pipeline-filter 的 minScore 以解决此问题。
2. **citationCoverage 无区分度**：11/12 的 citationCoverage=1.00，短文档中 generation 模型总是引用所有 evidence。
3. **单文档局限**：所有结论基于 PRODUCT.md，后续应补充不同类型文档的测试 run。
