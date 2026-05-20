# 面试题 — 自动化评估矩阵（feat-008）

相关文件：
- `docs/EVAL_MATRIX.md` — 功能设计文档
- `scripts/eval-matrix/test-matrix.json` — 12 个 test case 配置
- `scripts/eval-matrix/run-matrix.ts` — 主执行脚本
- `scripts/eval-matrix/collect-metrics.ts` — 指标提取
- `scripts/eval-matrix/report.ts` — 报告生成

---

## Q1：为什么不做全量排列组合，而是手工设计 12 个 test case？

**答：**

全量排列的问题是**组合爆炸**。本项目有 5 个维度：

- D1 Chunk：3 种方法
- D2 Retrieval：3 种方法
- D3 Transform：2 种方法
- D4 Filter：2 种方法
- D5 Query Rewrite：2 种方法

全量组合 = 3 × 3 × 2 × 2 × 2 = **72 种**。每种还要跑 3 个 query，72 × 3 = **216 次 API 调用链**，每次链路需要 embedding + generation（LLM 调用），成本和时间都不可控。

手工设计 12 个 test case 的选择原则：

1. **T01 作为基准**：所有维度取默认值，作为对比参照点
2. **单维变化**：T02/T03 只改 D2，T04 只改 D1，T05 只改 D1——确保每个维度的独立影响可被测量
3. **叠加验证**：T07/T10/T11 多个维度同时改变，验证组合效应
4. **边界覆盖**：T12 是预期最差配置（小 chunk + 关键词检索），用于验证基准是否真的更好

这样 12 个 case 用 36 次 API 调用链就能覆盖主要假设，成本可控。

---

## Q2：hitRate、citationCoverage、confidenceScore 各自能诊断什么？

**答：**

这三个指标来自 evaluation stage，不需要 ground truth，直接从 pipeline trace 计算：

```
hitRate          = evidence[score ≥ threshold].length / totalEvidence
citationCoverage = citedEvidence.length / totalEvidence
confidenceScore  = mean(score of citedEvidence)
```

**诊断逻辑：**

| 症状 | 定位 |
|------|------|
| hitRate 低 | 检索质量差：chunk 太大/太小、embedding 维度不匹配、threshold 设置不当 |
| citationCoverage = 0 | Evidence-first 原则被违反：generation prompt 没有要求标注引用，或 evidencePack 透传断链 |
| citationCoverage 低但 hitRate 正常 | 生成模型选择性忽略 evidence；或 rerank/filter 截断导致 evidence 太少 |
| confidenceScore 低 | 被引用的 chunk 相关性差：retrieval 方法选择不当，或 query 和文档内容语义距离远 |

**局限性：** 这三个指标都是"系统自我评价"——hitRate 衡量系统自己打出的分数，不代表检索结果真的正确。这是**第二类指标**（无 ground truth）的固有边界。

---

## Q3：不同 ingestion 配置如何在同一个数据库里互不干扰？

**答：**

本项目采用**串行运行 + truncate 隔离**方案：

每个 test case 的 storage stage 传入 `truncateTable: true`，在写入前执行 `TRUNCATE rag_chunks`，清空上一个 test case 的向量。

```
T01 ingestion → TRUNCATE → 写入 T01 向量 → T01 retrieval × 3
T02 ingestion → TRUNCATE → 写入 T02 向量 → T02 retrieval × 3
...
```

**为什么不用 documentVersionId 隔离？** 理论上可以给每个 test case 创建不同的 document version，retrieval 时按 version 过滤。但这需要修改 retrieval route 支持 version 过滤参数，引入额外实现成本，且 test case 数据会在 DB 里积累。truncate 方案更简单，对 CLI 工具完全够用。

**代价：** 不能并行执行 test case，只能串行。对 12 个 case 来说可以接受（约 5-10 分钟）。

---

## Q4：为什么用 3 个固定 query，而不是 1 个？

**答：**

用单个 query 评估时，结果对这个 query 的特殊性高度敏感——如果这个 query 恰好和某种 chunk 方式高度契合，会高估该配置的泛化能力。

3 个 query 覆盖了不同的检索难度：
- **Q1**（宽泛语义）：考验向量检索的语义理解能力
- **Q2**（精确关键词）：BM25 通常有优势，dense-vector 可能不如
- **Q3**（语义模糊）：考验 query rewrite 和 hybrid retrieval 的补救能力

3 个 query 的指标取平均，能更稳健地反映配置的综合表现，避免"偶然好"的误判。

**取平均的前提假设：** 3 个 query 代表性足够，没有极端偏差。如果后续发现某类 query 的结果和其他两个差异极大，应该单独展示而不是平均。

---

## Q5：test matrix 的设计本质是什么？与 A/B 测试有什么区别？

**答：**

test matrix 是**多因素实验设计**的简化版本。严格的实验设计（如 factorial design 全因子设计）要求每个维度的所有水平都完全交叉，才能准确分离各因素的主效应和交互效应。

本项目用的是**部分因子设计（fractional factorial）**的思路：

- 选择覆盖主效应的最小必要组合（T01-T05 单维变化）
- 加入少量交互验证（T07/T10/T11 多维叠加）
- 设置边界对照（T12 预期最差）

与 A/B 测试的区别：
- A/B 测试：同一时间、随机流量、单一变量，目的是统计显著性
- test matrix：固定数据集、固定 query、系统性多变量，目的是快速定向筛选

test matrix 不提供统计显著性保证，但在调试场景（快速找出哪类配置更好）中足够用，且成本远低于严格 A/B 测试。

---

## Q6：如果某个 test case 的 embedding 调用失败，脚本应该怎么处理？

**答：**

脚本应采用**fail-fast + 结果部分保存**策略：

1. **每个 stage 调用后检查 HTTP 状态和 trace.status**：如果任一 stage 返回错误，当前 test case 标记为 `failed`，记录错误信息到 `T0x_error.json`，**跳过当前 test case 继续执行下一个**（不终止整个矩阵）。

2. **Ingestion 失败 vs Retrieval 失败处理不同：**
   - Ingestion 失败（preprocess/chunk/embedding/storage）：整个 test case 跳过，因为后续 retrieval 无数据可查
   - 单个 query 的 retrieval 失败：标记该 query 为失败，其余 query 继续，最终用成功的 query 计算均值

3. **最终报告中显式标出失败的 test case**，不用 0 填充，避免将失败误读为"指标为 0"。

```json
{
  "testId": "T06",
  "status": "failed",
  "error": "embedding API: 401 Unauthorized",
  "metrics": null
}
```

这样即使部分 test case 失败，其他 case 的结果仍然有效，报告可以正常生成。
