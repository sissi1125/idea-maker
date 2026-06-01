/**
 * EvalService — feat-300.5
 *
 * 包装非 runner 类的 eval 能力：
 *   - promoteFeedbackToGolden：把一条高质量 feedback 转成 golden item，写入 golden/ 目录
 *   - listRecentRuns / getRun：REST GET 端点用
 *
 * 写文件而不是入库的理由（见 golden-loader.ts）：
 *   golden 应当 git 跟踪，通过 PR 审查。写入目录后开发要 `git add` 才生效，
 *   这是「半自动」语义——服务负责生成草稿，人类负责接受/拒绝。
 *
 * 安全：
 *   - 写文件前严格白名单 path：必须落在 DEFAULT_GOLDEN_DIR 之下
 *   - 文件名由 service 控制（基于 generationId hash），不接受用户传入
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { DbService } from "../db/db.service";
import { ProjectsService } from "../projects/projects.service";
import { DEFAULT_GOLDEN_DIR } from "./golden-loader";
import { EvalRepository, type EvalRunRowLite } from "./eval.repository";
import type { GoldenItem } from "./eval.types";
import type { AgentToolName } from "../agent/tools/types";

interface PromoteCandidateRow {
  generation_id: string;
  project_id: string;
  query: string;
  result_notes: string | null;
  edit_diff: string | null;
  overall: number | null;
  feedback_id: string;
  expected_tools: string[] | null;
}

@Injectable()
export class EvalService {
  private readonly logger = new Logger(EvalService.name);

  constructor(
    private readonly db: DbService,
    private readonly projects: ProjectsService,
    private readonly repo: EvalRepository,
  ) {}

  async listRecentRuns(userId: string, projectId: string, limit = 20): Promise<EvalRunRowLite[]> {
    await this.projects.get(userId, projectId);
    return this.db.withClient((client) => this.repo.listRecentByProject(client, projectId, limit));
  }

  async getRun(userId: string, projectId: string, runId: string): Promise<EvalRunRowLite> {
    await this.projects.get(userId, projectId);
    const row = await this.db.withClient((client) => this.repo.getRun(client, runId));
    if (!row || row.projectId !== projectId) throw new NotFoundException("eval run 不存在");
    return row;
  }

  /**
   * 把一条 feedback 升级成 golden item。
   *
   * 资格门槛（service 强制）：
   *   - overall >= 4（高分项才值得入回归集）
   *   - 必须有 result_notes（否则没东西做 referenceAnswer）
   *   - 优先用 edit_diff 作为 referenceAnswer（用户改写后的版本通常比原始 LLM 输出更接近"理想"）
   *
   * expectedTools 推断：从该 generation 关联的 agent_run.agent_steps 抽 tool_call。
   *   若 generation 走的是老 pipeline（agent_run_id IS NULL），expectedTools = []
   *   表示"不关心路径只看输出"。
   *
   * 返回新 golden item + 落盘路径。
   */
  async promoteFeedbackToGolden(
    userId: string,
    projectId: string,
    generationId: string,
  ): Promise<{ item: GoldenItem; filePath: string }> {
    await this.projects.get(userId, projectId);

    const candidate = await this.db.withClient(async (client) => {
      const { rows } = await client.query<PromoteCandidateRow>(
        `SELECT g.id AS generation_id,
                g.project_id,
                g.query,
                g.result_notes,
                f.id AS feedback_id,
                f.edit_diff,
                f.overall,
                (
                  SELECT array_agg(s.tool_name)
                  FROM agent_steps s
                  WHERE s.run_id = g.agent_run_id
                    AND s.step_type = 'tool_call'
                    AND s.tool_name IS NOT NULL
                ) AS expected_tools
         FROM generations g
         JOIN feedbacks f ON f.generation_id = g.id
         WHERE g.id = $1 AND g.project_id = $2`,
        [generationId, projectId],
      );
      return rows[0] ?? null;
    });

    if (!candidate) throw new NotFoundException("generation 或 feedback 不存在");
    if ((candidate.overall ?? 0) < 4) {
      throw new BadRequestException("仅 overall >= 4 的 feedback 可入 golden");
    }
    const reference = candidate.edit_diff?.trim() || candidate.result_notes?.trim();
    if (!reference) throw new BadRequestException("无 result_notes / edit_diff，无法作为 reference");

    // expected tools 去重 + 限制类型
    const expectedTools = Array.from(new Set(candidate.expected_tools ?? [])) as AgentToolName[];

    // golden id：稳定可读 + 防冲突
    const goldenId = `gold-fb-${candidate.feedback_id.slice(0, 8)}`;
    const item: GoldenItem = {
      id: goldenId,
      query: candidate.query,
      expectedTools,
      referenceAnswer: reference,
      thresholds: { faithfulness: 3, completeness: 3, style: 3 },
      meta: {
        source: "from-feedback",
        sourceFeedbackId: candidate.feedback_id,
        tags: ["promoted"],
      },
    };

    const filePath = join(DEFAULT_GOLDEN_DIR, `${goldenId}.json`);

    // 防越权写盘：解析后必须在 DEFAULT_GOLDEN_DIR 子树内（防 goldenId 含 ../）
    if (!resolve(filePath).startsWith(resolve(DEFAULT_GOLDEN_DIR))) {
      throw new BadRequestException("非法 golden 路径");
    }
    if (existsSync(filePath)) {
      throw new BadRequestException(`golden ${goldenId} 已存在，请人工合并而非覆盖`);
    }
    writeFileSync(filePath, JSON.stringify(item, null, 2), "utf-8");
    this.logger.log(`[eval] feedback ${candidate.feedback_id} → golden ${goldenId}`);

    return { item, filePath };
  }
}
