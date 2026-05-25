# Eval Matrix 实验结果目录

按时间阶段 + 实验系列组织。

```
results/
  legacy/                      # 历史实验（feat-008 时期，run-001~016）
    README.md                  # 原始 README，含历史 run 索引
    cross-run-analysis.md      # 跨 run 综合分析
    feat-009-impact-assessment.md
    run-001-20260520/
    run-003-20260520/
    ...
    run-016-20260522/

  current/                     # 当前进行中的实验系列
    experiment-4-citation/     # 实验四：Citation 上下文扩展
      run-001/                 # 第一次 run（即原 run-016-experiment4-citation）
        analysis.md
        summary.json
        T0X_QY.json
        T0X_summary.json
      run-002/                 # 后续 run（按需）
      ...
    experiment-5-xxx/          # 后续新实验系列
```

## 命名约定

- **legacy/run-NNN-YYYYMMDD/**：旧的全局自增编号 + 日期格式，保持历史不变
- **current/<experiment>/run-NNN/**：实验系列内自增编号，目录名更短

## 如何启动新的实验 run

```bash
# 进入实验四系列，自动落到 current/experiment-4-citation/run-NNN/
EXPERIMENT=experiment-4-citation npx tsx scripts/eval-matrix/run-matrix.ts

# 开启新实验系列（路径会自动创建）
EXPERIMENT=experiment-5-chunksize npx tsx scripts/eval-matrix/run-matrix.ts

# 指定具体 run 目录名（覆盖自增逻辑）
RUN_ID=current/experiment-4-citation/baseline-rerun npx tsx scripts/eval-matrix/run-matrix.ts
```

不设 `EXPERIMENT` 时，结果落到 `results/` 根，行为兼容旧脚本调用。

## 实验系列索引

### legacy

详见 `legacy/README.md`。共 12 次 run，涉及 chunk 方法 / retrieval 方法 / transform / rerank / scoreThreshold 调优。

### current

| 系列 | 主题 | 起始日期 | 状态 |
|---|---|---|---|
| `experiment-4-citation` | Citation 上下文扩展（chunk / adjacent / section 对比） | 2026-05-25 | 进行中 |
