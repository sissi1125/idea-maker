/**
 * 评测 Agent（LLM-as-judge）—— feat-400.2
 *
 * 只吃"受限上下文"（plan §5.4）：Campaign/内容 + 已确认 Brief 事实摘要 +
 * 引用的 Claim 与 evidence + 平台约束。**不给全量文档、不许补外部事实**，否则它会脑补。
 *
 * 输出经 Zod 强校验；解析失败或没有可用模型 → 返回 null（优雅降级），
 * 由决策器把"没有评测"处理成 human_review，绝不自动放行。
 */

import { Injectable, Logger } from "@nestjs/common";
import { generateText } from "ai";
import { z } from "zod";
import { DbService } from "../db/db.service";
import { LlmService } from "../llm/llm.service";
import type { ContentScores } from "./decision";

const ScoresSchema = z.object({
  factualFaithfulness: z.number().min(1).max(5),
  audienceFit: z.number().min(1).max(5),
  platformFit: z.number().min(1).max(5),
  clarity: z.number().min(1).max(5),
  differentiation: z.number().min(1).max(5),
  styleFit: z.number().min(1).max(5),
  issues: z
    .array(
      z.object({
        severity: z.enum(["blocker", "warning", "suggestion"]),
        category: z.string(),
        evidence: z.string().optional(),
        recommendation: z.string(),
      }),
    )
    .default([]),
});

export interface EvalContext {
  variant: { angle?: string | null; hook?: string | null; body: string; cta?: string | null; platform?: string | null };
  briefFacts: string[];
  claims: Array<{ text: string; evidenceCount: number }>;
  platformNote?: string;
}

@Injectable()
export class EvaluationAgent {
  private readonly logger = new Logger(EvaluationAgent.name);

  constructor(
    private readonly db: DbService,
    private readonly llm: LlmService,
  ) {}

  /** 解析 + Zod 校验，剥 ```json fence */
  parseScores(text: string): ContentScores | null {
    const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    let json: unknown;
    try {
      json = JSON.parse(stripped);
    } catch {
      const s = stripped.indexOf("{");
      const e = stripped.lastIndexOf("}");
      if (s === -1 || e === -1) return null;
      try {
        json = JSON.parse(stripped.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    // 真实模型有时把单个评分对象也包进数组 [{...}]，取首个元素
    if (Array.isArray(json)) json = (json as unknown[])[0] ?? null;
    const parsed = ScoresSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }

  buildPrompt(ctx: EvalContext): string {
    return [
      "你是营销内容评审。只依据下面给出的【已确认事实】和【已批准卖点】评审内容，",
      "严禁引入未给出的事实，也不要臆测产品能力。",
      "",
      "【已确认产品事实】：",
      ...(ctx.briefFacts.length ? ctx.briefFacts.map((f) => `- ${f}`) : ["（无）"]),
      "",
      "【本条内容引用的已批准卖点】：",
      ...(ctx.claims.length ? ctx.claims.map((c) => `- ${c.text}（evidence ${c.evidenceCount} 处）`) : ["（无）"]),
      "",
      ctx.platformNote ? `【平台约束】：${ctx.platformNote}` : "",
      "",
      "【待评审内容】：",
      `角度：${ctx.variant.angle ?? ""}`,
      `Hook：${ctx.variant.hook ?? ""}`,
      `正文：${ctx.variant.body}`,
      `CTA：${ctx.variant.cta ?? ""}`,
      "",
      "只输出 JSON：",
      '{"factualFaithfulness":1-5,"audienceFit":1-5,"platformFit":1-5,"clarity":1-5,',
      '"differentiation":1-5,"styleFit":1-5,"issues":[{"severity":"blocker|warning|suggestion",',
      '"category":"...","evidence":"...","recommendation":"..."}]}',
      "打分锚点：1=严重不符/不可用，3=可用但有明显问题，5=优秀。",
      "只要内容出现任何与已确认事实不符或无据的产品说法，factualFaithfulness ≤ 2 且加一个 blocker issue。",
    ].filter((l) => l !== "").join("\n");
  }

  private async resolveModel(projectId: string) {
    const settings = await this.db.withClient(async (client) => {
      const { rows } = await client.query<{ provider: string | null; encrypted_api_key: string | null; model: string | null }>(
        `SELECT provider, encrypted_api_key, model FROM project_settings WHERE project_id = $1`,
        [projectId],
      );
      return rows[0] ?? null;
    });
    return this.llm.create({
      provider: settings?.provider ?? null,
      apiKey: settings?.encrypted_api_key ?? null,
      model: settings?.model ?? null,
    });
  }

  /** 跑一次评测；任何失败（无 key / 网络 / 解析）→ null，交给决策器降级 */
  async evaluate(projectId: string, ctx: EvalContext): Promise<{ scores: ContentScores | null; model: string | null }> {
    try {
      const model = await this.resolveModel(projectId);
      const { text } = await generateText({
        model,
        prompt: this.buildPrompt(ctx),
        temperature: 0.2,
        maxTokens: 1200,
        abortSignal: AbortSignal.timeout(60_000),
      });
      return { scores: this.parseScores(text), model: (model as { modelId?: string })?.modelId ?? null };
    } catch (err) {
      this.logger.warn(`[eval-agent] 评测降级（返回 null）：${err instanceof Error ? err.message : err}`);
      return { scores: null, model: null };
    }
  }
}
