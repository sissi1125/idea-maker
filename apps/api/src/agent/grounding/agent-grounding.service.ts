/**
 * AgentGroundingService —— 聚合 Product Brief、Approved Claims 与 RAG evidence。
 *
 * 这里是事实边界：auto-generation 摘要不参与聚合，因为它是模型派生产物，
 * 不能覆盖 Product Brief 的确认状态。下游 outer Agent 与 nested tool 共用同一对象。
 */
import { Injectable, Logger } from "@nestjs/common";
import type { DbClient as PgClient } from "../../db/db-client";
import { ClaimsService } from "../../claims/claims.service";
import { ProductBriefService } from "../../product-brief/product-brief.service";
import type { PlatformRuleRow } from "../../platform-rules/platform-rules.types";
import {
  emptyAgentGroundingContext,
  type AgentGroundingContext,
  type GroundingEvidenceChunk,
} from "./agent-grounding.types";

@Injectable()
export class AgentGroundingService {
  private readonly logger = new Logger(AgentGroundingService.name);

  constructor(
    private readonly briefs: ProductBriefService,
    private readonly claims: ClaimsService,
  ) {}

  /**
   * 一次性加载 run 的只读事实上下文。
   * Brief 未整体确认时返回空事实，但仍保留平台规则，让“信息不足”提示也遵守平台约束。
   */
  async load(
    client: PgClient,
    projectId: string,
    platformRules: PlatformRuleRow[],
  ): Promise<AgentGroundingContext> {
    const confirmed = await this.briefs.getConfirmedBriefContext(client, projectId);
    if (!confirmed) return emptyAgentGroundingContext(platformRules);

    const approvedClaims = await this.claims.listApprovedWithClient(client, projectId);
    const evidenceIds = new Set<string>();
    for (const field of confirmed.fields) {
      for (const id of field.evidence_chunk_ids) evidenceIds.add(id);
    }
    for (const claim of approvedClaims) {
      for (const id of claim.evidence_chunk_ids) evidenceIds.add(id);
    }

    const evidenceChunks = await this.loadEvidenceChunks(client, projectId, [...evidenceIds]);
    return {
      briefId: confirmed.brief.id,
      briefVersion: confirmed.brief.version,
      confirmedFields: confirmed.fields.map((field) => ({
        id: field.id,
        group: field.field_group,
        key: field.field_key,
        value: field.value,
        source: field.source,
        evidenceChunkIds: field.evidence_chunk_ids,
      })),
      approvedClaims: approvedClaims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        claimType: claim.claim_type,
        sourceFieldId: claim.source_field_id,
        evidenceChunkIds: claim.evidence_chunk_ids,
      })),
      evidenceChunks,
      platformRules,
    };
  }

  /** 同时读取上传文档与官网 chunk；找不到的历史 evidence ID 只告警，不伪造文本。 */
  private async loadEvidenceChunks(
    client: PgClient,
    projectId: string,
    ids: string[],
  ): Promise<GroundingEvidenceChunk[]> {
    if (ids.length === 0) return [];
    const { rows } = await client.query<GroundingEvidenceChunk>(
      `SELECT DISTINCT ON (id) id, text
         FROM (
           SELECT id, text FROM rag_chunks
            WHERE project_id = $1 AND id = ANY($2::text[])
           UNION ALL
           SELECT id, text FROM source_content_chunks
            WHERE project_id = $1 AND id = ANY($2::text[])
         ) AS grounding_evidence
        ORDER BY id`,
      [projectId, ids],
    );
    if (rows.length !== ids.length) {
      this.logger.warn(
        `[agent-grounding] ${ids.length - rows.length} 个 evidence chunk 已删除或不可读 projectId=${projectId}`,
      );
    }
    return rows;
  }
}
