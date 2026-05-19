# 面试题 — Chunk Stage（feat-003.3）

相关文件：
- `app/app/api/pipeline/chunk/route.ts`
- `app/lib/stageRegistry.ts`（chunk 方法 schema）
- `app/components/playground/PlaygroundShell.tsx`（upstreamOutput 透传）

---

## Q1：RAG 系统为什么需要分块？chunk 粒度对检索质量有什么影响？

**答：**

向量模型有输入 token 上限（通常 512），超出部分会被截断或导致语义失真，所以必须分块。

粒度的影响是双向的：

**太大（如整章节 2000+ 字符）：**
- 一个 chunk 覆盖多个话题，embedding 是多个语义的混合向量，与 query 的余弦相似度被稀释
- 检索 "产品定价" 时，一个涵盖"功能+定价+案例"的大 chunk 排名会低于纯粹讲定价的小 chunk

**太小（如单句 < 50 字符）：**
- 上下文不足，embedding 无法捕获完整语义（"支持 PDF"三个字无法编码"这是产品核心功能"）
- 存储量和检索延迟线性增加
- 原本连贯的一段话被拆散，LLM 拿到碎片化 context 容易产生错误回答

实践中常见策略是 **512 字符 / 128 token overlap**，或按语义单元（段落、章节）切分。

---

## Q2：你实现了三种 chunk 方法，各自的原理和适用场景是什么？

**答：**

**`fixed-size`（固定大小滑动窗口）：**
- 从 pos=0 开始，每次取 [pos, pos+chunkSize)，步长为 chunkSize - overlap
- 最简单，速度最快，不依赖文档结构
- 适合结构均匀的纯文本（日志、报告正文），不适合有明确章节的文档（会在句中截断）

**`recursive`（递归语义切分）：**
- 给定分隔符优先级列表（默认 `["\n\n", "\n", " ", ""]`），先用最高优先级分隔符切分
- 如果某段仍然 > chunkSize，用下一级分隔符递归切分，最后兜底按字符切
- 核心价值：尽量在语义边界（段落 > 句子 > 词）处断开，避免在词中间截断
- 对标 LangChain `RecursiveCharacterTextSplitter`，是最常用的通用方法

**`markdown-heading`（标题边界切分）：**
- 扫描 cleanText，遇到 `#/##/###` 等标题时开始新 chunk，每个章节独立成一个 chunk
- 章节超过 maxChunkSize 时降级为 fixed-size 切分
- 适合有明确结构的产品文档、Wiki、README，每个 chunk 代表一个完整章节语义

---

## Q3：overlap（重叠）的作用是什么？如果设为 0 会有什么问题？

**答：**

overlap 是相邻 chunk 之间共享的字符数，目的是防止"跨 chunk 边界的上下文断裂"。

**没有 overlap 的问题举例：**
假设文本在第 512 个字符处切分：
```
chunk 0: "...本产品支持三种定价方案：基础版、专业版"
chunk 1: "和企业版。基础版每月 ¥99，包含..."
```
用户 query "基础版多少钱"，chunk 1 里有答案但缺少"基础版是三种方案之一"的上下文；chunk 0 有上下文但没有价格。两个 chunk 单独都不完整。

**有 overlap（如 64 字符）：**
chunk 1 的起点向前 64 字符，把"基础版"这个关键词包含进来，两个 chunk 都有完整语义。

代价是存储量略增（约 overlap/chunkSize 的比例），通常可接受。

---

## Q4：你的系统里 chunk 的 `sourceRef` 字段是如何从预处理结果继承过来的？

**答：**

预处理（preprocess）阶段生成 `sourceRefs` 数组，每个元素记录文本片段在 cleanText 中的字符范围和对应的 heading path：
```typescript
{ type: "paragraph", value: "产品介绍 > 核心功能", charStart: 60, charEnd: 120 }
```

分块时，`findSourceRef(charStart, sourceRefs)` 函数遍历 sourceRefs，找到覆盖当前 chunk 起始位置的最近 ref：
```typescript
for (const ref of sourceRefs) {
  if (ref.charStart <= charStart) best = ref.value;
  else break;
}
```

这样每个 chunk 天然带有"我来自哪个章节"的信息，不需要在分块阶段重新解析文档结构。citation 阶段可以直接用这个字段展示"来自产品介绍 > 核心功能"的引用来源。

---

## Q5：PlaygroundShell 里如何把上游 output 传给下游 API？这个设计有什么好处？

**答：**

`handleRun` 函数在发起 API 请求前，通过 `STAGE_DEPS` 查找当前 stage 的直接上游 stageId，再取其最新运行结果的 `output`，作为 `upstreamOutput` 一起 POST 给 API：

```typescript
const upstreamStageId = STAGE_DEPS[stageId];
const upstreamOutput = upstreamStageId ? latestRun(upstreamStageId)?.output ?? null : null;

fetch(`/api/pipeline/${stageId}`, {
  body: JSON.stringify({ methodId, params, pipelineRun, upstreamOutput }),
});
```

**好处：**

1. **无需数据库**：pipeline 上下文完全在前端内存中维护，API 是无状态的，不需要为每次运行存储中间产物
2. **可调试**：用户可以看到每个 stage 的 output，发现问题直接改参数重跑上游
3. **通用性**：所有下游 stage（chunk/transform/embedding/storage）都复用同一套逻辑，不需要各自处理上游产物获取
4. **显式依赖**：API 收到 `upstreamOutput: null` 时返回明确的 `missing_upstream` 错误，而不是在服务端查询时失败并产生难以调试的错误信息
