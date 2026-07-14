/**
 * ContentEvaluationService — feat-400.2
 *
 * 一条内容候选的评测编排：存 variant → 跑确定性门禁 → 门禁过则跑评测 Agent
 * → 决策器定四态 → 存 content_evaluations（可回放）。外加 human_review 队列。
 *
 * 顺序即门禁哲学：门禁失败直接 blocked，连评测都不跑，模型高分无从覆盖。
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Client as PgClient } from "pg";
import { DbService } from "../db/db.service";
import {
  runDeterministicGate,
  type GateClaim,
  type GatePlatform,
} from "./deterministic-gate";
import { decide, type ContentScores } from "./decision";
import { EvaluationAgent, type EvalContext } from "./evaluation-agent";
import type { ClaimType } from "../claims/claims.types";

export interface SubmitVariantInput {
  angle?: string;
  targetAudience?: string;
  hook?: string;
  body: string;
  cta?: string;
  claimIds?: string[];
  platform?: string;
  platformMaxLength?: number;
  platformBannedWords?: string[];
}

export interface EvaluationResult {
  variantId: string;
  gatePassed: boolean;
  gateFailures: Array<{ rule: string; detail: string }>;
  scores: ContentScores | null;
  decision: string;
  evaluationId: string;
}

function toArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

@Injectable()
export class ContentEvaluationService {
  private readonly logger = new Logger(ContentEvaluationService.name);

  constructor(
    private readonly db: DbService,
    private readonly agent: EvaluationAgent,
  ) {}

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  /** 载入项目全部 Claim → gate 用 */
  private async loadClaims(client: PgClient, projectId: string): Promise<Map<string, GateClaim>> {
    const { rows } = await client.query<{
      id: string; text: string; status: string; claim_type: string; evidence_chunk_ids: unknown;
    }>(
      `SELECT id, text, status, claim_type, evidence_chunk_ids FROM claims WHERE project_id = $1`,
      [projectId],
    );
    const map = new Map<string, GateClaim>();
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        text: r.text,
        status: r.status as GateClaim["status"],
        claimType: r.claim_type as ClaimType,
        evidenceChunkIds: toArr(r.evidence_chunk_ids),
      });
    }
    return map;
  }

  /** 已确认 Brief 事实（给评测 Agent 的受限上下文） */
  private async loadBriefFacts(client: PgClient, projectId: string): Promise<string[]> {
    const { rows } = await client.query<{ field_key: string; value: unknown }>(
      `SELECT f.field_key, f.value
         FROM product_brief_fields f
         JOIN product_briefs b ON b.id = f.brief_id
        WHERE b.project_id = $1 AND f.status = 'confirmed'
          AND f.field_group IN ('fact', 'identity', 'positioning', 'audience')`,
      [projectId],
    );
    return rows.map((r) => {
      const v = Array.isArray(r.value) ? r.value.join("、") : String(r.value ?? "");
      return `${r.field_key}：${v}`;
    });
  }

  async submitAndEvaluate(userId: string, projectId: string, input: SubmitVariantInput): Promise<EvaluationResult> {
    await this.assertOwner(userId, projectId);
    if (!input.body?.trim()) throw new BadRequestException("内容正文不能为空");
    const claimIds = input.claimIds ?? [];

    return this.db.withClient(async (client) => {
      // 1. 存 variant
      const variantId = randomUUID();
      await client.query(
        `INSERT INTO content_variants
           (id, project_id, angle, target_audience, hook, body, cta, claim_ids, platform)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [variantId, projectId, input.angle ?? null, input.targetAudience ?? null,
         input.hook ?? null, input.body, input.cta ?? null, JSON.stringify(claimIds), input.platform ?? null],
      );

      // 2. 确定性门禁
      const claimsById = await this.loadClaims(client, projectId);
      const platform: GatePlatform | undefined =
        input.platformMaxLength || input.platformBannedWords
          ? { maxLength: input.platformMaxLength, bannedWords: input.platformBannedWords }
          : undefined;
      const gate = runDeterministicGate(
        { body: input.body, hook: input.hook, cta: input.cta, claimIds },
        { claimsById, platform },
      );

      // 3. 门禁过 → 跑评测 Agent（受限上下文）；门禁不过 → 不跑，直接 blocked
      let scores: ContentScores | null = null;
      let evalModel: string | null = null;
      if (gate.passed) {
        const briefFacts = await this.loadBriefFacts(client, projectId);
        const claims = claimIds
          .map((id) => claimsById.get(id))
          .filter((c): c is GateClaim => !!c)
          .map((c) => ({ text: c.text, evidenceCount: c.evidenceChunkIds.length }));
        const ctx: EvalContext = {
          variant: { angle: input.angle, hook: input.hook, body: input.body, cta: input.cta, platform: input.platform },
          briefFacts,
          claims,
          platformNote: platform?.maxLength ? `字数上限 ${platform.maxLength}` : undefined,
        };
        const r = await this.agent.evaluate(projectId, ctx);
        scores = r.scores;
        evalModel = r.model;
      }

      // 4. 决策 + 存评测（可回放）
      const decision = decide(gate, scores);
      const evaluationId = randomUUID();
      await client.query(
        `INSERT INTO content_evaluations
           (id, project_id, variant_id, gate_passed, gate_failures, scores, issues, decision, eval_model)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)`,
        [evaluationId, projectId, variantId, gate.passed, JSON.stringify(gate.failures),
         scores ? JSON.stringify(scores) : null, JSON.stringify(scores?.issues ?? []), decision, evalModel],
      );

      return {
        variantId,
        gatePassed: gate.passed,
        gateFailures: gate.failures,
        scores,
        decision,
        evaluationId,
      };
    });
  }

  /** human_review 队列：需要人工处理的内容 */
  async queue(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT e.id, e.variant_id, e.decision, e.gate_failures, e.scores, e.created_at,
                v.body, v.angle, v.platform
           FROM content_evaluations e
           JOIN content_variants v ON v.id = e.variant_id
          WHERE e.project_id = $1 AND e.decision = 'human_review' AND e.human_decision IS NULL
          ORDER BY e.created_at DESC`,
        [projectId],
      );
      return { queue: rows };
    });
  }

  /** 人工对一条评测下结论：accepted / edited / rejected */
  async humanDecision(userId: string, projectId: string, evaluationId: string, decision: "accepted" | "edited" | "rejected") {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `UPDATE content_evaluations SET human_decision = $3
          WHERE id = $1 AND project_id = $2 RETURNING id, decision, human_decision`,
        [evaluationId, projectId, decision],
      );
      if (rows.length === 0) throw new NotFoundException("评测记录不存在");
      return { evaluation: rows[0] };
    });
  }

  /** 全部评测记录（可回放） */
  async listEvaluations(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, variant_id, gate_passed, gate_failures, scores, decision, human_decision, eval_model, created_at
           FROM content_evaluations WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [projectId],
      );
      return { evaluations: rows };
    });
  }
}
