# feat-009：RAG Pipeline 库标准化（第一批）

**日期**：2026-05-23  
**类型**：Bug Fix + 工程化改进  
**影响范围**：`app/app/api/pipeline/rerank/route.ts`、`scripts/eval-matrix/test-matrix.json`、`AGENTS.md`

---

## 背景

Run-008 实验结果发现 `pipeline-rerank`（T03）与纯 `hf-tei-rerank`（T02）hitRate 完全相同（0.72 = 0.72），与直觉不符——pipeline-rerank 多了一个 Metadata Boost 步骤，理论上应能通过关键词匹配提升相关 chunk 的优先级。

经诊断发现两个独立问题：

1. **tokenizer bug（根本原因）**：Metadata Boost 的关键词提取使用空格/标点切分，中文没有空格，导致整句 query 变成 1 个 token，boost 值恒为 0，pipeline-rerank 退化为纯 bge 重排。
2. **llm-relevance-rerank 静默失败**：T04 的 catch 块引用了外层作用域不存在的 `warnings` 变量（TypeScript 编译报错），同时 T04 的 `model`/`baseUrl` 参数未配置，LLM 调用失败后静默降级为原始余弦分，导致 T04 数据与 T01 完全相同（无效数据）。

同一次全局代码审计（2026-05-23）还发现 9 处类似的手写实现问题，本次修复其中最关键的 2 处，其余作为待办项记录。

---

## 变更 1：Metadata Boost 分词改用 `@node-rs/jieba`

**文件**：`app/app/api/pipeline/rerank/route.ts`

### 修改前（手写空格切分）

```typescript
// rerankMetadataBoost 和 rerankCombined 中各有一份相同的手写分词
const qTokens = new Set(
  query.toLowerCase()
    .split(/[\s，。？！、；：\?!,.:;()\n]+/)
    .filter((t) => t.length >= 2)
);
```

**实际效果（Q4："产品的整体设计风格和主题色方案是什么？"）**：
```
切分结果: ["产品的整体设计风格和主题色方案是什么"]  ← 30 字变 1 个 token
对所有 sourceRef 的命中数: 0
boost 值: 0（全部 chunk 一律）
pipeline-rerank 效果 = 纯 bge 重排
```

### 修改后（`@node-rs/jieba`）

```typescript
// 模块级单例（词典只加载一次）
import { Jieba } from "@node-rs/jieba";
const jieba = new Jieba();

const STOP_WORDS = new Set([
  "的","了","和","是","在","有","与","或","等","如","用","可","为","都","也",
  "其","但","到","又","还","以","就","被","让","把","从","对","向","这","那",
  "个","一","不","什么","哪些","如何","怎么","哪个","是否",
]);

function extractQueryTokens(query: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of jieba.cut(query, true)) {  // HMM=true：未登录词识别
    const w = word.trim();
    if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.add(w.toLowerCase());
  }
  return tokens;
}
```

**实际效果（同一 Q4）**：
```
切分结果: ["产品", "整体", "设计", "风格", "主题", "色方案"]  ← 6 个有效 token
sourceRef 命中：
  "设计风格与视觉识别 > 色彩方案" → hits=2 (设计/风格), boost=0.286  ✓
  "导航与信息架构"                → hits=0,             boost=0.000
Boost 后排序：色彩方案(0.603) > 字体与布局(0.565) > 导航与信息架构(0.502)
```

**为什么选 `@node-rs/jieba`：**
- Rust binding，预编译二进制，无需 node-gyp，支持 darwin-arm64 / linux-x64（Docker 兼容）
- 项目已安装（为 rerank/route.ts 引入），此次扩展到 Metadata Boost
- HMM 模式支持未登录词（产品自定义词汇）

**已知架构局限性（不在本次修复范围）**：
修复 tokenizer 后，boost 能正确区分相关/不相关 chunk。但当 `boostPassN ≥ 实际候选数`（当前默认 20，实际候选 10）时，所有 chunk 仍被送入 bge，bge 独立打分不受输入顺序影响，boost 的预排序效果依然为零。需要将 `boostPassN` 设为小于候选数的值，才能让 boost 的筛选效果生效。这是一个参数配置问题，将在 Run-009 实验中验证。

---

## 变更 2：`llm-relevance-rerank` 静默失败修复

**文件**：`app/app/api/pipeline/rerank/route.ts`

### 修改前（`warnings` 不在作用域）

```typescript
// rerankLLMRelevance 是独立函数，没有外层 warnings 数组
} catch (err) {
  warnings.push(`...`);  // ← TypeScript error: Cannot find name 'warnings'
  return { ...m, rerankScore: m.score, ... };  // 静默降级为余弦分
}
```

**问题**：
1. TypeScript 编译报错（`Cannot find name 'warnings'`）
2. 即使运行时，catch 块静默返回 `m.score`（原始余弦分），外部无法区分"LLM 打分成功"和"LLM 调用失败降级"
3. 导致 T04 数据与 T01 分数完全相同，被误判为有效数据

### 修改后（局部 `llmFailures` 数组）

```typescript
const llmFailures: string[] = [];  // 函数内局部收集

const scored = await Promise.all(
  matches.map(async (m, idx) => {
    try {
      // ... LLM 调用 ...
    } catch (err) {
      const msg = `llm-relevance-rerank chunk[${idx}] 失败，已降级为原始分数: ${
        err instanceof Error ? err.message.slice(0, 80) : String(err)
      }`;
      llmFailures.push(msg);  // 记录到局部数组
      return { ...m, rerankScore: m.score, originalRank: idx + 1 };
    }
  })
);

return {
  // ...
  warnings: [`llm-relevance-rerank 消耗 ${matches.length} 次 API 调用`, ...llmFailures],
  //                                                                        ↑ 失败信息合并到返回值
};
```

**效果**：LLM 调用失败时，调用方可在 `output.warnings[]` 中看到具体错误，不再静默。

---

## 变更 3：test-matrix.json T04 参数补全

**文件**：`scripts/eval-matrix/test-matrix.json`

### 修改前（缺少 model / baseUrl）

```json
"rerank": {
  "methodId": "llm-relevance-rerank",
  "params": { "rerankTopN": 5 }
}
```

默认走 `gpt-4o-mini` + OpenAI endpoint → 国内网络访问失败 → 静默降级为余弦分 → T04 ≡ T01（无效数据）。

### 修改后

```json
"rerank": {
  "methodId": "llm-relevance-rerank",
  "params": {
    "rerankTopN": 5,
    "model": "qwen-plus",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1"
  }
}
```

---

## 变更 4：AGENTS.md 新增交付前代码审查 Checklist

新增"交付前代码审查（Code Review Checklist）"章节，要求：
1. 库优先原则：9 类操作禁止手写，必须使用指定库
2. TypeScript 编译通过（`npx tsc --noEmit`）
3. 无静默失败（catch 块必须有可观测输出）
4. 停用词和分词逻辑全局统一，不允许多处维护不同列表
5. `params` 参数类型安全检查

---

## 全局代码审计结果（2026-05-23）

本次审计发现 9 处手写实现问题，按优先级记录如下：

| 优先级 | # | 位置 | 问题 | 推荐库 | 状态 |
|--------|---|------|------|--------|------|
| P0 | 2 | `retrieval/route.ts` L278–432 | 手写中文 bigram BM25，IDF 只算候选集 200 条，`ILIKE ANY` 不走索引 | `@node-rs/jieba` + `wink-bm25-text-search` | 待修 |
| P0 | 3 | `transform/`、`query-rewrite/`、`rerank/` | 三份独立停用词表，内容已发散 | `stopword` (`zho`) + 统一到 `app/lib/stopwords.ts` | 待修 |
| P1 | 9 | 所有 pipeline routes | 无 `zod` 入参校验，`Number("abc")=NaN` 静默传播 | `zod` | 待修 |
| P1 | 1 | `chunk/`、`transform/`、`prompt-build/` | `chars/4` 估算 token 数，中文误差 30%+ | `js-tiktoken` | 待修 |
| P2 | 6 | `filter/route.ts` L128–248 | Jaccard 相似度用于 MMR，中文无词边界；`filterCombined` 缺 `maxPerDocument` 检查 | pgvector 余弦 + 修复逻辑重复 | 待修 |
| P3 | 4 | `transform/route.ts` L176–192 | TF-only 关键词提取，无中文分词，无 IDF | `@node-rs/jieba` + `natural` TF-IDF | 待修 |
| P3 | 7 | `preprocess/route.ts` L59–128 | 多层 regex Markdown 清洗，多行代码块等边缘情况缺失 | `remark` + `strip-markdown` | 待修 |
| P4 | 5 | `transform/route.ts` L201–213 | 正则句子切分，误切小数点/缩写 | `sbd` | 待修 |
| P4 | 8 | `preprocess/route.ts` L182 | `/<[a-z]/i` 检测 HTML，TypeScript 泛型误判 | `is-html` | 待修 |

---

## 对已有测试结果的影响评估

详见下方独立章节。

---

## 面试考点

**Q1：为什么中文文本不能用空格切分来提取关键词？**

中文书写系统没有词间空格，词边界由上下文语法决定。例如"进出口商品"可切分为"进出口/商品"或"进/出口/商品"，含义完全不同。空格切分的结果是整句变成单个 token，关键词匹配率降为零。工业实践中用结巴（jieba）等基于前缀词典+HMM 的模型进行分词，能识别 99% 以上的通用词和大部分领域词汇。

**Q2：`@node-rs/jieba` 相比 `nodejieba` 有什么优势？**

`nodejieba` 是 C++ binding，需要 `node-gyp` 在目标机器上编译，在 ARM64（Apple Silicon）和 musl libc（Alpine Docker）上经常失败。`@node-rs/jieba` 是 Rust binding，通过 NAPI-RS 发布预编译二进制，支持 darwin-x64、darwin-arm64、linux-x64-gnu、linux-arm64-gnu 等平台，无需编译，`npm install` 直接可用。

**Q3：catch 块静默降级（silent fallback）是 RAG 系统中常见的什么类型问题？**

这是"假成功"（silent degradation）模式，是分布式系统和 AI pipeline 中最危险的故障类型之一。系统返回了结果，但结果是降级的（这里是余弦分代替 LLM 分），调用方无法区分正常路径和降级路径。后果是：测试数据看起来有效，但实际上 T04 的所有结果都等同于 T01，浪费了实验成本，还得出了错误结论。正确做法：降级允许，但必须在 `warnings`/`trace` 中记录，并在评估阶段检查 warnings 是否为空。

**Q4：Metadata Boost 在 pipeline-rerank 中的架构作用和局限性？**

Metadata Boost 是一个零成本的规则层预筛选：通过关键词重叠给 chunk 加权，把"结构上肯定相关"的 chunk 先排到候选集前端，再截断送入昂贵的 cross-encoder。它的价值在于：①减少 cross-encoder 的输入量（降低延迟）；②把有明确结构信号的 chunk（如 sourceRef 含有查询关键词）优先处理。局限性：当 `boostPassN ≥ 实际候选数`时截断不生效；当 cross-encoder 分数极度集中（0.8+ vs 0.01）时，boost 的微小偏移无法翻转排名——这是 cross-encoder softmax 的固有特性，不能通过简单的分数混合解决。
