# 面试题 — Transform Stage 抽取 + nlp.ts 工具迁移（feat-100.2 第 3 站）

相关文件：
- `packages/rag-core/src/ingestion/transform.ts` — runTransform + 3 method
- `packages/rag-core/src/util/nlp.ts` — jieba 分词 + 停用词 + extractKeywords（从 apps/web/lib/nlp.ts 迁来）
- `packages/rag-core/src/ingestion/__tests__/transform.test.ts` — 11 单测
- `apps/web/app/api/pipeline/transform/route.ts` — 薄路由（67 行，原 283 行）

---

## Q1：transform 在 RAG pipeline 里的位置是什么？为什么 chunk 后还要 transform？

**答：**

```
文档上传 → 幂等性 → 预处理 → chunk → [Transform] → embedding → 存储
```

chunk 输出的是**裸文本片段**，缺章节上下文。embedding 模型（尤其是短文本模型）对孤立片段的编码质量差：

```
chunk: "支持 PDF 上传"
query: "核心功能有哪些"
余弦相似度: ~0.3（低）
```

Transform 给每个 chunk 注入**坐标信息**：

```
enhancedText: "产品介绍 > 核心功能\n支持 PDF 上传"
query: "核心功能有哪些"
余弦相似度: ~0.7（显著提升）
```

heading-context method 就是干这个。本质是用文档结构补偿"短文本上下文缺失"问题。代价：增加 embedding 输入长度（更多 token = 更慢、更贵），适合精度优先场景。

---

## Q2：为什么把 nlp.ts 从 apps/web/lib 搬到 packages/rag-core/src/util？

**答：**

**杠杆迁移**：nlp.ts 被 6 个 stage 共用（citation / query-rewrite / retrieval / rerank / filter / transform）。如果跟着 transform 一起搬，那么后面 5 个 stage 抽取时都能直接用 `@harness/rag-core` 里的 nlp 函数，不需要再处理依赖。

**纯库归属**：jieba 分词、停用词过滤、关键词提取——这些是纯 NLP 工具，与 framework 无关，理应属于 rag-core 而不是 apps/web。把它留在 apps/web 反而违背了"rag-core 集中算法"的原则。

**单一来源**：未来 apps/api（NestJS）也会复用同一套，集中放 rag-core 后两个 apps 都通过 `@harness/rag-core` 间接使用，杜绝两份实现漂移。

操作上代价小：sed 一行批量改 6 个 route 的 import path，无行为改动。

---

## Q3：summary-keywords 注入格式 `\n\n关键词: kw1, kw2\n摘要: ...`，这种 hack 风格的 prompt 增强真的有用吗？

**答：**

实测有效但**不稳定**，本质是给 embedding 模型加 hint。

**有效的场景**：
- query "如何添加用户" → chunk 含 "添加用户" 关键词 → 余弦相似度提升
- 短 chunk（< 100 字）尤其受益，因为原文信号弱

**不稳定的原因**：
- embedding 模型不知道"关键词:" 这是元数据 vs 正文，可能误把"关键词"本身当成有意义的词
- 高质量 chunk 加这种 hack 反而稀释了原本就明确的语义

**改进方向**：
1. 用专门的 query-aware embedding model（如 bge-large 系列），它们对结构化提示更敏感
2. 用 sparse + dense 混合检索：BM25 对关键词敏感，embedding 对语义敏感，互补
3. 抛弃 hack 字符串，让 metadata 走结构化检索（Postgres 关键词字段 + GIN 索引），与 embedding 解耦

当前实现是最简方案，方便对比"启用 transform vs 禁用 transform"的检索质量差异，作为面试谈资足够。

---

## Q4：`transformHeadingContext` 里有段"sourceRef === documentTitle 时去重"的逻辑。这是为什么？

**答：**

避免重复信息污染 embedding。

```ts
// 已 markdown-structure 处理过的 chunk
// documentTitle = "产品白皮书"
// sourceRef = "产品白皮书 > 核心功能"

// 朴素拼接：
parts = ["产品白皮书", "产品白皮书 > 核心功能"]
prefix = "产品白皮书\n产品白皮书 > 核心功能"
// "产品白皮书" 重复出现，embedding 给它过高权重
```

去重后：

```ts
if (!params.includeTitle || c.sourceRef !== params.documentTitle) {
  parts.push(c.sourceRef);
}
```

这是个**经验细节**：markdown-structure 输出的 sourceRef 已经是 `top > section > subsection` 形式，包含了顶层标题。documentTitle 本身就是顶层，两者会撞车。

注意：这只处理"完全相等"，没处理"sourceRef 以 documentTitle 开头"。如果 documentTitle="产品"，sourceRef="产品介绍 > 核心功能"，目前还是会都注入。考虑到误判风险，宁可保守也不要 fuzzy 匹配。

---

## Q5：transform 测试 11 个但没覆盖 summary-keywords 在中文文本上的具体输出。为什么？测试覆盖率是否不够？

**答：**

**有意为之**：summary-keywords 的输出依赖 jieba 词典 + 停用词表 + TF 排序——三个变量任一更新，输出就变。测试不能锁死"产品 / 上传 / 多格式"这种具体词汇，否则升级 jieba 版本就全红。

实际测试只断言：

```ts
expect(r.output.chunks[0].keywords.length).toBeGreaterThan(0);
expect(r.output.chunks[0].summary.length).toBeGreaterThan(0);
expect(r.output.chunks[0].enhancedText).toContain("关键词:");
```

即"机制能跑通"+"结构正确"，不验证语义。

要测语义正确性需要：
- 准备 fixture（一段已知文本 + 一组预期关键词）
- 设容差（top-5 关键词至少命中 3 个预期）
- 升级 jieba 时手动 review fixture 是否需要调整

这类"语义质量"测试不属于单测范畴，属于 eval-matrix（feat-008 范围）。两层职责分清：单测查机制，eval-matrix 查质量。

---

## Q6：6 个 route 的 import 用 sed 批量改了 `@/lib/nlp` → `@harness/rag-core`。这种"机械批改"安全吗？

**答：**

这次安全，但要看条件：

**安全的前提**：
1. **零语义变化**：只换 import 路径，函数签名、参数、返回值完全不变
2. **来源唯一**：原 nlp.ts 文件已 git mv 过去，新位置导出的是同一份代码
3. **typecheck 兜底**：批改完立即跑 `pnpm -r typecheck`，TS 编译器会抓到任何类型不匹配

**风险情况（这次没遇到）**：
- 名称冲突：如果 `@harness/rag-core` 已 export 了同名但不同函数的 `tokenize`，sed 改完会编译过但运行时行为变
- 重定向歧义：sed 模式太宽（漏写引号）可能误改注释或字符串字面量里的 path

我用的 sed 模式 `'s|from "@/lib/nlp"|from "@harness/rag-core"|g'` 精确匹配 import 语法，没扩散风险。改完 typecheck + lint + 测试全跑过才算稳。

对比手动一个个改：sed 6 秒搞定 vs 6 次手工编辑 + 容易漏。机械批改 + 自动验证是 monorepo 重构的标准操作。

---

## Q7：转换后 transform/route.ts 67 行（原 283 行）。但 chunk 上游 schema 还是用 `UpstreamChunkOutput` 接口直接写在 route 里，没放到 shared-types。这样设计的考虑？

**答：**

**避免过早抽象**。

`UpstreamChunkOutput` 是 chunk stage 的输出形状。理论上 chunk 抽取时（feat-100.2 第 4 站）会在 `shared-types/pipeline/chunk.ts` 定义 `ChunkOutput`。届时 transform/route.ts 可以 import 它，删掉本地的临时接口。

现在不抽：
- chunk 还没抽取，shared-types 里没有正式定义
- 临时写在 route 是过渡状态，typecheck 能保证形状一致
- 提前定义会和未来 chunk extraction 时的 schema 撞车（也许那时发现 trace 还要加字段）

**渐进重构原则**：每个 stage 抽取时**只关心自己的输入输出**，对上游用 `interface`/`type` 临时声明。等上游也抽取时，import 它的正式 type 替换临时声明。这样每步改动小、可独立验证、可回滚。

如果一上来就 18 个 stage 的 schema 都先在 shared-types 写完，会陷入 schema 设计 vs 算法实现的纠缠，且未抽取的 stage schema 不可信（还没经过纯函数化的考验）。
