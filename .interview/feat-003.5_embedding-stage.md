# 面试题 — Embedding Stage（feat-003.5）

相关文件：
- `app/app/api/pipeline/embedding/route.ts`
- `app/lib/stageRegistry.ts`（embedding 方法 schema）

---

## Q1：为什么 RAG 要把文本转成向量？余弦相似度检索的原理是什么？

**答：**

向量检索解决的核心问题是**语义匹配**：关键词匹配只能找到字面相同的词，而向量检索能找到语义相近的表达。

**原理：**
1. Embedding 模型（如 BERT/Sentence-BERT）将文本编码为高维浮点向量，语义相近的文本在向量空间中距离更近
2. 检索时，把 query 也编码成向量，在向量库中查找余弦相似度最高的 k 个向量（cosine similarity = dot product / (‖a‖ × ‖b‖)）
3. 对于归一化向量（L2 norm = 1），余弦相似度等价于点积，可以用 FAISS/pgvector 的 HNSW/IVFFlat 索引加速

**为什么余弦而非欧式距离：**
向量模型的输出方向（角度）代表语义，模长受 token 长度影响。余弦只看角度，更稳定。

---

## Q2：你实现了四种 embedding provider，各自的适用场景和权衡是什么？

**答：**

| Provider | 依赖 | 适用场景 | 主要限制 |
|---|---|---|---|
| `debug-deterministic` | 无 | 流程验证、单测、CI | 无语义，仅确定性 |
| `openai-3-small` | OPENAI_API_KEY | 生产环境，质量最好 | 有 API 费用，联网 |
| `hf-tei-embedding` | TEI 服务 + HF_TEI_ENDPOINT | 私有化部署，可用开源模型 | 需要自托管服务 |
| `hf-transformers-js` | @huggingface/transformers | 本地开发，无需任何 Key | 首次下载模型慢（20-80MB） |

**设计要点：**
- `openai` 和 `transformers` 都用动态 `import()`，避免未使用时加载大型 SDK 影响启动速度
- 所有 provider 统一输出相同的 `EmbeddedChunk` schema，Storage Stage 不感知 provider 差异

---

## Q3：`debug-deterministic` 是如何做到"同一文本始终产出相同向量"的？

**答：**

使用 **FNV-1a 32-bit 哈希** 将文本映射到向量：

```typescript
for (let i = 0; i < dimension; i++) {
  let h = 2166136261 ^ (i * 16777619); // i 作为 seed 偏移，使每个分量不同
  for (let j = 0; j < text.length; j++) {
    h ^= text.charCodeAt(j);
    h = Math.imul(h, 16777619);
  }
  raw.push(((h >>> 0) / 0xffffffff) * 2 - 1); // 映射到 [-1, 1]
}
// 最后归一化为单位向量（L2 norm = 1）
```

**为什么要归一化：**
生产环境的 embedding 模型都输出 L2 归一化的向量，pgvector 的余弦相似度检索假设向量已归一化（等价于内积）。debug 向量也归一化，可以直接接 Storage Stage 测试 dimension guard 等逻辑，而不会因向量范围不同引入额外 bug。

---

## Q4：批处理（batchSize）在 embedding 中的作用是什么？如果 batchSize=1 会怎样？

**答：**

**作用：**
- 减少网络往返次数：100 个 chunk 若 batchSize=100，只发一次 HTTP 请求
- API 侧通常有更高的并发吞吐：批量请求内部向量化可以并行化，比 100 次单独请求快得多
- 节省连接建立开销（TLS handshake、TCP slow start）

**batchSize=1 的问题（以 100 chunks 为例）：**
- OpenAI API：100 次 HTTP 请求，假设每次 150ms，串行则 ~15 秒；batchSize=100 则 ~200ms
- HF TEI：每次请求的序列化/反序列化开销 × 100
- 网络错误率也会上升（100 次请求任一失败都需要重试）

**实现注意：**
OpenAI `text-embedding-3-*` 单次请求上限是 2048 个输入，超出会报错，所以需要 batchSize 参数控制。

---

## Q5：为什么要嵌入 `enhancedText` 而不是原始 `text`？检索返回时应该用哪个字段？

**答：**

**embedding 用 `enhancedText`：**
Transform 阶段注入了文档标题和章节路径（如 `"产品白皮书\n产品介绍 > 核心功能\n\n原文"`），
embedding 模型对这段增强文本编码，产出的向量同时捕获了"章节语义"和"正文语义"。
当 query 是"产品核心功能有哪些"时，与"核心功能"相关的向量得分更高，召回率提升。

**检索返回给用户用 `text`：**
原始 `text` 不含注入的前缀，内容干净。用户看到的引用片段是可读的原文，
LLM 生成时也不会因为重复的标题前缀产生上下文噪音（如 "产品介绍 > 核心功能\n产品介绍 > 核心功能\n..."）。

**字段分工总结：**
```
enhancedText → 向量化（embedding 输入）
text         → 展示（用户阅读 + LLM context）
embedding    → 相似度计算（检索输入）
sourceRef    → 引用来源展示（"来自 产品介绍 > 核心功能"）
```
