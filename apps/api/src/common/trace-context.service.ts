/**
 * TraceContextService — feat-200.1 Week 1（骨架）
 *
 * 提供基于 AsyncLocalStorage 的请求级 Trace 上下文：
 *   - traceId：每个 HTTP 请求一个；穿过所有 service 调用
 *   - costBreakdown：累计本次请求消耗的 token / vector / rerank / 钱（feat-200.3 接 LLM 时填充）
 *
 * Week 1 只搭骨架：
 *   - run()：在 interceptor 入口启动一个 Context
 *   - currentTrace()：业务 service 取当前 trace（不强制；Week 1 没人用）
 *   - addCost()：占位 API，方便 Week 3 / 4 调 LLM 时累计成本
 *
 * 为什么用 AsyncLocalStorage 而不是 NestJS REQUEST scope DI：
 *   - REQUEST scope 会让所有依赖 scope 化（性能下降，每请求重建实例）
 *   - AsyncLocalStorage 是 Node 标准 API（v16+），零依赖
 *   - 跨 async/await 边界自动传递，业务代码不必显式接 traceId
 */

import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "async_hooks";

export interface CostBreakdown {
  // 累计 prompt + completion token（LLM）
  llmTokensPrompt: number;
  llmTokensCompletion: number;
  // 向量计算次数（embedding）
  embeddingCalls: number;
  // 检索次数（pgvector + bm25 + rerank）
  retrievalCalls: number;
  rerankerCalls: number;
  // 累计美元
  costUsd: number;
}

export interface TraceContext {
  traceId: string;
  startedAt: number; // performance.now()
  cost: CostBreakdown;
}

function emptyCost(): CostBreakdown {
  return {
    llmTokensPrompt: 0,
    llmTokensCompletion: 0,
    embeddingCalls: 0,
    retrievalCalls: 0,
    rerankerCalls: 0,
    costUsd: 0,
  };
}

@Injectable()
export class TraceContextService {
  private readonly als = new AsyncLocalStorage<TraceContext>();

  /**
   * 在新的 trace context 内执行 fn。
   * Interceptor 在每个 HTTP 请求开头调用：
   *   tracer.run(traceId, () => next.handle())
   */
  run<T>(traceId: string, fn: () => T): T {
    const ctx: TraceContext = {
      traceId,
      startedAt: performance.now(),
      cost: emptyCost(),
    };
    return this.als.run(ctx, fn);
  }

  /** 取当前请求的 trace context；非请求路径返回 undefined */
  current(): TraceContext | undefined {
    return this.als.getStore();
  }

  /**
   * 累加成本——Week 3 起 pipeline-orchestrator 在调 LLM / embedding 后调用。
   * Week 1 只搭好接口，没人调。
   */
  addCost(delta: Partial<CostBreakdown>): void {
    const ctx = this.als.getStore();
    if (!ctx) return; // 非请求上下文（如 boot/cron）静默忽略
    ctx.cost.llmTokensPrompt += delta.llmTokensPrompt ?? 0;
    ctx.cost.llmTokensCompletion += delta.llmTokensCompletion ?? 0;
    ctx.cost.embeddingCalls += delta.embeddingCalls ?? 0;
    ctx.cost.retrievalCalls += delta.retrievalCalls ?? 0;
    ctx.cost.rerankerCalls += delta.rerankerCalls ?? 0;
    ctx.cost.costUsd += delta.costUsd ?? 0;
  }
}
