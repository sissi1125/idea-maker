/**
 * CampaignsService — feat-400.4
 *
 * Campaign Brief → 3 个可比较角度（ContentVariant）。核心保证：
 *   - grounding：生成角度只能引用"本次允许 ∩ 已批准"的卖点，越界引用剔除；
 *   - 读取时对每个角度实时跑硬规则检查 + 决策，方便并排比较；
 *   - 不做自动发布。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { generateText } from "ai";
import { DbService } from "../db/db.service";
import type { DbClient } from "../db/db-client";
import { LlmService } from "../llm/llm.service";
import { JobsService } from "../jobs/jobs.service";
import { ContentEvaluationService } from "../content-evaluation/content-evaluation.service";
import { runDeterministicGate, type GateClaim } from "../content-evaluation/deterministic-gate";
import { decide } from "../content-evaluation/decision";
import {
  buildGenerationPrompt,
  parseVariants,
  groundVariants,
  type CampaignBriefLite,
} from "./campaign-generation";

export interface CreateCampaignInput {
  goal: "launch" | "feature_update" | "acquisition" | "messaging";
  targetAudience?: string;
  scenario?: string;
  platform?: string;
  maxLength?: number;
  cta?: string;
  allowedClaimIds?: string[];
  avoidNotes?: string;
}

interface CampaignRow {
  id: string;
  project_id: string;
  goal: string;
  target_audience: string | null;
  scenario: string | null;
  platform: string | null;
  max_length: number | null;
  cta: string | null;
  allowed_claim_ids: unknown;
  avoid_notes: string | null;
  status: string;
  created_at: Date;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly db: DbService,
    private readonly llm: LlmService,
    private readonly jobs: JobsService,
    private readonly evaluations: ContentEvaluationService,
  ) {}

  /** 异步启动生成：立即返回 jobId，后台跑 LLM（防生产网关超时）。前端轮询 job 端点。 */
  async startGenerate(userId: string, projectId: string, campaignId: string): Promise<{ jobId: string }> {
    await this.assertOwner(userId, projectId);
    const jobId = await this.jobs.create(projectId, "campaign_generate", campaignId);
    this.jobs.runInBackground(jobId, () => this.generateVariants(userId, projectId, campaignId));
    return { jobId };
  }

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  async createCampaign(userId: string, projectId: string, input: CreateCampaignInput) {
    await this.assertOwner(userId, projectId);
    const id = randomUUID();
    await this.db.withClient(async (client) => {
      await client.query(
        `INSERT INTO campaigns
           (id, project_id, goal, target_audience, scenario, platform, max_length, cta, allowed_claim_ids, avoid_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [id, projectId, input.goal, input.targetAudience ?? null, input.scenario ?? null,
         input.platform ?? null, input.maxLength ?? null, input.cta ?? null,
         JSON.stringify(input.allowedClaimIds ?? []), input.avoidNotes ?? null],
      );
    });
    return { id };
  }

  /** 加载项目全部 Claim（gate 用）+ 已批准可用集合（grounding 用） */
  private async loadClaims(client: DbClient, projectId: string) {
    const { rows } = await client.query<{
      id: string; text: string; status: string; claim_type: string; evidence_chunk_ids: unknown;
    }>(
      `SELECT id, text, status, claim_type, evidence_chunk_ids FROM claims WHERE project_id = $1
        ORDER BY CASE origin WHEN 'user' THEN 0 ELSE 1 END, created_at DESC`,
      [projectId],
    );
    const all: GateClaim[] = rows.map((r) => ({
      id: r.id, text: r.text, status: r.status as GateClaim["status"],
      claimType: r.claim_type as GateClaim["claimType"],
      evidenceChunkIds: Array.isArray(r.evidence_chunk_ids) ? (r.evidence_chunk_ids as string[]) : [],
    }));
    return all;
  }

  private mapCampaign(row: CampaignRow): CampaignBriefLite & { allowedClaimIds: string[] } {
    return {
      goal: row.goal,
      targetAudience: row.target_audience,
      scenario: row.scenario,
      platform: row.platform,
      maxLength: row.max_length,
      cta: row.cta,
      avoidNotes: row.avoid_notes,
      allowedClaimIds: Array.isArray(row.allowed_claim_ids) ? (row.allowed_claim_ids as string[]) : [],
    };
  }

  private async getCampaignRow(client: DbClient, campaignId: string, projectId: string): Promise<CampaignRow> {
    const { rows } = await client.query<CampaignRow>(
      `SELECT * FROM campaigns WHERE id = $1 AND project_id = $2`,
      [campaignId, projectId],
    );
    if (rows.length === 0) throw new NotFoundException("Campaign 不存在");
    return rows[0];
  }

  /** Campaign 也必须尊重项目级 BYOK / model，不能静默消费服务端默认凭据。 */
  private async resolveLlmModel(projectId: string) {
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

  /**
   * 生成 N 个角度（默认 3）。替换该 campaign 已有的 generated 角度（手写的保留）。
   */
  async generateVariants(userId: string, projectId: string, campaignId: string, count = 3) {
    await this.assertOwner(userId, projectId);
    const context = await this.db.withClient(async (client) => {
      const row = await this.getCampaignRow(client, campaignId, projectId);
      const brief = this.mapCampaign(row);
      const allClaims = await this.loadClaims(client, projectId);

      // 允许集合 = 已批准 ∩（campaign 允许清单；为空则全部已批准）
      const approved = allClaims.filter((c) => c.status === "approved");
      const allowSet = new Set(brief.allowedClaimIds);
      const allowedClaims = approved.filter((c) => allowSet.size === 0 || allowSet.has(c.id));
      const allowedIds = new Set(allowedClaims.map((c) => c.id));

      return { brief, allowedClaims, allowedIds };
    });
    const model = await this.resolveLlmModel(projectId);
    const prompt = buildGenerationPrompt(context.brief, context.allowedClaims.map((c) => ({ id: c.id, text: c.text })), count);
    const t0 = Date.now();
    const { text } = await generateText({ model, prompt, temperature: 0.7, maxTokens: 2000, abortSignal: AbortSignal.timeout(90_000) });
    this.logger.log(`[campaign] gen done campaign=${campaignId} took=${Date.now() - t0}ms`);
    const grounded = groundVariants(parseVariants(text), context.allowedIds);
    const created = await this.db.withClient(async (client) => {
      await client.query(
        `DELETE FROM content_variants WHERE campaign_id = $1 AND source = 'generated'`,
        [campaignId],
      );
      const created: Array<{ id: string; angle: string; hook: string; body: string; cta: string; claimIds: string[] }> = [];
      for (const v of grounded) {
        const id = randomUUID();
        await client.query(
          `INSERT INTO content_variants
             (id, project_id, campaign_id, source, angle, target_audience, hook, body, cta, claim_ids, platform)
           VALUES ($1,$2,$3,'generated',$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [id, projectId, campaignId, v.angle, context.brief.targetAudience ?? null, v.hook, v.body, v.cta,
           JSON.stringify(v.claimIds), context.brief.platform ?? null],
        );
        created.push({ id, ...v });
      }
      return created;
    });
    for (const variant of created) {
      await this.evaluations.evaluateExistingVariant(userId, projectId, variant.id, {
        angle: variant.angle, hook: variant.hook, body: variant.body, cta: variant.cta,
        claimIds: variant.claimIds, platform: context.brief.platform ?? undefined,
        platformMaxLength: context.brief.maxLength ?? undefined,
      });
    }
    return { generated: created.length, droppedRefs: grounded.reduce((n, v) => n + v.droppedClaimIds.length, 0) };
  }

  /** 用户手写一个角度（无 LLM 路径） */
  async addManualVariant(userId: string, projectId: string, campaignId: string, input: {
    angle?: string; hook?: string; body: string; cta?: string; claimIds?: string[];
  }) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const row = await this.getCampaignRow(client, campaignId, projectId);
      const id = randomUUID();
      await client.query(
        `INSERT INTO content_variants
           (id, project_id, campaign_id, source, angle, hook, body, cta, claim_ids, platform)
         VALUES ($1,$2,$3,'manual',$4,$5,$6,$7,$8::jsonb,$9)`,
        [id, projectId, campaignId, input.angle ?? "手写", input.hook ?? "", input.body,
         input.cta ?? "", JSON.stringify(input.claimIds ?? []), row.platform ?? null],
      );
      return { id };
    });
  }

  /** 重新生成单个角度（替换该 variant） */
  async regenerateVariant(userId: string, projectId: string, campaignId: string, variantId: string) {
    await this.assertOwner(userId, projectId);
    const context = await this.db.withClient(async (client) => {
      const row = await this.getCampaignRow(client, campaignId, projectId);
      const { rows: vrows } = await client.query(
        `SELECT id FROM content_variants WHERE id = $1 AND campaign_id = $2`,
        [variantId, campaignId],
      );
      if (vrows.length === 0) throw new NotFoundException("角度不存在");
      const brief = this.mapCampaign(row);
      const allClaims = await this.loadClaims(client, projectId);
      const approved = allClaims.filter((c) => c.status === "approved");
      const allowSet = new Set(brief.allowedClaimIds);
      const allowedClaims = approved.filter((c) => allowSet.size === 0 || allowSet.has(c.id));
      const allowedIds = new Set(allowedClaims.map((c) => c.id));

      return { brief, allowedClaims, allowedIds };
    });
    const model = await this.resolveLlmModel(projectId);
    const prompt = buildGenerationPrompt(context.brief, context.allowedClaims.map((c) => ({ id: c.id, text: c.text })), 1);
    const { text } = await generateText({ model, prompt, temperature: 0.8, maxTokens: 1200, abortSignal: AbortSignal.timeout(90_000) });
    const grounded = groundVariants(parseVariants(text), context.allowedIds);
    if (grounded.length === 0) throw new NotFoundException("重新生成失败，请重试");
    const v = grounded[0];
    await this.db.withClient(async (client) => {
      await client.query(
        `UPDATE content_variants
            SET angle = $2, hook = $3, body = $4, cta = $5, claim_ids = $6::jsonb, created_at = NOW()
          WHERE id = $1`,
        [variantId, v.angle, v.hook, v.body, v.cta, JSON.stringify(v.claimIds)],
      );
    });
    await this.evaluations.evaluateExistingVariant(userId, projectId, variantId, {
      angle: v.angle, hook: v.hook, body: v.body, cta: v.cta, claimIds: v.claimIds,
      platform: context.brief.platform ?? undefined, platformMaxLength: context.brief.maxLength ?? undefined,
    });
    return { regenerated: true, id: variantId };
  }

  /** campaign + 角度（每个角度带硬规则检查结果 + 去向，供并排比较） */
  async getCampaign(userId: string, projectId: string, campaignId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const row = await this.getCampaignRow(client, campaignId, projectId);
      const allClaims = await this.loadClaims(client, projectId);
      const claimsById = new Map(allClaims.map((c) => [c.id, c]));
      const platform = { maxLength: row.max_length ?? undefined };

      const { rows: variants } = await client.query<{
        id: string; source: string; angle: string; hook: string; body: string; cta: string;
        claim_ids: unknown; adopted: boolean; created_at: Date; evaluation_decision: string | null;
      }>(
        `SELECT v.id, v.source, v.angle, v.hook, v.body, v.cta, v.claim_ids, v.adopted, v.created_at,
                latest.decision AS evaluation_decision
           FROM content_variants v
           LEFT JOIN LATERAL (
             SELECT decision FROM content_evaluations e
              WHERE e.variant_id = v.id
              ORDER BY e.created_at DESC LIMIT 1
           ) latest ON true
          WHERE v.campaign_id = $1 ORDER BY v.source DESC, v.created_at ASC`,
        [campaignId],
      );

      const withGate = variants.map((v) => {
        const claimIds = Array.isArray(v.claim_ids) ? (v.claim_ids as string[]) : [];
        const gate = runDeterministicGate(
          { body: v.body, hook: v.hook, cta: v.cta, claimIds },
          { claimsById, platform },
        );
        return {
          id: v.id, source: v.source, angle: v.angle, hook: v.hook, body: v.body, cta: v.cta,
          claimIds, adopted: v.adopted, createdAt: v.created_at,
          gatePassed: gate.passed, gateFailures: gate.failures,
          decision: v.evaluation_decision ?? decide(gate, null),
        };
      });

      return { campaign: { ...row, allowed_claim_ids: this.mapCampaign(row).allowedClaimIds }, variants: withGate };
    });
  }

  /** 采纳/取消采纳一个角度（3.6：采纳=消费掉的最终产出，可导出） */
  async setAdopted(userId: string, projectId: string, campaignId: string, variantId: string, adopted: boolean) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE content_variants SET adopted = $4
          WHERE id = $1 AND campaign_id = $2 AND project_id = $3`,
        [variantId, campaignId, projectId, adopted],
      );
      if (rowCount === 0) throw new NotFoundException("角度不存在");
      return { adopted };
    });
  }

  async listCampaigns(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT id, goal, platform, cta, status, allowed_claim_ids, created_at FROM campaigns
          WHERE project_id = $1 ORDER BY created_at DESC`,
        [projectId],
      );
      return {
        campaigns: rows.map((row: Record<string, unknown>) => ({
          ...row,
          allowedClaimIds: Array.isArray(row.allowed_claim_ids) ? row.allowed_claim_ids : [],
        })),
      };
    });
  }

  /** 删除任务前先删候选；评估记录通过 variant 外键级联删除。 */
  async removeCampaign(userId: string, projectId: string, campaignId: string): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.db.withClient(async (client) => {
      await this.getCampaignRow(client, campaignId, projectId);
      await client.query(`DELETE FROM content_variants WHERE campaign_id = $1 AND project_id = $2`, [campaignId, projectId]);
      await client.query(`DELETE FROM campaigns WHERE id = $1 AND project_id = $2`, [campaignId, projectId]);
    });
  }
}
