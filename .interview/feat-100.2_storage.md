# 面试题 — Storage Stage 抽取（feat-100.2 第 6 站，ingestion 收尾）

相关文件：
- `packages/rag-core/src/ingestion/storage.ts` — runStorage + DDL + 3 method + dim guard
- `packages/rag-core/src/ingestion/__tests__/storage.test.ts` — 19 单测（全部 mock PgClient）
- `packages/shared-types/src/pipeline/storage.ts` — `PgClient` 最小接口契约
- `apps/web/app/api/pipeline/storage/route.ts` — 薄路由（128 行，原 450 行）

---

## Q1：storage 是 ingestion 收尾，它的核心职责是什么？为什么不能省略？

**答：**

把 embedding 产出的向量 + chunk 元数据持久化到 pgvector 数据库，让后续检索能查到。

不能省略的原因：
1. **检索的物理基础**：向量必须存在数据库里，retrieval stage 才能 `SELECT * ORDER BY embedding <=> query_vec LIMIT K`
2. **持久性**：embedding 计算贵（OpenAI ~$0.02/1M token），不能每次都重跑
3. **版本管理**：文档更新后需要追踪历史版本（pgvector-new-version）或替换最新（replace-version）
4. **元数据筛选**：检索时常需要按文档、章节、关键词预过滤，必须在 DB 索引层做

不存储 = 不能做生产 RAG，只能做演示。

---

## Q2：`PgClient` 接口只声明了 `query` 一个方法。为什么不直接用 `pg.Client` 类型？

**答：**

**同 embedding 的 OpenAICompatibleClient 设计**：

```ts
// shared-types/pipeline/storage.ts
export interface PgClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}
```

四点原因：
1. **shared-types 零依赖**：不引入 `pg` 包（4MB+ 类型定义）
2. **职责窄化**：rag-core 只用 `query`，不需要 `connect/end/transaction`，那些是路由层 lifecycle 关心点
3. **测试简化**：单测只需 `vi.fn()` 造一个 `query` 方法即可，不用 mock 整个 pg.Client
4. **可替换性**：今天用 pg.Client，明天换 pg.Pool、Drizzle、Prisma 都不动 rag-core——只要新 client 有兼容的 `query` 方法

代价：rag-core 不能用 pg 的高级特性（`copyFrom` 批量插入、prepared statement、events）。如果未来需要，再扩 `PgClient` 接口；现在最小化。

---

## Q3：storage 一次性涉及多个 DB 操作：DDL、truncate（可选）、Dimension Guard、版本决定、INSERT、CREATE INDEX。为什么不拆成多个函数？

**答：**

**事务一致性 + 调用方便**：

如果拆成 `initSchema / checkDimension / writeChunks / createIndex` 4 个独立函数：
- 路由层要按顺序调用 4 次，每次传 client
- 中间任何一步失败，状态可能不一致（chunks 写了但索引没建）
- 路由层承担了"知道正确顺序"的责任，鞋拔子塞给上层

`runStorage(input): Promise<StorageResult>` 一把抓：
- 内部明确顺序（DDL → Guard → 写 → 建索引）
- 失败时抛 PipelineError，路由层只关心错不错
- 调用方代码量极小（`const result = await runStorage({...})`）

代价：函数变长（200 行），但每段职责清晰。如果未来需要"只检查不写"的 dry-run 模式，再拆。**先合后拆**比"先拆后合"工作量小。

注：这里**没有用 transaction**——如果用，几个 ALTER + DDL 都 wrap 在 BEGIN/COMMIT 里。当前实现允许部分成功（Guard 过了但写入失败时表已经初始化）。生产环境应该上 transaction，待 feat-100.3 NestJS 重构时一并处理。

---

## Q4：路由层 `await client.connect()` 然后 `try { runStorage(...) } finally { await client.end() }`。为什么 lifecycle 不放在 rag-core 内？

**答：**

**关注点分离 + 客户端复用**：

如果 rag-core 内部 `new Client + connect + end`：
- 每次 runStorage 都建立 + 销毁连接，开销大（TCP 握手 + auth）
- 路由层无法复用同一 client 跨多个 stage（如先 storage 后 retrieval 共享 connection pool）
- 测试时要 mock 整个连接生命周期

当前设计：
- rag-core 收到"已连接"的 client，直接用
- 路由层管理 connection lifecycle，自由决定单次还是 pool
- 单测注入 `{ query: vi.fn() }`，零连接成本

**类比**：好的库提供 file descriptor 操作接口，但不自己 `open` 文件——文件 lifecycle 归调用方。pg lib 自身的 `Client` vs `Pool` 设计也是同理。

未来上 Pool 后路由层改成 `const pool = new Pool(...); const client = await pool.connect(); try { runStorage(...) } finally { client.release() }`，rag-core 零改动。

---

## Q5：Dimension Guard 检测到表中已有 1536 维向量，本次写入 4 维，应该怎么处理？

**答：**

**抛 dimension_mismatch + 给出可选方案**：

```ts
throw new PipelineError(
  "dimension_mismatch",
  `Dimension Guard 失败：表内已有维度为 ${existing} 的向量，本次写入维度为 ${incoming}。
   可选方案：①开启 truncateTable=true 清空历史数据；
            ②使用相同 embedding provider；
            ③改用 pgvector-replace-version 方法（仅删除当前文档的旧向量）。`,
  { existingDimension: existing, incomingDimension: incoming },  // details for programmatic
);
```

**为什么这是 RAG 生产事故源**：
- 不同 provider 维度不同：OpenAI 3-small 1536、Qwen v4 1024、bge-small 384
- 一个 chunk 1536d 一个 4d 共存在同表，余弦相似度计算结果是垃圾
- pgvector 内部不会校验维度（vector(N) 才会），写入时不报错，检索时拿到错误结果——**静默 data corruption**

Guard 在 SELECT 阶段就拦截，在错误发生前阻止；错误信息含三个可选方案让用户能立即修复：
1. truncate（开发场景，丢历史无所谓）
2. 换 provider（一致性最重要）
3. 改 replace-version（只清当前文档，保留其他文档历史）

这种"主动诊断 + 提供修复指引"是 rag-core 哲学的核心——错误信息应该是 actionable 的。

---

## Q6：单测全部 mock PgClient，没有真连数据库。这种"全 mock"测试有意义吗？测得到什么？

**答：**

**测的是"业务逻辑"，不是"DB 行为"**：

| 测的 | 不测的 |
|------|--------|
| 3 method 各自决定 version 的算法 | INSERT 是否真的写入 |
| Dimension Guard 抛错时机 | pgvector 索引性能 |
| truncate=true 触发哪些 SQL | UNIQUE 约束是否真的报 23505 |
| 索引模式 hnsw / ivfflat / none 分支 | HNSW 实际召回质量 |
| 错误码（missing_client / empty_chunks / dim_mismatch）的语义 | pg.Client.connect 行为 |
| INSERT 语句包含 ON CONFLICT vs 不包含 | pg 协议层兼容性 |

**为什么够用**：
- 算法层 bug（version 算错、传错 documentId、enhancedText fallback 漏了）这些都是 mock 能抓到的
- DB 行为是 pgvector 团队的责任，他们有自己的测试套
- 真连 DB 的集成测试是另一层（dev server + 真实 PostgreSQL），属于 idempotency / preprocess 已建立的"路由层手测"

**反例**："必须用真实 PG"派的工程师容易陷入：
- CI 要起 PostgreSQL container（慢、复杂）
- 测试相互污染（一个测试创了表，下一个测试看到了）
- 偶发失败（PG 网络抖动 → 单测随机红）

mock 单测快、稳、聚焦——是单测应有的样子。

---

## Q7：HNSW 和 IVFFlat 两种向量索引有什么区别？什么时候用哪个？

**答：**

两者都是**近似最近邻**（Approximate Nearest Neighbor, ANN）算法，回答"找最相似的 K 个向量"。

| 维度 | HNSW | IVFFlat |
|------|------|--------|
| 数据结构 | 多层小世界图 | 倒排文件 + 桶 |
| 查询速度 | 快（log N） | 中等（O(N/lists)） |
| 召回率 | 高（>95% 默认参数） | 取决于 nprobe 参数 |
| 构建速度 | 慢 | 快 |
| 内存占用 | 大（图结构） | 小 |
| 适合数据规模 | 100K - 1M+ | 1M - 100M+ |
| 增量添加 | 支持 | 重建索引 |

**项目选择 HNSW 作为默认**因为：
1. 项目当前是 dev 阶段，数据量小（< 10K chunks）
2. HNSW 查询快 → Playground 体验好
3. 召回率高 → 演示 RAG 质量更稳定
4. 增量添加友好 → 文档持续入库

**何时换 IVFFlat**：
- 数据量到 1M+
- 写入频率高于查询
- 内存受限（IVFFlat 体积小约 5 倍）

**何时 `indexMode=none`**：
- 数据量 < 1000，全表扫描比建索引还快
- 调试期想看真实的余弦距离排名（无近似偏差）

**lists 参数**（IVFFlat 专属）：`max(1, round(sqrt(rowCount)))`，是 pgvector 官方推荐经验值。本项目实现了这个算法。

---

## Q8：从 1 个 stage 到 6 个 stage 抽完 ingestion 链。回顾这条链的开发节奏，有哪些验证过的经验？

**答：**

**ingestion 6 stage = 全部抽完**：idempotency / preprocess / chunk / transform / embedding / storage

**节奏经验**：
1. **简单类先做，复杂类后做**：idempotency（最简）→ transform（简）→ preprocess（中）→ chunk（中）→ embedding（I/O 注入）→ storage（最复杂）。每次只引入一个新概念，前面踩过的坑后面避开
2. **杠杆迁移**：抽 transform 时顺手把 nlp.ts 也搬走（5 个其他 stage 都用），一次操作惠及全部
3. **类型统一在第一次重复定义时立刻做**：chunk 一抽出来，transform 的 TransformInputChunk 立刻改为 type alias
4. **I/O 注入模式经 embedding 定型**：之后 storage、未来 retrieval/generation/rerank 都直接复制，不重新设计
5. **单测覆盖度递增**：12 → 10 → 11 → 14 → 15 → 19。每个 stage 测试都吸收前一个的经验（错误路径要测、mock 设计要简单）

**犯过的错**：
- chunk 测试假设输入太小，没触发分支（学到：测试要构造能跑到目标分支的最小输入）
- transpilePackages 缺失致机器假死（学到：每加 workspace 包必登记）

**下一段（retrieval 链）**：8 个 stage，是 RAG 检索的"召回 → 过滤 → 重排 → 引用"流程。其中 retrieval 自己需要 pg.Client 注入（沿用 storage 模式）+ OpenAI client 注入（沿用 embedding 模式），双重注入会是新挑战。
