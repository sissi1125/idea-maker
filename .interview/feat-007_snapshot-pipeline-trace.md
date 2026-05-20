# 面试题 — Stage 快照持久化与 Pipeline 全链路追踪（feat-007）

相关文件：
- `app/lib/snapshotDb.ts` — PostgreSQL DDL + CRUD 工具函数
- `app/app/api/snapshots/route.ts` — GET（页面加载恢复）/ POST（upsert 快照）
- `app/app/api/snapshots/[stageId]/route.ts` — GET 单个 stage 快照
- `app/app/api/pipeline-runs/route.ts` — POST 保存 run / GET 列表
- `app/components/playground/PipelineTraceDrawer.tsx` — 底部全链路抽屉
- `app/components/playground/StageConfigPanel.tsx` — 快照栏 UI
- `app/components/playground/PlaygroundShell.tsx` — 快照注入 + 状态恢复

---

## Q1：为什么需要 stage 快照？它解决了什么实际问题？

**答：**

**问题：** 在 RAG pipeline 调试中，某个 stage 有 3 种方法需要对比（如 chunk 的 fixed-size / recursive / markdown-heading），但每次切换方法都需要重新跑所有上游 stage（preprocess → chunk），耗时且繁琐。

**快照的作用：** 每个 stage 成功运行后自动将结果（params、upstreamOutput、output、durationMs）持久化到 PostgreSQL 的 `stage_snapshots` 表。下次测试同一 stage 时，可以直接加载上次的快照作为上游输入，无需重跑上游链路。

**实际效果：**
- 测试 chunk 的 3 种方法：跑一次 preprocess → 快照保存 → 之后只需切换 chunk method/params 重跑，preprocess 不用再跑
- 跨会话持久化：关闭页面再打开，上次的 pipeline 状态自动恢复

---

## Q2：`stage_snapshots` 表的 UNIQUE INDEX 是什么？为什么这样设计？

**答：**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_snapshots_stage_id
  ON stage_snapshots (stage_id);
```

**设计意图：** 每个 stage 只保留一条最新快照，通过 `ON CONFLICT (stage_id) DO UPDATE` 实现 upsert。

**理由：**
- **空间效率**：快照的核心用途是"用上次的结果作为输入"，只需最新版本即可
- **查询简单**：按 stageId 查询直接命中，不需要版本管理
- **与 pipeline run 分工**：完整历史由 `pipeline_run_history` 承载（手动保存整条 pipeline 快照），stage 快照只负责单步 replay

---

## Q3：页面加载时如何自动恢复上次的 pipeline 状态？

**答：**

**实现机制（三层）：**

1. **API 层**：`GET /api/snapshots` 返回所有 stage 的最新快照列表（`listAllSnapshots`）

2. **前端 useEffect**：PlaygroundShell 挂载时请求这个接口，如果当前会话 `stepRuns` 为空，则将快照数据填入：

```typescript
useEffect(() => {
  fetch("/api/snapshots")
    .then(r => r.json())
    .then(data => {
      if (Object.keys(prev).length > 0) return prev; // 不覆盖本次会话数据
      const restored: StepRunMap = {};
      for (const snap of snapshots) {
        restored[snap.stageId] = [{
          id: `${snap.stageId}-snapshot`,
          status: "success",
          output: snap.output,
          ...
        }];
      }
      return restored;
    });
}, []);
```

3. **降级处理**：未配置 `DATABASE_URL` 时 API 返回 `{ snapshots: [] }`，前端静默处理，不报错不阻断。

**防覆盖设计：** `Object.keys(prev).length > 0` 判断确保只在会话完全新鲜（没有任何运行记录）时才从快照恢复，避免刷新页面意外覆盖正在进行的测试数据。

---

## Q4：快照上游注入（Snapshot Upstream Injection）是如何工作的？

**答：**

用户在 StageConfigPanel 的"快照栏"点击"使用此快照作为上游输入"后，触发：

```typescript
// PlaygroundShell
const handleLoadSnapshotUpstream = (stageId, upstreamOutput) => {
  setSnapshotUpstreamMap(prev => ({ ...prev, [stageId]: upstreamOutput }));
};
```

之后当用户点击 Run 时，`handleRun` 优先使用注入的上游：

```typescript
const injectedUpstream = snapshotUpstreamMap[stageId];
if (injectedUpstream !== undefined) {
  upstreamOutput = injectedUpstream;  // 使用快照，不走 STAGE_DEPS
} else {
  upstreamOutput = latestRun(resolveEffectiveUpstream(stageId, ...))?.output ?? null;
}
```

Run 按钮文案同时变为"▶ 运行（快照输入）"，给用户明确的视觉提示当前使用的是注入上游而非实时上游。

---

## Q5：PipelineTraceDrawer 的两个 Tab 分别展示什么？数据从哪里来？

**答：**

**Tab 1 — 当前运行（Current Run）：**
- 数据来源：PlaygroundShell 的 `stepRuns`（内存，本次会话的运行记录）
- 展示：所有 stage 按 group（ingestion / retrieval / generation）分组，每行显示状态（绿/黄/红点）、方法名、耗时，点击内联展开 output/trace（复用 JsonView 组件）
- 用途：一眼看清整条 pipeline 哪些 stage 成功/失败/未运行

**Tab 2 — 历史记录（History）：**
- 数据来源：`pipeline_run_history` 表（PostgreSQL），用户手动点击"💾 保存本次 Run"时触发 `POST /api/pipeline-runs`
- 展示：按时间降序排列的完整 pipeline 快照，支持展开查看每个 stage 的 output 和 trace
- 用途：横向对比不同配置下的端到端结果（如"dense-vector vs hybrid-rrf 对生成质量的影响"）

**JsonView 复用：** PipelineTraceDrawer 和 OutputTracePanel 共用 `app/components/playground/JsonView.tsx`（从 OutputTracePanel 提取），避免代码重复，同时保持大向量折叠、字符串截断等行为一致。
