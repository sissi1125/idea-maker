# feat-300.4 面试题：Memory 子系统（Distiller + Notes Embedding）

> 围绕「**为什么**这么做」展开，不止「**做了什么**」。每题都附「**关键差异化答案**」。

---

## 1. 为什么 edit_diff 是核心信号，不是 1-5 评分？

**关键点**：信号密度不同。

- 评分是粗粒度：只知道「用户觉得好不好」（1 bit-ish）
- 评论是中粒度：「太长了」「不够具体」（短文本，多义）
- **edit_diff 是细粒度**：用户**实际改写**位置，能反推「LLM 输出和用户意图的差异」

举例：用户改「使用了一段时间皮肤好极了 🎉」→「用了一段时间皮肤更稳定」。从 diff 推得偏好：① 删 emoji（taboo）② 改"好极了"→"更稳定"（style：克制语气）。这两条偏好只看 5 分还是 3 分推不出来。

蒸馏价值排序：**edit_diff > comment > 评分**。Distiller 选 batch 时优先带 edit_diff 的 feedback，对应 SQL：`ORDER BY (f.edit_diff IS NOT NULL) DESC`。

---

## 2. 为什么用 EventEmitter2 + @OnEvent 而不是 FeedbacksService 直接 inject MemoryDistiller？

**关键点**：解耦循环依赖 + 失败隔离。

- 循环依赖：MemoryDistiller 需要读 feedback 详情（如果直接 inject），而 FeedbacksService 又要调 MemoryDistiller → 循环
- 失败隔离：蒸馏调 LLM 可能 fail（API timeout / 限流），不应该阻塞 feedback 提交。事件总线让两个模块**互不知道对方**：FeedbacksService 只管 emit + return，订阅方失败由 try/catch 吞掉

代码佐证：`memory-distiller.ts onFeedbackUpserted` 把所有异常 catch 后写 logger，不向上抛。

---

## 3. 累计 5 条新 feedback 触发蒸馏，怎么定义「新」？

**关键点**：水位线模式（high-water mark）。

- 不存独立 `last_distill_run_at` 表 → 加复杂度
- 用 `agent_memory.last_distilled_at` 列作为水位锚，所有 distilled 行共享一个时间戳
- 计数 SQL：`COUNT(*) FROM feedbacks JOIN generations WHERE updated_at > MAX(agent_memory.last_distilled_at)`
- 项目从未蒸馏过 → `COALESCE(MAX(...), 'epoch'::timestamptz)` 兜底为 1970，首次必触发

设计权衡：每次事件查一次 COUNT(*) 看似冗余，但 PG 走索引 + 项目级 feedback 体量小（< 100 条），实测 < 5ms。换成「内存 Counter Map」反而不能跨进程一致。

---

## 4. 为什么蒸馏 candidates upsert 用「内存级判重」而不加 UNIQUE INDEX？

**关键点**：长 TEXT 不适合做索引列。

- agent_memory.content 可能是 1~2KB 的偏好描述（含中文）
- 在长 TEXT 上加唯一索引性价比极低：索引膨胀、写慢
- 项目级 memory 体量 < 50 条，**全量 SELECT + 内存 .find()** 性能足够

合并语义：
- confidence 取 `max(existing, new)`（避免被回退）
- source_feedback_ids 数组去重合并
- last_distilled_at 更新（推水位）

---

## 5. notes embedding 失败时返回 null 而不抛错——这是好工程吗？

**关键点**：分层降级（graceful degradation）。

- embedding 是**检索时的优化**，不是数据完整性约束
- 用户保存笔记是同步操作，期望立即成功；embedding API 挂了不应该让用户「重试 3 次还是 500」
- NULL 笔记由 search_notes tool 的 ILIKE fallback 召回

什么时候不应该这么做：**写入路径的数据完整性失败**（如 hash 校验失败、外键违反）必须抛错，不能静默落库脏数据。embedding 不属于这一类。

---

## 6. pgvector HNSW vs IVFFLAT，为什么选 HNSW？

**关键点**：数据量决定。

- IVFFLAT 需要预先 `ANALYZE` 学习簇心，**数据量小时召回率差**，且需要 INSERT 一定量后 REINDEX
- HNSW 构建即用、查询恒定 O(log N)，**适合 notes 这种「项目 100 条」量级**
- 代价：HNSW 索引占内存大 (~40 字节/向量 × dim)；rag_chunks（百万级）才会算这笔账

DDL：`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`。注意是 `vector_cosine_ops`（不是 l2）—— text embedding 模型通常用余弦相似度训练。

---

## 7. search_notes tool 双路径（embedding 优先 + ILIKE fallback），为什么不直接全部走 embedding？

**关键点**：迁移期 + 服务可用性。

1. **历史数据**：feat-300.4 上线前的 notes embedding 全是 NULL，HNSW 索引扫不到
2. **服务挂掉**：embedding API 临时不可用时，至少 ILIKE 还能给出结果，agent 不会因 search_notes 直接报错而中断 ReAct
3. **返回结构标记 `mode: 'embedding' | 'ilike'`**：让 LLM（甚至 trace 调试者）知道这次是语义还是字面匹配，相关性参考权重不同

防御深度（defense in depth）的工程实践。

---

## 8. distill prompt 要求严格 JSON 输出，怎么应对 LLM 偶尔不听话加 ```json 围栏？

**关键点**：解析层兜底，prompt 层别傲娇假设。

```ts
const stripped = text.trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/i, "");
let parsed; try { parsed = JSON.parse(stripped); } catch { return []; }
```

- prompt 明确 "禁止 markdown 围栏" 是 P1，**解析层 strip 围栏是 P0 兜底**
- JSON.parse 失败返回空数组，不抛错（蒸馏失败不应炸事件链）
- candidates 字段缺失 / kind 非法 / confidence 越界 / sourceFeedbackIds 不是数组 → 全部过滤掉

**LLM 输出永远不要假设结构正确**。这跟前端「客户端校验 + 服务端校验」双层防御同思路。

---

## 9. PromptDefinition 加 version 字段，未来怎么用？

**关键点**：Prompt = 源代码，必须可回归。

- 3 个月后看一条不及格的 trace，要立刻知道用的是 v1 还是 v2
- 与 agent_steps 关联：每次 prompt 渲染时把 `{promptId, promptVersion}` 写入 step 的 input JSONB
- 类比 LangChain LangSmith 的「Prompt 即资产」思路（但他们要付费，我们自建）

升级路径：未来加 `evaluation runs` 表，对比 v1 vs v2 的 faithfulness 分数。

---

## 10. 单进程串行锁防并发蒸馏，多实例部署怎么办？

**关键点**：明确 MVP 边界 + 升级路径。

当前：`private inFlight = new Set<projectId>()` 单进程级。

多实例（如 fly.io 多 region 部署）会出现：
- 实例 A 收到 feedback.upserted → 触发 distill
- 实例 B 同时收到另一条 → 也触发 distill
- 两边并行写 agent_memory，merge 逻辑虽然能避免重复，但浪费 2x LLM 调用

升级到分布式锁：Redis `SETNX projectId:distill 1 EX 60`，TTL 防进程死锁泄漏。

什么时候做：监控到「同一项目 5 分钟内 distill 跑了 ≥ 2 次」这种信号出现。**YAGNI 原则**：MVP 阶段单 worker 部署不需要。
