/**
 * MemoryReader — feat-300.3 任务 3
 *
 * 读 agent_memory 表，按 confidence 阈值过滤，按 kind 分组返回供 system prompt 注入。
 *
 * 范围（与 feat-300.4 的分工）：
 *   - 本期：只读。AgentRunner 启动 run 时 load(projectId) 注入 system prompt。
 *   - feat-300.4：写。MemoryDistiller 把 feedbacks → memory，会反复 INSERT/UPDATE
 *     agent_memory 表。
 *
 * **为什么按 confidence 过滤**（见 PromptDefinition 注释 + plan §3 ④）：
 *   confidence < 阈值（默认 0.5）的偏好是"未印证的早期推断"，注入会让 agent
 *   按未来可能撤销的规则行为，影响一致性。等多条 feedback 印证后才注入。
 *
 * **为什么不用 withClient 取连接**：
 *   AgentRunner 自己持有 pgClient 跑整个 run（feat-300.3 plan §3.6 决策），
 *   MemoryReader.load 接 pgClient 作为参数。这样测试可以注入 mock pg。
 *   如果换成 withClient，run 中间需要的临时连接会被 DB pool 抢占（占用 → 归还 →
 *   重新借 = 比共享一个连接更耗资源）。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { DbClient as PgClient } from "../db/db-client";
import type { MemoryEntry, MemoryKind } from "./prompts/system/memory-injection.prompt";

/** 注入阈值。低于此置信度的偏好不进 system prompt，避免误导 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

interface MemoryRow {
  kind: string;
  content: string;
  confidence: number;
}

@Injectable()
export class MemoryReader {
  private readonly logger = new Logger(MemoryReader.name);

  /**
   * 读取项目的偏好列表。
   *
   * @param pgClient 已 connect 的 client；通常 AgentRunner 把自己的 client 传进来
   * @param projectId 项目 UUID
   * @param confidenceThreshold 默认 0.5，可调
   */
  async load(
    pgClient: PgClient,
    projectId: string,
    confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
  ): Promise<MemoryEntry[]> {
    const { rows } = await pgClient.query<MemoryRow>(
      `SELECT kind, content, confidence
       FROM agent_memory
       WHERE project_id = $1
         AND confidence >= $2
       ORDER BY confidence DESC, updated_at DESC`,
      [projectId, confidenceThreshold],
    );

    // DB 的 kind 值受 CHECK 约束，理论上必然是 4 个合法值之一；这里再校验一次
    // 防御异常数据（如手动 INSERT 时绕过 CHECK 的边界）
    return rows
      .filter((r) => isMemoryKind(r.kind))
      .map<MemoryEntry>((r) => ({
        kind: r.kind as MemoryKind,
        content: r.content,
        confidence: Number(r.confidence),
      }));
  }
}

function isMemoryKind(value: string): value is MemoryKind {
  return value === "preference" || value === "style" || value === "taboo" || value === "audience";
}
