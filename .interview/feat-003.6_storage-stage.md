# 面试题 — Storage Stage（feat-003.6）

相关文件：
- `app/app/api/pipeline/storage/route.ts`
- `app/lib/stageRegistry.ts`（storage 方法 schema）

---

## Q1：pgvector 是什么？为什么选择 PostgreSQL + pgvector 而不是专用向量数据库（Pinecone、Weaviate）？

**答：**

pgvector 是 PostgreSQL 的扩展（`CREATE EXTENSION vector`），在标准关系型数据库里增加了向量列类型、余弦/L2/内积距离函数和 HNSW/IVFFlat 两种 ANN 索引。

**选择 PostgreSQL + pgvector 的理由：**

| 维度 | pgvector | 专用向量库（Pinecone等） |
|---|---|---|
| 部署复杂度 | 已有 PG 实例直接加扩展 | 需要额外服务 |
| 事务支持 | 完整 ACID | 通常无 |
| 元数据过滤 | 完整 SQL WHERE | 有限或额外收费 |
| 混合查询 | 向量 + 全文 + 关系一个查询 | 需要多系统 join |
| 成本 | 低（共用 PG 实例） | 按向量数量计费 |
| 向量规模上限 | 亿级（需调优） | 更高，开箱即用 |

**结论：** 对中小规模 RAG（< 1000 万向量）且已有 PostgreSQL 的场景，pgvector 是最经济的选择。超大规模或需要多租户隔离时才考虑专用向量库。

---

## Q2：Dimension Guard 的作用是什么？为什么不把不同维度的向量存入同一张表？

**答：**

Dimension Guard 在写入前检查表内已有向量的维度，若与本次写入维度不符，直接拒绝并返回 409 错误。

**为什么不能混入：**

1. **ANN 索引假设固定维度**：HNSW/IVFFlat 索引建立时绑定了向量维度，插入不同维度的向量会导致索引损坏或报错
2. **余弦相似度计算无意义**：4 维向量和 1536 维向量做点积在数学上没有意义
3. **排名结果失真**：4 维 debug 向量如果混入 1536 维 OpenAI 向量，检索结果完全不可预期

**实现方式：**
```sql
SELECT embedding_dimension FROM rag_chunks
WHERE embedding_dimension IS NOT NULL LIMIT 1
```
若查询为空（fresh table），允许任意维度写入；若有结果，校验匹配后才写入。

---

## Q3：三种写入策略（upsert/new-version/replace-version）分别适合什么场景？

**答：**

**pgvector-upsert-version（默认调试场景）：**
- 同一 `(documentId, version, chunkIndex)` 三元组已存在时，根据 `conflictPolicy` 决定覆盖还是报错
- 适合：开发阶段反复跑同一份文档，不想看到 UNIQUE VIOLATION，每次覆盖最新向量

**pgvector-new-version（文档更新场景）：**
- 查当前最大 version，version+1 后全量插入
- 历史版本保留，检索时可用 `WHERE version = $latest` 只检索最新版本，也可指定旧版本做对比
- 适合：文档有修订记录需求，需要回溯历史版本的 RAG 结果

**pgvector-replace-version（存储空间优先场景）：**
- 先 `DELETE WHERE document_id = $1`，再 INSERT version=1 的新版本
- 存储最省，无历史版本
- 适合：文档量大、只关心最新版本、不需要回溯

---

## Q4：HNSW 和 IVFFlat 两种索引的区别是什么？建索引时有哪些注意事项？

**答：**

**HNSW（Hierarchical Navigable Small World）：**
- 图结构，每个向量节点连接最近的 m 个邻居（默认 m=16）
- 查询时从图的入口节点开始贪心搜索
- 优点：查询快（几毫秒），增量插入友好（不需要 vacuum 优化）
- 缺点：建索引时内存占用高（O(n×m×dimension)），索引体积比 IVFFlat 大

**IVFFlat（Inverted File + Flat）：**
- 对所有向量 k-means 聚类成 `lists` 个桶，查询时只扫描最近的若干桶
- `lists` 经验值：`sqrt(rowCount)`（例：1万行用 100 个桶）
- 优点：内存占用低，磁盘体积小
- 缺点：建索引前需要有足够数据（少于 `lists` 行时报错），不支持高效增量插入

**建索引注意事项：**
1. 建索引需要已有数据，通常在第一批数据 INSERT 完成后再 CREATE INDEX
2. 维度信息通过 operator class 绑定（`vector_cosine_ops` / `vector_l2_ops`），建索引后不能更换距离函数
3. 数据量 < 1000 行时 `indexMode=none` + 全量扫描反而更快（索引开销 > 收益）

---

## Q5：如果 INSERT 时遭遇 UNIQUE VIOLATION，错误信息如何从数据库传递到前端？

**答：**

pg 客户端抛出 `DatabaseError`，其 `.code` 属性是 PostgreSQL 错误码字符串（SQL State），UNIQUE VIOLATION 对应 `"23505"`。

本项目的处理链路：
```
PostgreSQL UNIQUE VIOLATION
  → pg 抛出 DatabaseError { code: "23505", message: "duplicate key value..." }
  → catch 块检查 pgErr.code === "23505"
  → 返回 { error: { code: "unique_violation", message: "..." } }
  → 前端 OutputTracePanel 展示 error.code + error.message
```

**为什么映射为业务错误码而不是直接返回 SQL 错误：**
1. SQL 错误信息含数据库内部细节（表名、约束名），前端不需要知道
2. 业务错误码可读性好（`unique_violation` vs `ERROR: duplicate key value violates unique constraint "rag_chunks_document_id_version_chunk_index_key"`）
3. 前端可以根据错误码做分支处理（如：unique_violation → 提示用户切换为 upsert 策略）

**补充：Node 18+ 的 AggregateError：**
pg 连接失败时（ECONNREFUSED）在 Node 18+ 会抛出 `AggregateError`，需要先 unwrap 取 `errors[0]` 再读 `.message`，否则 message 为空字符串。
