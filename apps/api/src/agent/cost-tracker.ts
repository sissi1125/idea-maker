/**
 * CostTracker — feat-300.3 任务 1
 *
 * 累计 LLM token 消耗 → 美元成本，给 budget cap 提供判断依据。
 *
 * 设计选择（详见 docs/agent/feat-300.3-plan.md §2）：
 *   - 硬编码 PRICING const：LLM 价格不频繁变动，MVP 改价改代码部署
 *     未来要动态化只改 lookupPrice() 一处（DB / 环境变量 / 远端配置）
 *   - 每个 model 一个 PriceRow：input / output token 分别计价
 *     与 OpenAI / 智谱 / SiliconFlow 等 provider 的实际计价方式一致
 *   - 未知 model 退到 DEFAULT_FALLBACK_PRICE，不抛错——agent 仍能跑完，
 *     成本可能略有偏差但不影响功能。日志里 warn 一下。
 *
 * **为什么不在 AgentRunner 里直接计算**：
 *   1. 单元测试容易：CostTracker 是纯类，不依赖 NestJS 容器
 *   2. 未来要按"工具调用次数"扣费时（如 Tavily search 单独计价）扩展更简单
 *      只需多加一个 addToolCall(toolName) 方法，调用方零改动
 */

import { Logger } from "@nestjs/common";

/**
 * 一行价格：input 与 output token 各自 USD per 1k tokens。
 * 数值都从 provider 官网公开价格表抄录（注释里标 source + 抓取日期）。
 */
export interface PriceRow {
  /** 1k input tokens 的 USD 价 */
  inputPer1k: number;
  /** 1k output tokens 的 USD 价 */
  outputPer1k: number;
  /** 这条价格的取数说明（注释源），便于审计 */
  source?: string;
}

/**
 * MVP 价格表。
 *
 * 单位：USD per 1k tokens（不是 per million，避免心算出错）。
 *
 * 中国 provider 的人民币价已按 1 USD = 7.2 CNY 转。汇率写在注释里以便
 * 1 年后回看时调整。
 */
export const PRICING: Record<string, PriceRow> = {
  // OpenAI（2026-05 价目）
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006, source: "openai.com 2026-05" },
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01, source: "openai.com 2026-05" },

  // 智谱 GLM 系列（bigmodel.cn 2026-05，CNY→USD @ 7.2）
  "glm-4-flash": { inputPer1k: 0.0000139, outputPer1k: 0.0000139, source: "智谱 0.1元/百万 ÷7.2" },
  "glm-4-plus": { inputPer1k: 0.0069, outputPer1k: 0.0069, source: "智谱 50元/百万 ÷7.2" },
  "glm-4-air": { inputPer1k: 0.0000139, outputPer1k: 0.0000139, source: "智谱 air 价格" },

  // SiliconFlow（siliconflow.cn 2026-05）
  "deepseek-ai/DeepSeek-V3": { inputPer1k: 0.00028, outputPer1k: 0.00112, source: "DeepSeek 标价" },
  "Qwen/Qwen2.5-72B-Instruct": { inputPer1k: 0.00056, outputPer1k: 0.00056, source: "SiliconFlow" },
};

/**
 * 未知 model 的兜底价格——按"中等智谱模型"估，宁高勿低让 budget 闸门更早触发。
 * 用 warn 日志记录未知 model 名，便于后续添加到 PRICING。
 */
const DEFAULT_FALLBACK_PRICE: PriceRow = {
  inputPer1k: 0.001,
  outputPer1k: 0.002,
  source: "fallback estimate",
};

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * 一次 agent run 维护一个 CostTracker 实例。
 *
 * 状态：累计 input/output token 数 + 累计 USD。每次 onStepFinish 调 add()。
 *
 * 线程安全说明：Node 单线程事件循环 + agent run 是顺序的（onStepFinish 一次只一个
 * step），不会有并发 add() 调用。无需锁。
 */
export class CostTracker {
  private readonly logger = new Logger(CostTracker.name);
  private readonly price: PriceRow;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalUsd = 0;

  constructor(private readonly modelName: string) {
    this.price = lookupPrice(modelName, this.logger);
  }

  /** 累加一次 token usage 到总账，返回新的累计 USD */
  add(usage: TokenUsage): number {
    this.totalInputTokens += usage.promptTokens;
    this.totalOutputTokens += usage.completionTokens;
    const delta =
      (usage.promptTokens / 1000) * this.price.inputPer1k +
      (usage.completionTokens / 1000) * this.price.outputPer1k;
    this.totalUsd += delta;
    return this.totalUsd;
  }

  /** 当前累计 USD */
  get total(): number {
    return this.totalUsd;
  }

  /** 是否已超 budget。budget = 0 视为无上限（即任何累计都不算超） */
  over(budgetUsd: number): boolean {
    if (budgetUsd <= 0) return false;
    return this.totalUsd > budgetUsd;
  }

  /** budget 使用百分比 0-∞（可能 > 100，UI 上夹到 100 即可） */
  percentOf(budgetUsd: number): number {
    if (budgetUsd <= 0) return 0;
    return (this.totalUsd / budgetUsd) * 100;
  }

  /** 累计 token 明细，写 agent_runs.cost_used_usd / cost_summary 时用 */
  snapshot(): {
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    usd: number;
  } {
    return {
      modelName: this.modelName,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      usd: this.totalUsd,
    };
  }
}

/**
 * 查找 model 的价格。未匹配走 DEFAULT_FALLBACK_PRICE + warn 日志。
 *
 * 抽成模块级函数便于单测 + 未来切换数据源（DB / env）只改这里。
 */
export function lookupPrice(modelName: string, logger?: Logger): PriceRow {
  const exact = PRICING[modelName];
  if (exact) return exact;
  // 简单后缀匹配：'gpt-4o-mini-2024-07' 也能命中 'gpt-4o-mini'
  for (const key of Object.keys(PRICING)) {
    if (modelName.startsWith(key)) return PRICING[key];
  }
  logger?.warn(
    `CostTracker: unknown model "${modelName}", using fallback price; add to PRICING for accurate cost.`,
  );
  return DEFAULT_FALLBACK_PRICE;
}

/**
 * Budget 闸门抛出的异常——AgentRunner 主循环 catch 后走 fallback 路径。
 *
 * 单独成异常类（而不是普通 Error）让 AgentRunner 用 instanceof 区分错误类型
 * 决定走 budget fallback 还是其他错误处理。
 */
export class BudgetExceededError extends Error {
  constructor(public readonly usedUsd: number, public readonly budgetUsd: number) {
    super(`Budget exceeded: used $${usedUsd.toFixed(6)} > budget $${budgetUsd.toFixed(6)}`);
    this.name = "BudgetExceededError";
  }
}
