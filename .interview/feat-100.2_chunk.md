# 面试题 — Chunk Stage 抽取（feat-100.2 第 4 站，RAG 最核心 stage）

相关文件：
- `packages/rag-core/src/ingestion/chunk.ts` — runChunk + 4 method 实现
- `packages/rag-core/src/ingestion/__tests__/chunk.test.ts` — 14 单测
- `packages/shared-types/src/pipeline/chunk.ts` — Chunk canonical type + schema
- `apps/web/app/api/pipeline/chunk/route.ts` — 薄路由（69 行，原 535 行）

---

## Q1：RAG 中分块（chunking）为什么是质量瓶颈？粒度太大太小各有什么问题？

**答：**

分块直接决定 embedding 能编码的语义粒度。

**太大**（chunk > 1024 token）：
- embedding 是固定维度向量（如 1536d），一个 chunk 含多个话题时，每个话题被平均化稀释
- 检索 query "如何重置密码" 命中含密码 + 注册 + 登录的大 chunk，相似度低
- token 成本和延迟也线性上升

**太小**（chunk < 50 token）：
- 缺上下文，"支持 PDF 上传" 这种孤立片段失去章节信息
- 检索数量爆炸，存储/检索效率劣化
- 召回 top-K 时容易把零散片段堆在一起，反而影响 reranker / LLM 理解

**经验值**：512 token 是 OpenAI 时代主流默认；现在 dense vector 模型（bge-large、e5）能吃 512-1024 token，可适当放大。最优值需要 eval 矩阵（feat-008）针对自己语料和 query 实测。

---

## Q2：4 种 method 各自的取舍是什么？项目里默认推荐哪个？

**答：**

| Method | 优势 | 劣势 | 适合 |
|--------|-----|------|------|
| **fixed-size** | 最快、可预测 | 在句中、词中硬切，语义碎裂 | 结构均匀的纯文本（日志、报告） |
| **recursive** | 优先在段落 / 句子边界切分 | 实现稍复杂；中文需自定义分隔符 | **通用默认**，对大多数文档都不错 |
| **markdown-heading** | 章节边界完美对齐 | 长章节用 fixed-size 降级（硬截断） | 文档结构清晰且章节短 |
| **markdown-heading-recursive** | 章节边界 + 长章节也保语义 | 计算稍多 | **MD/Wiki 文档最佳**（业界 hierarchical chunking 标配） |

本项目默认 `recursive`，因为对内容格式假设最少。markdown 文档强烈推荐 `markdown-heading-recursive`。

---

## Q3：recursive 算法的核心思想是什么？为什么中文版需要在 separators 里加 "。！？；"？

**答：**

**算法**：给定优先级递减的分隔符列表，先用最高级切分；超长片段用下一级递归继续切，最终兜底为字符级硬切。

**默认 separators**（中文优先版）：

```ts
["\n\n", "\n", "。", "！", "？", "；", " ", ""]
//   ↑     ↑    ↑                ↑    ↑
//   段落  换行 中文句终         空格  字符
```

**为什么加中文标点**：

LangChain 原版默认 `["\n\n", "\n", " ", ""]`。问题：

- 英文有大量空格（every word），" " 是有效切分点
- 中文一段话可能上千字符不带任何空格——`["\n\n", "\n", " ", ""]` 退化为"段落 → 换行 → 字符"，长段落直接被字符级硬切，语义碎裂

加入 "。！？；" 后，长中文段落可以在句子边界切分，比硬切语义保留好得多。

**生产经验**：还可以加 "."（英文句号）、","（逗号）作更细粒度兜底。但要注意：用 "." 切要小心 "U.S.A." 这种缩写。可以用 sentence splitter 库（如 `compromise`）替代正则。

---

## Q4：markdown-heading 和 markdown-heading-recursive 的区别？什么时候必须用后者？

**答：**

```
markdown-heading           长章节 → fixed-size 降级（字符边界硬切）
markdown-heading-recursive 长章节 → recursive 降级（段落/句子边界）
```

**实测对比**：一个 2000 字的产品说明章节（chunkSize=512）：

- markdown-heading: 4 个 chunk，第 1/2 个在词中间断开（"用户可以在这")
- markdown-heading-recursive: 4 个 chunk，每个都在段落或句末（"用户可以在这个页面中编辑笔记。")

下游 reranker（尤其是 cross-encoder）对**完整句子**的得分明显高于碎句。所以**有 reranker 的 pipeline 强烈推荐用 hierarchical**（业界 LangChain MarkdownHeader+Recursive、LlamaIndex HierarchicalNodeParser 都是这思路）。

代价：实现复杂（要嵌套调用 recursive）、计算稍多。但单次预处理一次性收益，性价比高。

---

## Q5：`Chunk` 类型被 chunk / transform 两个 stage 共享。统一定义的好处和风险？

**答：**

**好处**：

```ts
// shared-types/pipeline/chunk.ts
export interface Chunk { index, text, charStart, charEnd, tokenEstimate, sourceRef }

// shared-types/pipeline/transform.ts
export type TransformInputChunk = Chunk;  // 重用，不重定义
```

1. **单一来源**：chunk 加字段（如 `pageNumber`）transform 自动跟随
2. **类型检查跨 stage 生效**：chunk 输出 Chunk[]，transform 输入 Chunk[]，TS 编译器保证形状一致
3. **schema 漂移防御**：避免"chunk 的 Chunk 和 transform 的 TransformInputChunk 名字不同但应该相同"导致两边发散

**风险**：

- **耦合**：chunk 一旦改 Chunk schema（删字段、改字段类型），所有依赖 Chunk 的 stage 都跟着改。这其实是好事——逼着 schema 变更经过显式 review。
- **过度统一**：如果 transform 内部需要扩展字段（比如要求 chunk 必须有 `summary` 字段），不能直接修改 Chunk，而要用 `Chunk & { summary: string }` 或继承。这次设计里 TransformedChunk 用 `extends Chunk { enhancedText, keywords, ... }` 解决。

权衡：在 monorepo + workspace 类型共享场景，**统一定义 > 各 stage 独立**。出问题更早，演化方向明确。

---

## Q6：测试里"段落优先"那条用了 3 段 80 字符的文本，为什么不用 3 段 5 字符的短段落？

**答：**

陷阱：算法第一层 check 是 `if (sub.length <= chunkSize) return as-is`。

短段落实验：
```
text = "段落1。\n\n段落2。\n\n段落3。"  // 总 18 字符
chunkSize = 50
```
直接命中 `sub.length <= chunkSize`，返回单个 chunk，根本没机会进入分隔符递归。测试就废了。

长段落实验：
```
text = "段落1" + "x"*75 + "\n\n段落2" + "x"*75 + "\n\n段落3" + "x"*75
chunkSize = 100
```
总长 ~250，必须切分。验证算法**优先在 \n\n 边界切**（而非纯按 100 字符硬切）。

**通用教训**：测试纯函数时，输入必须**真正触发被测代码路径**。不要无脑用小数据，要构造能跑到目标分支的最小输入。本次 3 个失败测试都是这个问题。

---

## Q7：原 route.ts 535 行 → 69 行薄路由（减 87%），但 rag-core/chunk.ts 也是 350 行。算法代码总量没真减，重构有意义吗？

**答：**

是的，因为价值不在"行数总量"而在"职责分离"。

**重构前**：535 行混在一起：解析 HTTP → 校验 → 算法 → 错误处理 → trace 包装。改算法要小心别破坏 HTTP 层；改 HTTP 错误码要小心别影响算法。**单文件耦合**。

**重构后**：
- `rag-core/chunk.ts` 350 行：纯算法。改 chunk 算法时只动这里，看不到 NextResponse、process.env、HTTP status。**单测可独立跑**。
- `apps/web/route.ts` 69 行：薄路由。所有 HTTP 关心点都在这里。Next.js 升级、迁 NestJS 只改这层。
- `shared-types/pipeline/chunk.ts` 80 行：类型契约。前端、后端、CLI 都依赖这份。

**真正的减法**是认知减法：
- 看 chunk 算法时不被 HTTP 干扰
- 看路由时不被算法细节淹没
- 加新调用方（NestJS / CLI）时不重写算法，import 即可

代码总量没变（甚至略增因为加 schema 文件），但**可维护性、可测试性、可复用性**三者翻倍。这是 Wave 2 的核心收益。

---

## Q8：chunk stage 14 个单测覆盖了什么没覆盖什么？怎么扩展？

**答：**

**已覆盖**：
- 4 method 各自的主路径
- 边界：overlap 超 chunkSize、超长章节降级、空 separators fallback
- sourceRef 绑定
- 错误路径：empty_text 抛 PipelineError

**没覆盖（可扩展）**：
1. **大文本性能**：10MB 文档分块的耗时（应有 perf 测试，本项目暂不需要）
2. **极端 Unicode**：emoji、组合字符、罕见汉字。当前 `[一-鿿]` 范围足够日常但不全面
3. **超大 chunkSize 极限值**：万级 chunkSize 会不会数值溢出（不会，JS number 范围远远够）
4. **token 估算准确度**：单测验证了 estimateTokens 返回正数，但没验证它 vs tiktoken 的偏差（属于 eval 矩阵范畴）

**测试金字塔分层**：
- 单测（vitest）：纯函数逻辑正确性 ← 本次 14 个
- 集成测试（dev server + curl）：HTTP 端到端 ← 上一会话 idempotency / preprocess 实测
- 性能测试：耗时分布、内存峰值 ← 待 eval-matrix 工具完善
- 质量测试：召回率、faithfulness ← feat-008 eval matrix runner 的职责

不是越多测试越好，是每一层各司其职。
