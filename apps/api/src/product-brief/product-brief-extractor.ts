/**
 * ProductBriefExtractor — feat-400.1 slice 2
 *
 * 从项目已 ingest 的文档 chunks 里，用 LLM 提取 Product Brief 的候选事实字段。
 *
 * 关键规则（事实门禁从提取就开始）：
 *   1. 提取只产出 status='candidate'，永不自动 confirmed —— 交给用户在工作台确认。
 *   2. 每个候选字段必须带 evidenceChunkIds（出处），且只保留"真实存在于本次输入 chunks"
 *      的 id —— LLM 若编了不存在的 chunk id，直接丢弃（防幻觉出处）。
 *   3. 有 evidence → source='document'；无 evidence → source='inferred' 且置信度压低，
 *      对应"模型推断不能自动成为事实"，会在 detectIssues 里被标为 unverifiedFacts。
 *   4. 只提取事实型分组（identity/fact/audience/positioning）；style/visual/constraint
 *      来自用户设置与历史内容，不从产品文档里"猜"。
 *
 * 上下文预算：一次喂给 LLM 的 chunk 文本有字符上限（防爆窗）。超出则截断并返回 truncated=true，
 *   map-reduce 式全量提取留作后续优化。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { generateText } from "ai";
import { z } from "zod";
import { DbService } from "../db/db.service";
import { LlmService } from "../llm/llm.service";
import { ProductBriefService } from "./product-brief.service";
import { BRIEF_FIELD_GROUPS, FACTUAL_FIELD_GROUPS, type BriefFieldGroup } from "./product-brief.types";

/** 一次喂给 LLM 的 chunk 文本字符上限（约 8k token 量级，留足输出空间） */
const MAX_INPUT_CHARS = 24_000;
/** 单个 chunk 过长时截断，避免一个大 chunk 吃满预算 */
const MAX_CHARS_PER_CHUNK = 1_200;

interface ProjectChunk {
  id: string;
  text: string;
  /** 来源：文档（rag_chunks）还是官网（source_content_chunks）—— 决定候选字段的 source */
  origin: "document" | "website";
}

/** LLM 输出的单条候选字段（Zod 校验后的形状） */
const ExtractedFieldSchema = z.object({
  group: z.enum(BRIEF_FIELD_GROUPS),
  key: z.string().min(1).max(200),
  // value 允许字符串或字符串数组（如 features 列表），统一按 JSON 存
  value: z.union([z.string(), z.array(z.string()), z.null()]),
  evidenceChunkIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
const ExtractionSchema = z.object({
  fields: z.array(ExtractedFieldSchema).default([]),
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

export interface ExtractResult {
  extracted: number;
  chunkCount: number;
  truncated: boolean;
  fields: Array<{ group: BriefFieldGroup; key: string; source: string; evidenceCount: number }>;
}

@Injectable()
export class ProductBriefExtractor {
  private readonly logger = new Logger(ProductBriefExtractor.name);

  constructor(
    private readonly db: DbService,
    private readonly llm: LlmService,
    private readonly briefs: ProductBriefService,
  ) {}

  /** owner 校验（与其他 service 一致语义） */
  private async assertOwner(userId: string, projectId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
        [projectId, userId],
      );
      if (rows.length === 0) throw new NotFoundException("项目不存在");
    });
  }

  /**
   * 读取项目全部 chunk（id + text + origin）：
   *   - 文档：rag_chunks（origin=document）
   *   - 官网：source_content_chunks（origin=website，来自受限官网导入）
   * origin 决定候选字段的 source，让"这条事实来自文档还是官网"可追溯。
   */
  async loadProjectChunks(projectId: string): Promise<ProjectChunk[]> {
    return this.db.withClient(async (client) => {
      const { rows: docRows } = await client.query<{ id: string; text: string }>(
        `SELECT id, text FROM rag_chunks
          WHERE project_id = $1 AND text IS NOT NULL
          ORDER BY document_id ASC, chunk_index ASC`,
        [projectId],
      );
      const { rows: webRows } = await client.query<{ id: string; text: string }>(
        `SELECT id, text FROM source_content_chunks
          WHERE project_id = $1 AND text IS NOT NULL
          ORDER BY page_id ASC, chunk_index ASC`,
        [projectId],
      );
      return [
        ...docRows.map((r) => ({ id: r.id, text: r.text ?? "", origin: "document" as const })),
        ...webRows.map((r) => ({ id: r.id, text: r.text ?? "", origin: "website" as const })),
      ];
    });
  }

  /** 加载项目 BYOK LLM 配置（与 memory-distiller 一致：直接查 project_settings） */
  private async resolveLlmModel(projectId: string) {
    const settings = await this.db.withClient(async (client) => {
      const { rows } = await client.query<{
        provider: string | null;
        encrypted_api_key: string | null;
        model: string | null;
      }>(
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
   * 把 chunks 拼成带 id 标注的输入块，受字符预算约束。
   * 返回 { block, usedIds, truncated } —— usedIds 用于事后校验 LLM 引用的 evidence 是否真实存在。
   */
  buildInputBlock(chunks: ProjectChunk[]): { block: string; usedIds: Set<string>; truncated: boolean } {
    const parts: string[] = [];
    const usedIds = new Set<string>();
    let total = 0;
    let truncated = false;
    for (const c of chunks) {
      const text = c.text.slice(0, MAX_CHARS_PER_CHUNK).replace(/\s+/g, " ").trim();
      if (!text) continue;
      const piece = `[chunk_id: ${c.id}] ${text}`;
      if (total + piece.length > MAX_INPUT_CHARS) {
        truncated = true;
        break;
      }
      parts.push(piece);
      usedIds.add(c.id);
      total += piece.length;
    }
    return { block: parts.join("\n\n"), usedIds, truncated };
  }

  /** 提取 prompt。约束 LLM：只输出 JSON、只提取有依据的事实、引用 chunk_id 作为出处。 */
  buildPrompt(inputBlock: string): string {
    return [
      "你是产品资料分析助手。下面是某产品的资料片段，每段以 [chunk_id: xxx] 开头标注出处。",
      "请从中提取「产品事实档案」的候选字段，只提取资料明确支持的内容，不要编造。",
      "",
      "字段分组与建议 key（只提取事实型分组）：",
      "- identity（产品身份）：name, one_liner, category, website",
      "- fact（产品事实）：features, pricing, supported_platforms, limitations, version",
      "- audience（用户与场景）：target_users, scenarios, pain_points",
      "- positioning（定位与差异化）：core_value, differentiation, competitors",
      "",
      "输出规则：",
      "1. 只输出 JSON，形如 {\"fields\":[{\"group\":\"identity\",\"key\":\"name\",\"value\":\"...\",\"evidenceChunkIds\":[\"chunk_id\"],\"confidence\":0.9}]}。",
      "2. value 用字符串；如果是并列列表（如 features）可用字符串数组。",
      "3. evidenceChunkIds 必须是上面出现过的真实 chunk_id，作为该事实的出处。",
      "4. 只有资料直接支撑的事实才给高 confidence；纯推断的给低 confidence 且 evidenceChunkIds 留空。",
      "5. 拿不准或资料没提到的字段，不要输出（宁缺毋滥）。",
      "",
      "产品资料：",
      inputBlock,
    ].join("\n");
  }

  /** 从 LLM 原始文本里解析 + Zod 校验候选字段，剥掉 ```json fence */
  parseFields(text: string): ExtractedField[] {
    const stripped = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    let json: unknown;
    try {
      json = JSON.parse(stripped);
    } catch {
      // 容错：尝试截取第一个 { 到最后一个 }
      const s = stripped.indexOf("{");
      const e = stripped.lastIndexOf("}");
      if (s === -1 || e === -1) return [];
      try {
        json = JSON.parse(stripped.slice(s, e + 1));
      } catch {
        return [];
      }
    }
    // 真实模型（如 glm-4-flash）常把结果多包一层数组：[{fields:[...]}] 或直接 [ ...字段对象 ]。
    // 统一拆包回 { fields: [...] }，否则 Zod 直接判空（这个 bug 只有真模型输出才暴露）。
    if (Array.isArray(json)) {
      const arr = json as unknown[];
      json = arr.length && arr[0] && typeof arr[0] === "object" && "fields" in (arr[0] as object)
        ? { fields: arr.flatMap((o) => (o as { fields?: unknown[] }).fields ?? []) }
        : { fields: arr };
    }
    const parsed = ExtractionSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(`[extractor] Zod 校验失败：${parsed.error.message.slice(0, 200)}`);
      return [];
    }
    return parsed.data.fields;
  }

  /**
   * 净化 LLM 输出：
   *   - 只保留事实型分组（防 LLM 越界产出 style/constraint）
   *   - evidence 只保留真实存在于本次输入的 chunk id（丢弃幻觉出处）
   *   - 决定 source：有真实 evidence → document；否则 inferred
   *   - 无 evidence 的推断字段置信度封顶 0.4，避免"高置信幻觉"
   */
  sanitize(
    fields: ExtractedField[],
    validIds: Set<string>,
    originById: Map<string, "document" | "website">,
  ): Array<{ group: BriefFieldGroup; key: string; value: unknown; source: "document" | "website" | "inferred"; evidenceChunkIds: string[]; confidence: number }> {
    const out = [];
    for (const f of fields) {
      if (!FACTUAL_FIELD_GROUPS.includes(f.group)) continue;
      const evidence = (f.evidenceChunkIds ?? []).filter((id) => validIds.has(id));
      const hasEvidence = evidence.length > 0;
      // 有出处 → 按出处 chunk 的 origin 定 source（文档/官网）；无出处 → inferred
      const source = hasEvidence ? (originById.get(evidence[0]) ?? "document") : ("inferred" as const);
      const confidence = hasEvidence ? f.confidence : Math.min(f.confidence, 0.4);
      out.push({
        group: f.group,
        key: f.key.trim(),
        value: f.value,
        source,
        evidenceChunkIds: evidence,
        confidence,
      });
    }
    return out;
  }

  /** 端到端：加载 chunks → LLM 提取 → 净化 → upsert candidate 字段 */
  async extract(userId: string, projectId: string): Promise<ExtractResult> {
    await this.assertOwner(userId, projectId);
    const chunks = await this.loadProjectChunks(projectId);
    if (chunks.length === 0) {
      throw new NotFoundException("项目还没有已处理的文档，请先上传并完成 ingestion");
    }

    const { block, usedIds, truncated } = this.buildInputBlock(chunks);
    const originById = new Map(chunks.map((c) => [c.id, c.origin]));
    const model = await this.resolveLlmModel(projectId);

    const t0 = Date.now();
    const { text } = await generateText({
      model,
      prompt: this.buildPrompt(block),
      temperature: 0.2,
      maxTokens: 2000,
    });
    this.logger.log(
      `[extractor] LLM done project=${projectId} chunks=${usedIds.size}/${chunks.length} took=${Date.now() - t0}ms`,
    );

    const clean = this.sanitize(this.parseFields(text), usedIds, originById);

    // 逐条 upsert 为 candidate（命中已确认字段只会标 stale，不覆盖）
    const written: ExtractResult["fields"] = [];
    await this.db.withClient(async (client) => {
      const brief = await this.briefs.ensureBrief(client, projectId);
      for (const f of clean) {
        await this.briefs.upsertCandidateField(client, brief.id, {
          group: f.group,
          key: f.key,
          value: f.value,
          source: f.source,
          evidenceChunkIds: f.evidenceChunkIds,
          confidence: f.confidence,
        });
        written.push({ group: f.group, key: f.key, source: f.source, evidenceCount: f.evidenceChunkIds.length });
      }
    });

    return { extracted: written.length, chunkCount: chunks.length, truncated, fields: written };
  }
}
