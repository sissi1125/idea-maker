# feat-200.6 补丁 — Ingestion 阶段输出 + 项目级自动摘要接入

## Q1：为什么不为"产品介绍摘要"新建一张表？

**考察点**：业务建模 vs. 重复真相源。

**答**：项目里已经有 `auto_generations`（feat-200.4）正好就是这件事的事实表——它监听 `ingestion.completed`，按 `category → card_type`（product→intro, compete→compete）触发一次 `generations.generate`，`resultNotes` 就是卡片正文。新建 `project_summaries` 会出现两份真相源：

- 一旦"项目级最新摘要"和"per-doc 自动卡片"出现不一致，回放 / 调试时无法确定哪个是真相；
- 双写也意味着触发条件和重生策略都要维护两遍。

更划算的方案：用一条 `DISTINCT ON (card_type)` JOIN `generations` 在查询时聚合出"项目级最新"，写入侧完全复用旧逻辑。新增的是**视图维度的端点**，不是新事实表。

实战教训：见到"我要个 X 摘要表"的需求，先翻一遍现有事实表，可能它已经被换个名字写出来了。

---

## Q2：`stage_outputs` 用 JSONB 而不是新建 `ingestion_stage_outputs` 关联表，会带来什么代价？

**考察点**：JSONB vs. 关系表的权衡，索引和查询模式。

**答**：

代价：
- **无法按 stage 字段做聚合查询**：例如"找出所有 embedding 阶段耗时 > 5s 的 job"需要 `(stage_outputs->'embedding'->>'durationMs')::int > 5000`，无法直接走索引；要么建 GIN，要么建表达式索引。
- **schema 漂移没保护**：rag-core 改了 metrics 形状，旧行不会自动迁移；只能在读侧做 fallback。
- **JSONB 整列重写**：`jsonb_set` 是不可变更新，每次写都重建整列；如果 stage 多了变大了，写放大放大。

为什么仍然选 JSONB：
- 5 stage 是**强相关聚合**——查询永远是"给我这个 job 的所有 stage"，从来不是"给我所有 job 的 chunk stage"；关联表只在跨 job 跨 stage 分析才有价值。
- MVP 阶段 metrics 集合还在演化，schema 加列成本高；JSONB 让前端 chip 渲染对新增 key 自动适配。
- 单 job 5 个 stage_output，每个几百字节——JSONB 重写代价可忽略。

什么时候要换成关联表：开始做"哪种 preprocess method 在 PDF 上平均最快"这类聚合分析时。

---

## Q3：`auto_generations` 是文档级（document_id），但你要展示项目级"最新产品介绍"——SQL 怎么写最高效？

**考察点**：PostgreSQL 的 DISTINCT ON 用法。

**答**：

```sql
SELECT DISTINCT ON (a.card_type)
       a.card_type, a.id, a.document_id, a.generation_id,
       g.result_notes, g.duration_ms, g.cost_breakdown,
       g.created_at AS gen_created_at,
       a.created_at AS auto_created_at
FROM auto_generations a
JOIN generations g ON g.id = a.generation_id
WHERE a.project_id = $1
  AND a.status = 'succeeded'
  AND g.status = 'succeeded'
ORDER BY a.card_type ASC, a.created_at DESC
```

要点：
- `DISTINCT ON (a.card_type)` 让 PostgreSQL 按 `card_type` 分组取**每组第一行**；
- 配合 `ORDER BY a.card_type ASC, a.created_at DESC`——"每组第一行"对应"最新一条"；
- 一次往返、无 subquery、无 window function（`ROW_NUMBER() OVER (PARTITION BY ...)` 也能写但更重）；
- 双重 status='succeeded'：`auto_generations` 表面的状态和 `generations` 真实的状态都要过——前者标记调度成功、后者标记 LLM 生成成功，缺一不可。

替代方案：window function。

```sql
SELECT * FROM (
  SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.card_type ORDER BY a.created_at DESC) AS rn
  FROM auto_generations a WHERE ...
) sub WHERE rn = 1
```

可移植性更好（标准 SQL），但 PG 上 `DISTINCT ON` 在大多数场景更快。

---

## Q4：embedding 阶段无 API key 时降级到 debug-deterministic（FNV-1a hash），UI 上为什么要明确标"⚠ mock"？

**考察点**：可观测性、隐性失败防护。

**答**：因为这是**功能上看起来成功、语义上完全错误**的典型陷阱。

降级后：
- 5 个 stage 全部 succeeded，文档状态 `ready`，UI 显示"已索引"；
- 但 chunk 的向量是 FNV-1a hash——和真实语义无任何关系；
- 后续 retrieval 用余弦相似度查回来的 chunk 顺序基本是随机的；
- 用户只会看到"为什么 Agent 答得乱七八糟"，根本不会怀疑是 embedding 出了问题。

防护手段：
- `embedding.note` 字段在 UI 上明确显示橙色 ⚠ 警告（"无 LLM API key，降级到 debug-deterministic"）；
- `metrics.mock=true` 也在 chip 中体现；
- 后续可在 retrieval 端也做检测：发现 chunk 表里有 mock 维度数据时弹 banner 让用户知道。

更早期的防护：可以在 ingestion 入口就拒绝（"必须配 LLM_API_KEY"），但这与"我先把流程跑通再接 LLM"的开发体验冲突。选可见的降级 + 强提示，比硬阻塞更友好。

---

## Q5：前端 `useEffect` 里直接调用包含 `setState` 的 async 函数会被 lint 告警，你的解法是什么？为什么不直接 `// eslint-disable`？

**考察点**：React effect 的正确写法、避免 anti-pattern 而不是绕过。

**答**：lint 规则 `react-hooks/set-state-in-effect` 是为了拦截"effect 里同步 setState → 触发新 render → 又 setState"这种级联渲染。我的实际代码是 `await fetch + setState`，setState 是异步的——但 lint 看不出来。

我选的解法是把 async fetch **内联进 effect**，配合 cancel 标记：

```ts
useEffect(() => {
  if (!projectId) return;
  let cancelled = false;
  (async () => {
    try {
      const { items } = await api.fetch(projectId);
      if (cancelled) return;        // strict mode 双调用 / 切项目时丢弃
      setSummaries(...);
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();
  return () => { cancelled = true; };
}, [projectId, reloadTick]);
```

而不是 `useCallback + useEffect(() => { cb() }, [cb])`。两个原因：
1. 内联让 effect 自包含，cleanup 拿到的 cancelled 闭包正好覆盖 fetch 全程；
2. `useCallback + setState` 是 lint 告警的根因——任何 effect 调一个 callback，lint 都按"可能同步 setState"处理。

不直接 `disable` 的原因：lint 规则虽然误报，但它指向的真实问题（cascading rerender）我用 `cancelled` 标记一起防御了。绕过 lint 是局部消除噪声，没解决根因；改写 effect 是顺手把 strict-mode 双调用、项目切换时旧请求 race 写过期数据都防住了。

---
