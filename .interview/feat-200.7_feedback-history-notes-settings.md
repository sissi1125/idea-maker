# feat-200.7 — 反馈 / 历史 / 笔记库 / Settings

## Q1：反馈表 `feedbacks` 的 `UNIQUE(generation_id)` 约束是什么用意？为什么不让一个用户多次提交不同评价？

**考察点**：业务模型 vs. 数据完整性、upsert 语义。

**答**：

`generation_id UNIQUE` 是有意约束——一条 generation 只允许一份"当前评价"，再次提交走 `ON CONFLICT(generation_id) DO UPDATE` 整体覆盖。这反映了产品语义：

- 反馈是"用户对这次生成的当前看法"，是状态而不是事件流；
- 多份评价容易让训练数据出现自我矛盾（早期评 5 星、改过后评 2 星，哪份是真信号？）；
- UI 上对应"已评 4.0 / 5（点击修改）"——一份现行评价 + 可覆盖。

如果产品改成"评价时序日志"（运营想看用户态度变化），就要把 UNIQUE 去掉、加 `created_at` 索引，前端按时间排序。MVP 阶段先求简，约束守住单一真相。

副作用：用户先评分再改的"二次反馈"信号丢失。补救方案是在 audit log 里另记一份历史，但 MVP 不上。

---

## Q2：笔记表 `notes` 的 `generation_id ON DELETE SET NULL`，为什么不用 CASCADE 或者 RESTRICT？

**考察点**：外键策略与"用户资产" vs "事实记录"的解耦。

**答**：

三种选项各自表达不同的产品意图：

- **CASCADE**：generation 删除 → 笔记也删。等于把笔记当成 generation 的衍生品。坏处：用户精心编辑保存的"内容资产"会被一个清理操作连根拔掉。
- **RESTRICT**：generation 存在笔记引用就不让删。坏处：清理脏 generation 时报错失败，运维成本高。
- **SET NULL**（选）：generation 被删 → 笔记保留，只是失去来源溯源。语义上承认"用户的精品筛选已经把内容沉淀成独立资产"，跟 generation 的生命周期解耦。

这背后是更宏观的判断：**generations 是事实表，体量大、清理频繁；notes 是用户资产，体量小、要尽量保留**。两类表应该有不同的留存策略。

实践上：清理掉 90 天前的 generations 不影响用户笔记；但用户主动删笔记肯定走 DELETE 笔记 endpoint，不会触动 generation。

---

## Q3：FeedbackPanel 展开时为什么要先 GET 一次现有反馈再渲染表单？空表单不是更省一次往返吗？

**考察点**：UX 直觉 vs. 数据一致性。

**答**：

省一次往返表面上对，但破坏 UX 一致性：

场景：用户在 Chat 主页评了 4 星，关页面，三天后去历史页找到这条 generation 展开——如果 FeedbackPanel 渲染空表单，用户会以为没评过，再评一次（可能这次没仔细想，给了 3 星）。`upsert` 直接覆盖了之前的 4 星，旧评价丢失。

正确做法：

1. 展开面板 → GET `/generations/:id/feedback`；
2. 有反馈就预填表单（评分 + edit diff + comment 全部恢复）；
3. 用户在已有评价基础上"继续修改"，提交时仍走 POST upsert——但意图上是"修订"，不是"覆盖未读"。

代价：每次展开多一次 GET（~50ms 上下，缓存命中可降到 ~10ms）。换来用户始终看到"当前真实评价"，避免无意覆盖。

更进一步可以缓存：用 react-query / SWR 的 cache + revalidate 策略让相同 generation 反复展开不重复拉。MVP 阶段没必要引入这一层。

---

## Q4：notes 列表 API 用 `limit+offset` 而不是 `cursor`，跟 generations 端点的 cursor 分页不一致，为什么？

**考察点**：分页方案权衡，"工程一致性 vs 实用价值"。

**答**：

两套分页 API 不一致确实是认知开销，但这里是有意的选择：

**generations 用 cursor 是因为**：

- 体量大（每个项目每天可能几百条 auto-gen + 用户手动 generate）；
- 写入持续不断；offset 分页深处会随写入抖动（第 5 页可能漏行或重复）；
- 也不需要 total 计数。

**notes 用 limit+offset 是因为**：

- 体量小（用户筛选过的精品库，单项目预计 < 500 条）；
- 写入低频（用户主动保存）；
- 笔记库页面需要展示总数（"共 N 条笔记"），cursor 不返回 total，offset 天然支持；
- 实现简单；前端拼 query 即可。

什么时候要切到 cursor：

- 单项目笔记 > 5000 条（极少见）；
- 笔记开始接受异步写入（如批量导入）导致 offset 飘移；
- 总数已经退化为"显示 1000+"这种近似值，total 价值不大。

这个权衡的关键判断：分页方案不是"哪个更高级"，而是"匹配实际访问模式"。在小列表上强行 cursor 是过度工程。

---

## Q5：你在 settings 页修了 `react-hooks/set-state-in-effect` 的 lint 错——同样的模式 `useCallback(load) + useEffect(() => load(), [load])` 在很多 React 教程里都见过。为什么这条规则要拦截它？你的修复有没有副作用？

**考察点**：React 18+ 的 effect 思想、cascading rerender、容易被忽视的副作用。

**答**：

规则拦截这种模式，是因为 effect 体里同步调用 `setState`（直接或间接）会触发**额外的渲染**：

```ts
const load = useCallback(async () => {
  setLoading(true);  // 同步 setState → 触发 rerender
  const data = await fetch();
  setData(data);
  setLoading(false);
}, []);
useEffect(() => { load() }, [load]);
// → mount: render → effect runs → setLoading(true) → rerender →
//   await tick → effect cleanup? → ...
```

虽然 React 会 batch 部分 setState，但在 strict-mode / concurrent mode 下，effect 可能被双重调用，导致 cascading rerender 或竞态。

我的修复方案：

```ts
useEffect(() => {
  if (!projectId) return;
  let cancelled = false;
  (async () => {
    if (cancelled) return;
    setLoading(true);
    try { /* fetch + cancelled-guarded setState */ }
    finally { if (!cancelled) setLoading(false); }
  })();
  return () => { cancelled = true; };
}, [projectId]);
```

副作用 / 改进：

1. **解决 race condition**：projectId 切换时旧请求的 setState 被 cancelled 拦下，不会写入新项目的视图；
2. **strict-mode 双调用安全**：mount → cleanup → mount 这一连串里 setState 都受控；
3. **代价**：失去了 `load()` 作为独立函数供外部按钮调用的能力。如果需要"刷新按钮"，可以加一个 `reloadTick` 计数器，按钮 `setReloadTick(t=>t+1)`，把 tick 也加进 useEffect deps。

这条 lint 规则的真正价值不是阻止你写代码，而是**逼你把 effect 当成"双向同步外部状态"来设计，而不是当成 lifecycle 钩子**。后者是 React class 时代的思维。

---
