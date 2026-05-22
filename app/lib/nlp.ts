/**
 * 共享 NLP 工具模块（中文优先）
 *
 * 本模块集中管理所有文本处理原语，供 pipeline 各 stage 统一使用：
 *   - jieba 分词单例（避免重复加载词典）
 *   - 停用词表（zho + eng + 产品文档领域词）
 *   - tokenize / tokenizeToSet：分词 + 停用词过滤
 *   - extractKeywords：基于词频的关键词提取（已正确处理中文）
 *
 * 为什么集中管理？
 *   过去 transform / query-rewrite / rerank 各自维护一份手写停用词表（40-60 词），
 *   三份列表已发散，且覆盖率严重不足（中文产品文档常用无实义词超过 500 个）。
 *   统一到此模块后，任何修改只需改一处。
 *
 * 面试考点：
 *   Q: 为什么 RAG 里关键词提取需要停用词过滤？
 *   A: BM25、Metadata Boost、MMR Jaccard 都依赖词集合的 overlap 来判断相关性。
 *      "的/了/在" 等高频词出现在几乎所有文本中，若不过滤，它们会主导 overlap 分数，
 *      而真正有判别力的词（"色彩方案"、"存储同步"）反而被稀释。
 */

import { Jieba } from "@node-rs/jieba";
import { removeStopwords, zho, eng } from "stopword";

// ─── Jieba 单例 ────────────────────────────────────────────────────────────────
// module 级别初始化一次，词典加载约 50-100ms，之后每次 cut 仅需 <1ms
export const jieba = new Jieba();

// ─── 停用词表 ──────────────────────────────────────────────────────────────────

/**
 * 产品文档领域特定停用词（补充 stopword 包 zho 列表的不足）。
 *
 * 这些词在产品文档中极高频但无判别意义：
 *   - 动词：支持、提供、实现、进行、使用、设置
 *   - 连接词：以及、同时、并且、包括
 *   - 程度词：主要、基本、相关、具体、完整
 *
 * 如何确定要不要加某个词：
 *   "如果这个词出现在产品文档的大多数章节，它就应该是停用词"。
 */
const PRODUCT_DOC_STOPWORDS_ZH: string[] = [
  // 疑问词（出现在 query 但不出现在文档内容，会干扰 Metadata Boost 关键词匹配）
  "什么", "哪些", "如何", "怎么", "哪个", "是否", "为什么", "怎样", "多少",
  "有哪些", "有什么", "是什么", "怎么样",
  // 高频动词（几乎每个功能描述都有）
  "支持", "提供", "实现", "进行", "使用", "设置", "完成", "操作",
  "管理", "处理", "配置", "显示", "查看", "获取", "创建", "删除",
  // 连词/副词
  "以及", "同时", "并且", "包括", "其中", "另外", "此外", "然而",
  "通过", "对于", "关于", "基于", "针对", "根据", "按照", "依据",
  // 程度/范围词
  "主要", "基本", "相关", "具体", "完整", "全部", "所有", "部分",
  "目前", "现在", "已经", "可能", "需要", "可以", "应该",
  // 指代词（stopword 包已有但再加一层保险）
  "这些", "那些", "其他", "各种", "一些", "某些",
];

// 合并：stopword 包提供的标准列表 + 产品文档领域补充
const ALL_STOPWORDS: string[] = [
  ...zho,                      // stopword 包：78 个通用中文停用词
  ...eng,                      // stopword 包：英文停用词
  ...PRODUCT_DOC_STOPWORDS_ZH, // 产品文档领域补充
];

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
    .cut(text, true)                         // HMM=true：未登录词识别
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= minLength);

  if (!removeStop) return words;
  return removeStopwords(words, ALL_STOPWORDS);
}

/**
 * 分词并返回 Set（用于 Jaccard 重叠、Metadata Boost、BM25 等需要集合操作的场景）。
 */
export function tokenizeToSet(
  text: string,
  removeStop = true,
  minLength = 2
): Set<string> {
  return new Set(tokenize(text, removeStop, minLength));
}

/**
 * 基于 TF（词频）的关键词提取，使用 jieba 分词 + 停用词过滤。
 *
 * 局限：纯 TF 没有 IDF，高频词（"产品"）可能仍然排前。
 * 改进方向：集成 @node-rs/jieba 的 TfIdf 类（待 feat-010）。
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
