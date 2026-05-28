/**
 * RAG Pipeline Stage - Prompt Build - 纯算法
 *
 * 2 method：
 *   rag-template        标准 RAG（grounding 三规则）
 *   marketing-template  营销场景（受众 / 语气 / 结构化）
 */

import type {
  EvidenceItem,
  PromptBuildInput,
  PromptBuildOutput,
  PromptBuildResult,
} from "@harness/shared-types";
import { PipelineError } from "../errors";

// ─── rag-template ─────────────────────────────────────────────────────────────

/**
 * System prompt 的三个核心约束（Anthropic Groundedness）：
 *   1. 基于资料回答（grounding）
 *   2. 信息不足时明确说明（honesty）
 *   3. 不编造资料里没有的内容（hallucination prevention）
 */
function buildRAGTemplate(
  contextText: string,
  query: string,
  systemPromptOverride: string,
  maxContextTokens: number,
  includeSourceRefs: boolean,
  evidencePack?: EvidenceItem[],
): PromptBuildOutput {
  const warnings: string[] = [];

  const defaultSystem = `你是一个专业的产品助手，基于提供的产品资料回答用户问题。
规则：
1. 仅基于"参考资料"中的内容回答，不要引入资料中没有的信息
2. 若参考资料不足以回答，请明确说明"根据现有资料，无法完整回答此问题"
3. 回答应简洁、准确，必要时可直接引用资料原文`;

  const finalSystem = systemPromptOverride || defaultSystem;

  const contextTokens = Math.ceil(contextText.length / 4);
  let truncatedContext = contextText;
  if (contextTokens > maxContextTokens) {
    const maxChars = maxContextTokens * 4;
    truncatedContext = contextText.slice(0, maxChars) + "\n…（参考资料已截断）";
    warnings.push(
      `参考资料超出 maxContextTokens (${maxContextTokens})，已截断至约 ${maxContextTokens} tokens`,
    );
  }

  const refNote = includeSourceRefs ? "\n（回答时请在适当位置标注 [evidence-NNN] 引用编号）" : "";

  const userPrompt = `参考资料：
${truncatedContext}

用户问题：${query}${refNote}`;

  const fullPrompt = `${finalSystem}\n\n${userPrompt}`;
  const tokenEstimate = Math.ceil(fullPrompt.length / 4);

  return {
    systemPrompt: finalSystem,
    userPrompt,
    fullPrompt,
    tokenEstimate,
    originalQuery: query,
    warnings,
    evidencePack,
  };
}

// ─── marketing-template ───────────────────────────────────────────────────────

/**
 * marketing-template prompt 设计要点（feat-200.7 修正）：
 *
 *   旧 user prompt 后缀写的是"可包含：核心卖点、使用场景、差异化优势、内容角度建议"，
 *   LLM 看到这个建议清单就只从里面挑——用户问 "5 个卖点及小红书笔记" 时小红书笔记被忽略。
 *
 *   新版思路：
 *   1. 不给"可选清单"——给"如何理解任务"的指导
 *   2. 明确要求"覆盖用户任务里每一种被指名的产物形态，不可遗漏"
 *   3. 给"产物的结构约定"——markdown 二级标题分块（让前端可拆段保存）
 *   4. 给一个 few-shot 风格的小例子（5 卖点 + 笔记的标准产物形态）
 */
function buildMarketingTemplate(
  contextText: string,
  query: string,
  targetAudience: string,
  tone: string,
  maxContextTokens: number,
  evidencePack?: EvidenceItem[],
): PromptBuildOutput {
  const warnings: string[] = [];

  const audienceNote = targetAudience ? `目标受众：${targetAudience}` : "";
  const toneNote = tone ? `输出语气：${tone}` : "";

  const systemPrompt = `你是一位专业的中文营销内容创作者，擅长基于真实产品资料产出可直接发布的多平台营销内容。

${audienceNote}
${toneNote}

# 核心准则
1. **任务完整性**：用户任务里如果指明了多种产物形态（如"5 个卖点 + 小红书笔记"），必须**全部产出**，不可任意省略其中任何一种。一旦遗漏视为未完成任务。
2. **资料锚定**：所有营销主张必须基于"产品资料"里的事实；关键事实句末标注 [evidence-001] 这样的引用编号。
3. **缺料诚实**：若某要点的资料支撑不足，在该要点末尾用斜体标注 *（资料不足，建议补充：XXX）*，而不是编造。
4. **结构化输出**：用 markdown 二级标题（##）把不同产物形态分块，例如：
   \`\`\`
   ## 核心卖点
   1. **卖点名**：简短描述 [evidence-001]
   ...
   ## 小红书笔记
   ### 标题：xxx
   正文...
   #标签1 #标签2
   \`\`\`
   每个二级标题块要能被独立提取作为一篇可发布的内容。

# 平台风格提示（仅供参考，按 query 实际指定为准）
- 小红书：emoji 多、口语化、首行抓眼球、末尾带 3-8 个 #话题标签
- 微博：140 字内核心信息 + 1 个话题标签 + 引导互动一句
- 抖音/短视频：脚本格式（场景 + 旁白 + 字幕提示），节奏紧凑
- 公众号：长文结构（开篇钩子 + 主体分点 + 行动号召）`.trim();

  const contextTokens = Math.ceil(contextText.length / 4);
  let truncatedContext = contextText;
  if (contextTokens > maxContextTokens) {
    truncatedContext = contextText.slice(0, maxContextTokens * 4) + "\n…（资料已截断）";
    warnings.push(`参考资料超出 maxContextTokens，已截断`);
  }

  const userPrompt = `# 产品资料
${truncatedContext}

# 用户任务
${query}

# 输出要求
- 严格按"核心准则 1（任务完整性）"全面覆盖任务里指定的所有产物
- 每种产物前用 markdown ## 标题分块，便于读者快速浏览和分别使用
- 不要在结尾加"还有什么需要帮助"之类的寒暄
- 直接输出 markdown 正文，不要再用代码块包裹整篇`;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  const tokenEstimate = Math.ceil(fullPrompt.length / 4);

  return {
    systemPrompt,
    userPrompt,
    fullPrompt,
    tokenEstimate,
    originalQuery: query,
    warnings,
    evidencePack,
  };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

export function runPromptBuild(input: PromptBuildInput): PromptBuildResult {
  const { methodId, params, upstream } = input;

  const contextText = upstream.contextText ?? "";
  // 上游 citation.originalQuery 优先于 params.query；空字符串也回退到 params.query
  const query = (upstream.originalQuery?.trim() || params.query).trim();
  if (!query) {
    throw new PipelineError(
      "empty_query",
      "query 为空：请确保 retrieval → citation 链完整运行，或在 params.query 中填写",
    );
  }

  let output: PromptBuildOutput;

  switch (methodId) {
    case "marketing-template":
      output = buildMarketingTemplate(
        contextText,
        query,
        params.targetAudience,
        params.tone,
        params.maxContextTokens,
        upstream.evidencePack,
      );
      break;
    case "rag-template":
    default:
      output = buildRAGTemplate(
        contextText,
        query,
        params.systemPrompt,
        params.maxContextTokens,
        params.includeSourceRefs,
        upstream.evidencePack,
      );
      break;
  }

  return {
    output,
    trace: {
      methodId,
      evidenceCount: upstream.totalEvidence,
      tokenEstimate: output.tokenEstimate,
      contextLength: contextText.length,
    },
    warnings: output.warnings,
  };
}
