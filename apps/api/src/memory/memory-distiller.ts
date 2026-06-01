/**
 * MemoryDistiller — feat-300.4
 *
 * 把 feedbacks → LLM 提炼 → upsert agent_memory 的闭环。
 *
 * 触发方式：
 *   1. 自动：@OnEvent('feedback.upserted')，累计 5 条新 feedback 触发一次
 *      "新" 的判定：feedback.updated_at > max(agent_memory.last_distilled_at)
 *      没有任何已蒸馏记录时基线为 epoch 0（首次即触发）
 *   2. 手动：POST /projects/:pid/memory/distill → distillProject(projectId, force=true)
 *
 * 单进程串行：项目级 in-memory Set<projectId> 防止同一项目并发蒸馏（事件 + 手动撞同时）。
 * 多实例部署时升级为分布式锁（Redis SETNX）即可，留 TODO 不阻塞 MVP。
 *
 * 为什么 edit_diff 是核心信号：
 *   评分 1-5 是粗粒度信号（只知道用户"觉得好不好"），edit_diff 是细粒度信号
 *   （知道用户"希望怎么改"）。蒸馏价值排序：edit_diff > 自由 comment > 评分。
 *   本服务在选 batch 时优先带 edit_diff 的 feedback。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { generateText } from "ai";
import type { Client as PgClient } from "pg";
import { DbService } from "../db/db.service";
import { LlmService } from "../llm/llm.service";
import { ProjectsService } from "../projects/projects.service";
import {
  FEEDBACK_EVENT,
  type FeedbackUpsertedEvent,
} from "../feedbacks/feedbacks.service";
import {
  memoryDistillPrompt,
  type DistillFeedbackItem,
  type DistilledResult,
} from "../agent/prompts/memory/distill.prompt";
import { MemoryService, type UpsertDistilledInput } from "./memory.service";
import { MEMORY_KINDS } from "./memory.types";

/** 多少条新 feedback 触发自动蒸馏 */
export const DISTILL_BATCH_THRESHOLD = 5;

/** 单次 distill 最多送 LLM 的 feedback 条数（防 prompt 过大） */
const MAX_FEEDBACKS_PER_DISTILL = 20;

interface RawFeedbackRow {
  id: string;
  query: string;
  result_notes: string | null;
  relevance: number | null;
  accuracy: number | null;
  creativity: number | null;
  overall: number | null;
  edit_diff: string | null;
  comment: string | null;
  updated_at: Date;
}

@Injectable()
export class MemoryDistiller {
  private readonly logger = new Logger(MemoryDistiller.name);

  /** 项目级蒸馏锁（in-memory 单进程版） */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: DbService,
    private readonly llm: LlmService,
    private readonly projects: ProjectsService,
    private readonly memory: MemoryService,
  ) {}

  /** 自动触发入口：收到 feedback.upserted 事件 */
  @OnEvent(FEEDBACK_EVENT.upserted, { async: true })
  async onFeedbackUpserted(evt: FeedbackUpsertedEvent): Promise<void> {
    try {
      await this.maybeDistill(evt.projectId);
    } catch (err) {
      // 事件订阅出错绝不冒泡到 feedback 提交链路
      this.logger.error(
        `[memory-distiller] onFeedbackUpserted failed project=${evt.projectId}: ${(err as Error).message}`,
      );
    }
  }

  /** 检查是否够 5 条新 feedback；够则触发 distill */
  async maybeDistill(projectId: string): Promise<{ triggered: boolean; reason?: string }> {
    const newCount = await this.countNewFeedbacks(projectId);
    if (newCount < DISTILL_BATCH_THRESHOLD) {
      return { triggered: false, reason: `仅 ${newCount}/${DISTILL_BATCH_THRESHOLD} 条新 feedback` };
    }
    await this.distillProject(projectId);
    return { triggered: true };
  }

  /** 手动触发入口（controller 用），含 owner 校验 */
  async distillForUser(
    userId: string,
    projectId: string,
  ): Promise<{ inserted: number; merged: number; processed: number; skipped?: string }> {
    // 用 ProjectsService.get 做 owner 校验（404 复用既有语义）
    await this.projects.get(userId, projectId);
    return this.distillProject(projectId);
  }

  /** 真正干活的函数；带项目级串行锁 */
  async distillProject(
    projectId: string,
  ): Promise<{ inserted: number; merged: number; processed: number; skipped?: string }> {
    if (this.inFlight.has(projectId)) {
      this.logger.warn(`[memory-distiller] 已在进行中，跳过 project=${projectId}`);
      return { inserted: 0, merged: 0, processed: 0, skipped: "in_flight" };
    }
    this.inFlight.add(projectId);
    try {
      return await this.runDistillInternal(projectId);
    } finally {
      this.inFlight.delete(projectId);
    }
  }

  private async runDistillInternal(
    projectId: string,
  ): Promise<{ inserted: number; merged: number; processed: number; skipped?: string }> {
    const batch = await this.loadBatch(projectId);
    if (batch.length === 0) {
      return { inserted: 0, merged: 0, processed: 0, skipped: "no_new_feedback" };
    }

    // 加载已有 memory 作为 LLM 上下文，避免重复蒸馏
    const existingMemory = await this.db.withClient(async (client) => {
      const { rows } = await client.query<{ kind: string; content: string }>(
        `SELECT kind, content FROM agent_memory WHERE project_id = $1`,
        [projectId],
      );
      return rows;
    });

    // 加载项目 LLM 配置；蒸馏走项目自带 BYOK key（与 agent 一致）
    // 自动触发链路没有 userId，直接查 project_settings 表（owner 校验在 controller 入口已做）
    const settings = await this.db.withClient(async (client) => {
      const { rows } = await client.query<{
        provider: string | null;
        encrypted_api_key: string | null;
        model: string | null;
      }>(
        `SELECT provider, encrypted_api_key, model
         FROM project_settings WHERE project_id = $1`,
        [projectId],
      );
      return rows[0] ?? null;
    });
    const llmModel = this.llm.create({
      provider: settings?.provider ?? null,
      apiKey: settings?.encrypted_api_key ?? null,
      model: settings?.model ?? null,
    });

    const prompt = memoryDistillPrompt.render({
      feedbacks: batch.map(toDistillItem),
      existingMemory,
    });

    const t0 = Date.now();
    const { text } = await generateText({
      model: llmModel,
      prompt,
      // distiller 期望事实/凝练，低温度
      temperature: 0.2,
      maxTokens: 1500,
    });
    const dt = Date.now() - t0;
    this.logger.log(
      `[memory-distiller] LLM done project=${projectId} batch=${batch.length} took=${dt}ms`,
    );

    const candidates = parseCandidates(text);
    if (candidates.length === 0) {
      // 即便 candidates 为空也要更新水位线，避免下次还是这批 feedback 反复触发
      await this.bumpWatermark(projectId);
      return { inserted: 0, merged: 0, processed: batch.length, skipped: "no_candidates" };
    }

    const result = await this.db.withClient(async (client) => {
      return this.memory.upsertDistilled(client, projectId, candidates);
    });

    await this.bumpWatermark(projectId);

    return { ...result, processed: batch.length };
  }

  /** 把 last_distilled_at 推到当前时间，作为下次 newCount 计算的水位 */
  private async bumpWatermark(projectId: string): Promise<void> {
    // 给所有 distilled 行都打上当前时间，作为水位线。空表时插入一条 sentinel 行
    // 更轻量：用 UPSERT pseudo 实现 — MVP 直接 update 所有 distilled 行。
    await this.db.withClient(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE agent_memory SET last_distilled_at = NOW()
         WHERE project_id = $1 AND source = 'distilled'`,
        [projectId],
      );
      if (rowCount === 0) {
        // 项目还没任何 distilled memory（LLM 说"无候选"且首次跑）。
        // 写一条 hidden sentinel 不合适 → 改在 manual 行也打水位
        await client.query(
          `UPDATE agent_memory SET last_distilled_at = NOW()
           WHERE project_id = $1`,
          [projectId],
        );
        // 如果项目连任何 memory 行都没有，下一次还会基于 epoch=0 重新触发，
        // 也算 OK：再跑一次 distill 也没什么副作用。
      }
    });
  }

  /** 统计"新 feedback"数量：feedbacks.updated_at > max(last_distilled_at) 的条数 */
  private async countNewFeedbacks(projectId: string): Promise<number> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `WITH wm AS (
           SELECT COALESCE(MAX(last_distilled_at), 'epoch'::timestamptz) AS t
           FROM agent_memory WHERE project_id = $1
         )
         SELECT COUNT(*)::text AS n
         FROM feedbacks f
         JOIN generations g ON g.id = f.generation_id
         CROSS JOIN wm
         WHERE g.project_id = $1 AND f.updated_at > wm.t`,
        [projectId],
      );
      return parseInt(rows[0]?.n ?? "0", 10);
    });
  }

  /** 取一批要送 LLM 的 feedback：优先含 edit_diff 的，按 updated_at DESC */
  private async loadBatch(projectId: string): Promise<RawFeedbackRow[]> {
    return this.db.withClient(async (client) => {
      const { rows } = await client.query<RawFeedbackRow>(
        `WITH wm AS (
           SELECT COALESCE(MAX(last_distilled_at), 'epoch'::timestamptz) AS t
           FROM agent_memory WHERE project_id = $1
         )
         SELECT f.id, g.query, g.result_notes,
                f.relevance, f.accuracy, f.creativity, f.overall,
                f.edit_diff, f.comment, f.updated_at
         FROM feedbacks f
         JOIN generations g ON g.id = f.generation_id
         CROSS JOIN wm
         WHERE g.project_id = $1 AND f.updated_at > wm.t
         ORDER BY (f.edit_diff IS NOT NULL) DESC, f.updated_at DESC
         LIMIT $2`,
        [projectId, MAX_FEEDBACKS_PER_DISTILL],
      );
      return rows;
    });
  }
}

function toDistillItem(r: RawFeedbackRow): DistillFeedbackItem {
  return {
    feedbackId: r.id,
    query: r.query,
    original: r.result_notes ?? "",
    editDiff: r.edit_diff,
    ratings: {
      relevance: r.relevance,
      accuracy: r.accuracy,
      creativity: r.creativity,
      overall: r.overall,
    },
    comment: r.comment,
  };
}

/**
 * 解析 LLM 输出。容错：
 *   - 允许 markdown 围栏 ```json ... ```（虽然 prompt 要求不要，但 LLM 偶尔不听）
 *   - 解析失败返回空数组，不抛错（蒸馏失败不应该让事件链炸）
 *   - 过滤非法 kind / confidence 越界 / 空 content
 */
function parseCandidates(text: string): UpsertDistilledInput[] {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: DistilledResult;
  try {
    parsed = JSON.parse(stripped) as DistilledResult;
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.candidates)) return [];

  const out: UpsertDistilledInput[] = [];
  for (const c of parsed.candidates) {
    if (!c || typeof c.content !== "string" || !c.content.trim()) continue;
    if (!MEMORY_KINDS.includes(c.kind)) continue;
    const conf = Number(c.confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) continue;
    const ids = Array.isArray(c.sourceFeedbackIds)
      ? c.sourceFeedbackIds.filter((s) => typeof s === "string")
      : [];
    out.push({
      kind: c.kind,
      content: c.content.trim(),
      confidence: conf,
      sourceFeedbackIds: ids,
    });
  }
  return out;
}
