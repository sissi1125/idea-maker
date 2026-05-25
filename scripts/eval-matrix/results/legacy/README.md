# 测试结果目录说明

每个目录对应一次完整的评估矩阵运行。目录名格式为 `run-NNN-YYYYMMDD`，
NNN 为脚本自动递增的序号（运行时连续，不代表实验编号）。

| 目录 | 实验 | 文档 | 核心变化 | 结论摘要 |
|------|------|------|---------|---------|
| run-001-20260520 | Run-001 | PRODUCT.md | 基础矩阵，score-only rerank | heading-context +11% hitRate；256 chunk -22% |
| run-003-20260520 | Run-003 | PRODUCT.md | pipeline-rerank + hybrid-bm25-rrf + pipeline-filter | reranker 主导质量，上游配置差异被抹平 |
| run-004-20260521 | Run-004 | PRODUCT.md | scoreThreshold 0.5 → 0.2 | markdown-heading 反超 recursive（0.67 vs 0.56）|
| run-007-20260522 | Run-005 | PRODUCT.md | 聚焦 3 种 chunk 方法 × 6 query | 三方法平均相同（0.61）；大 chunk 利于单章节，小 chunk 利于跨章节 |
| run-006-bloomnote | Run-006 | Bloomnote PRD | 换文档（12,358 字符，30+章节）| T01/T03=0.78 > T02=0.72；跨章节优势再次确认 |

> run-002（数据丢失）、run-005/006/008/009（启动失败）、run-010/011（合并入 run-006-bloomnote）已删除。

详细分析见各目录下的 `analysis.md`。
完整实验设计见 `docs/EVAL_MATRIX.md`。
