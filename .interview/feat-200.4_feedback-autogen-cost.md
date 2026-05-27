# feat-200.4 面试题：Feedbacks + Auto-Gen + Cost Summary + Cursor 分页

> Idea-Maker MVP Week 4。本题面向"讲清楚事件驱动的自动化、写时聚合、稳定分页设计"的求职/学习场景，
> 答案结合本项目实际代码（`apps/api/src/{feedbacks,cost,auto-generations,generations}/`）。

---

## 1. AutoGenerationsService 监听 `ingestion.completed`，为什么要在事件回调里显式 `tracer.run(traceId, fn)` 包一层？

**答**：因为 `AsyncLocalStorage` 的上下文不会自动跟随 `EventEmitter2.emit()` 跨越的 microtask 边界。

- HTTP 请求进入时 `TracingInterceptor.run(traceId, () => next.handle())` 启动了一个 ALS context
- `IngestionService.markSucceeded()` 在 HTTP 请求的 service 链里同步 `this.events.emit('ingestion.completed', evt)`
- `@OnEvent(..., { async: true })` 把回调推入下一个 microtask；这时进入回调的"当前 store"取决于 emit 时调用栈是否仍在 ALS 内
- 即便偶然继承到了上游 trace，也是错的：auto-gen 跟触发它的 HTTP 请求应该是两条独立的执行流，cost 不应被记到上游 trace 上

所以代码 [auto-generations.service.ts](apps/api/src/auto-generations/auto-generations.service.ts) 里：

```ts
const traceId = `auto-gen:${autoGenId}`;
await this.tracer.run(traceId, () =>
  this.generations.generate(null, projectId, query, {
    source: "auto",
    skipOwnerCheck: true,
  }),
);
```

这保证每张自动卡片有独立 trace + cost 切片，便于事后审计"这次 ingestion 衍生了多少成本"。

---

## 2. `skipOwnerCheck: true` 是不是安全漏洞？为什么允许 service 内部跳过 owner 校验？

**答**：不是漏洞，关键在**调用源**可信。

- 公开端点（controller）调 `GenerationsService.generate(userId, ...)` 时永远走 `verifyProjectOwnership`
- `skipOwnerCheck` 是 service 间内部协议，**只允许 AutoGenerationsService 用**——它的输入来自 `ingestion.completed` 事件，事件由 `IngestionService.markSucceeded()` 内部 emit，事件里的 `projectId` 早在文档上传时由 owner 校验过
- TypeScript 通过 `GenerateOptions.skipOwnerCheck?: boolean` 显式标识"危险开关"——任何 grep 都能列出所有调用点

更严的做法是把 `runForProject` 拆成两个不同签名的方法（`generateForUser` vs `generateInternal`）；MVP 阶段权衡了表面 API 数量，留 TODO 在 Phase 4 学习系统接入时再拆。

---

## 3. cursor 分页为什么用 `(created_at, id)` 复合 keyset，不直接用 `id` 或 `OFFSET`？

**答**：稳定性 + 性能。

| 方案 | 问题 |
|---|---|
| `OFFSET N` | 翻到 1000 页时 PG 仍要扫前 1000×N 行；列表新增数据会让游标"漂移"，用户翻页时看到重复或漏行 |
| 仅 `id < cursor` | id 是 uuid，没顺序，无法按时间排 |
| 仅 `created_at < cursor` | 同毫秒写入的两条 generations 用 `<` 会漏一条，用 `<=` 会重复一条 |
| **`(created_at, id) < (cursor_created_at, cursor_id)`** | 复合 keyset：created_at 主排序 + id 次排序保证全序；不重不漏 |

代码：[generations.service.ts:listByProject](apps/api/src/generations/generations.service.ts)

```sql
WHERE project_id = $1
  AND (created_at, id) < ($cursor_created_at::timestamptz, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT $limit + 1
```

`LIMIT + 1` 是判断 `hasMore` 的常见技巧：多取一条决定要不要返回 `nextCursor`，省一次 count 查询。

cursor 用 base64 编码 `{createdAt, id}` JSON：对客户端不透明（避免被解释成业务字段）、改结构时旧 cursor 自然失效。

---

## 4. `cost_summary` 为什么是按天 upsert 的预聚合表，不直接 `SELECT SUM(...) FROM generations GROUP BY day`？

**答**：trade-off 是"写时多 1 个 INSERT vs 读时全表 GROUP BY"。

读频率 >> 写频率：
- 写：每次 generate succeeded → 1 个 upsert
- 读：dashboard 首页可能每次进入都查 30 天汇总，频率高于写

直接 `GROUP BY` 的问题：
- generations.cost_breakdown 是 JSONB，提取每个数值要 `(cost_breakdown->>'llmTokensPrompt')::bigint`，无索引下全表扫
- 大项目（1 万次 generate/月）下，summary 查询会随时间 O(N) 退化

预聚合表：
- 主键 `(project_id, day)`，按天命中常驻 ~30-180 行
- ON CONFLICT DO UPDATE 一行 SQL 完成 "存在加 1 / 不存在插入" 的原子操作
- 写时一点开销换查询时几毫秒

代价：明细修复时不会自动反向更新（如手动删一条 generation）。MVP 阶段不提供"撤销" UI 所以不冲突；Phase 4 学习系统反馈数据更复杂时考虑用物化视图或事件溯源。

---

## 5. feedback 用 `UNIQUE(generation_id) + ON CONFLICT DO UPDATE` 一份覆盖式 vs 多条历史记录，trade-off 是什么？

**答**：

| 维度 | 覆盖式（本项目） | 多条历史 |
|---|---|---|
| 数据语义 | 一份"最终评分" | 评分演变轨迹 |
| 列表查询 | 直接 JOIN，每个 generation 至多一条 | 必须 `DISTINCT ON (generation_id) ORDER BY created_at DESC` 取最新 |
| 学习系统训练数据 | 干净的 (generation, rating) 对 | 多次相同 generation 对学习模型有噪声（用户改主意） |
| 审计 | 丢失中间评分 | 完整保留 |

MVP 选覆盖式：
1. 4 维评分是"用户当前满意度"快照，不是历史轨迹
2. `edit_diff` 也是覆盖式：用户改完文案保存 → 再改一次 → 只看到最终版才合理
3. SQL 简单：`INSERT ... ON CONFLICT (generation_id) DO UPDATE` 一句
4. 列表分页时不用做去重子查询

如果将来产品需要"用户评分变化趋势"，加一张 `feedback_history` append-only 表配合 trigger 即可，不影响主路径。

代码：[feedbacks.service.ts](apps/api/src/feedbacks/feedbacks.service.ts)

---

## 6. DB CHECK 约束 + service 层显式校验，是不是重复防御？

**答**：是有意的双层防御，各管一边。

DDL 写了 `CHECK (relevance IS NULL OR (relevance BETWEEN 1 AND 5))`：
- 兜底：任何来源（脚本 / 后续模块 / migration / 第三方）写脏数据都会被 PG 拦下
- 错误信息是 SQL 报错（`new row for relation "feedbacks" violates check constraint`），不友好

Service 层 `validateRatings()`：
- 提前抛 400 BadRequest，给前端可读的中文错误信息
- 不依赖 DB error 解析

两者职责：
- DB CHECK 是"数据正确性的最后一道门"，永远应该写
- Service validate 是"用户体验前置门"，让用户看到"relevance 必须 1-5"而不是 SQL 错误码

如果只留一道，要留 DB（防御深度优先）；但生产环境想给用户友好提示就必须两层都写。

---

## 7. 文档：MVP Week 4 完整新端点表

```
POST   /projects/:id/generate                  (扩展：支持 source=manual)
GET    /projects/:id/generations                cursor + status + source 分页
GET    /projects/:id/generations/:genId
POST   /generations/:genId/feedback             upsert
GET    /generations/:genId/feedback
GET    /projects/:id/cost/summary?from&to       默认最近 30 天
GET    /projects/:id/documents/:docId/auto-generations
```

加上 Week 1-3 的端点，MVP 后端 19 个端点全部就绪。Week 5 起接入前端。
