/**
 * 共享 NLP 工具模块（中文优先）
 *
 * 本模块集中管理所有文本处理原语，供 pipeline 各 stage 统一使用：
 *   - jieba 分词单例（避免重复加载词典）
 *   - 停用词表（中文通用 + 英文通用 + 产品文档领域词）
 *   - tokenize / tokenizeToSet：分词 + 停用词过滤
 *   - tokenizeForBM25：BM25 专用分词（不去停用词）
 *   - extractKeywords：基于词频的关键词提取
 *
 * ⚠️  依赖说明：
 *   此模块只依赖 @node-rs/jieba（Rust binding，预编译二进制）。
 *   停用词表直接内联，不依赖 stopword 等外部包，避免 ESM/CJS 兼容性问题。
 *
 * 面试考点：
 *   Q: 为什么 RAG 里关键词提取需要停用词过滤？
 *   A: BM25、Metadata Boost、MMR Jaccard 都依赖词集合的 overlap 来判断相关性。
 *      "的/了/在" 等高频词出现在几乎所有文本中，若不过滤，它们会主导 overlap 分数，
 *      而真正有判别力的词（"色彩方案"、"存储同步"）反而被稀释。
 */

import { Jieba } from "@node-rs/jieba";

// ─── Jieba 单例 ────────────────────────────────────────────────────────────────
// module 级别初始化一次，词典加载约 50-100ms，之后每次 cut 仅需 <1ms
export const jieba = new Jieba();

// ─── 停用词表（内联，无外部依赖）──────────────────────────────────────────────
//
// 来源与构成：
//   1. 中文通用停用词（对应 stopword 包 zho 列表，78 词）
//   2. 英文通用停用词（常见介词/冠词/助动词）
//   3. 产品文档领域特定词（RAG 场景专用补充）
//
// 维护原则："如果这个词出现在产品文档的大多数章节，它就应该是停用词"

const STOPWORDS = new Set<string>([
  // ── 中文通用停用词 ────────────────────────────────────────────────────────────
  // 助词
  "的", "地", "得", "着", "了", "过",
  // 代词
  "我", "你", "他", "她", "它", "我们", "你们", "他们", "她们", "它们",
  "这", "那", "这个", "那个", "这些", "那些", "其", "某", "各", "每",
  "谁", "什么", "哪", "哪些", "哪个",
  // 连词/介词
  "和", "跟", "与", "及", "向", "并", "等", "更", "已", "含", "做",
  "在", "于", "对", "从", "到", "向", "按", "共", "请",
  // 副词/助动词
  "是", "不", "都", "也", "很", "把", "还", "有", "小", "为", "中",
  "会", "可", "之", "第", "此", "或",
  // 时间词
  "年", "月", "日", "时", "分", "秒",
  // 语气词
  "呢", "吧", "吗", "了", "嘛", "哇", "儿", "哼", "啊", "嗯",

  // ── 英文通用停用词 ────────────────────────────────────────────────────────────
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "of", "in", "on", "at", "to", "for", "with", "by", "from", "as", "it",
  "this", "that", "these", "those", "and", "or", "but", "not", "no",
  "can", "may", "might", "shall", "must", "let", "its", "their", "our",

  // ── 产品文档领域特定停用词 ────────────────────────────────────────────────────
  // 疑问词（出现在 query，但不出现在文档内容，干扰 Metadata Boost 匹配）
  "如何", "怎么", "怎样", "为什么", "多少", "是否",
  "有什么", "是什么", "怎么样", "有哪些",
  // 高频动词（几乎每个功能描述都有，无判别力）
  "支持", "提供", "实现", "进行", "使用", "设置", "完成", "操作",
  "管理", "处理", "配置", "显示", "查看", "获取", "创建", "删除",
  // 连词/副词
  "以及", "同时", "并且", "包括", "其中", "另外", "此外", "然而",
  "通过", "对于", "关于", "基于", "针对", "根据", "按照", "依据",
  // 程度/范围词
  "主要", "基本", "相关", "具体", "完整", "全部", "所有", "部分",
  "目前", "现在", "已经", "可能", "需要", "可以", "应该",
  // 指代/泛称词
  "其他", "各种", "一些", "某些",
]);

// ─── 核心工具函数 ──────────────────────────────────────────────────────────────

/**
 * 使用 jieba 对文本分词，可选过滤停用词。
 *
 * @param text       待分词的文本（支持中英文混合）
 * @param removeStop 是否过滤停用词（默认 true）
 * @param minLength  最短词长过滤（默认 2，过滤单字噪声）
 *
 * 示例：
 *   tokenize("产品的整体设计风格和主题色方案是什么？")
 *   → ["整体", "设计", "风格", "主题色", "方案"]
 */
export function tokenize(
  text: string,
  removeStop = true,
  minLength = 2
): string[] {
  const words = jieba
    .cut(text, true)                          // HMM=true：未登录词识别
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= minLength);

  if (!removeStop) return words;
  return words.filter((w) => !STOPWORDS.has(w));
}

/**
 * 分词并返回 Set（用于 Jaccard 重叠、Metadata Boost 等集合操作场景）。
 */
export function tokenizeToSet(
  text: string,
  removeStop = true,
  minLength = 2
): Set<string> {
  return new Set(tokenize(text, removeStop, minLength));
}

/**
 * BM25 专用分词器：jieba 分词，**不过滤停用词**，保留最小词长 2。
 *
 * 为什么 BM25 不需要过滤停用词？
 *   BM25 的 IDF 项会自动对高频词（"的"、"了"、"支持"）给予极低权重，
 *   因为它们出现在几乎所有文档中，df 接近 N，IDF ≈ log(1) = 0。
 *   人为过滤反而会导致 term 集合不完整，影响 IDF 计算准确性。
 *
 * 与 tokenize(text, removeStop=true) 的区别：
 *   tokenize         → 关键词提取、Metadata Boost（需要有实义词）
 *   tokenizeForBM25  → BM25 检索（保留全部词，让 IDF 自然压制无意义词）
 */
export function tokenizeForBM25(text: string): string[] {
  return tokenize(text, false, 2);
}

/**
 * 基于 TF（词频）的关键词提取，使用 jieba 分词 + 停用词过滤。
 *
 * 局限：纯 TF 没有 IDF，高频词（"产品"）可能仍然排前。
 * 改进方向：集成 @node-rs/jieba 的 TfIdf 类（feat-010 待做）。
 *
 * @param text  待提取的文本
 * @param topN  返回前 N 个关键词
 */
export function extractKeywords(text: string, topN: number): string[] {
  const tokens = tokenize(text);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}
