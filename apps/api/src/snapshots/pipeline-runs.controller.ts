/**
 * PipelineRunsController — /pipeline-runs
 *
 *   POST /pipeline-runs         保存一次完整 pipeline run
 *   GET  /pipeline-runs         列出 runs（不含 stages 数据）
 *   GET  /pipeline-runs/:id     取单条 run 详情
 *
 * 未配置 DATABASE_URL：
 *   - POST → 400 no_database_url
 *   - GET  → 空数组
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  SnapshotsService,
  unwrapError,
  type PipelineRunStageEntry,
} from "./snapshots.service";
import { ProvidersService } from "../pipeline/providers.service";
import { PipelineError } from "@harness/rag-core";

interface CreateRunBody {
  name?: string;
  documentId?: string;
  stages: Record<string, PipelineRunStageEntry>;
  connectionString?: string;
}

@ApiTags("pipeline-runs")
@Controller("pipeline-runs")
export class PipelineRunsController {
  constructor(
    private readonly snapshots: SnapshotsService,
    private readonly providers: ProvidersService,
  ) {}

  @Post()
  @HttpCode(200)
  async create(@Body() body: CreateRunBody) {
    const cs = this.snapshots.resolveConnectionString(body.connectionString);
    if (!cs) throw new PipelineError("missing_connection", "未配置 DATABASE_URL");

    const client = this.providers.createPgClient(cs);
    try {
      await client.connect();
      await this.snapshots.init(client);

      // 自动命名：未提供 name 时按当前 run 总数 +1
      let name = body.name?.trim();
      if (!name) {
        const countRes = await client.query<{ cnt: string }>(
          "SELECT COUNT(*) AS cnt FROM pipeline_run_history",
        );
        name = `Run #${parseInt(countRes.rows[0].cnt, 10) + 1}`;
      }

      const id = `run-${Date.now()}`;
      const stageCount = Object.keys(body.stages).length;
      await this.snapshots.insertPipelineRun(client, {
        id,
        name,
        documentId: body.documentId,
        stages: body.stages,
        stageCount,
      });
      return { ok: true, id, name };
    } catch (err) {
      throw new PipelineError("provider_error", unwrapError(err));
    } finally {
      await client.end().catch(() => {});
    }
  }

  @Get()
  async list(@Query("connectionString") cs?: string) {
    const resolved = this.snapshots.resolveConnectionString(cs);
    if (!resolved) return { runs: [] };

    const client = this.providers.createPgClient(resolved);
    try {
      await client.connect();
      await this.snapshots.init(client);
      const runs = await this.snapshots.listPipelineRuns(client);
      return { runs };
    } catch (err) {
      return { runs: [], error: unwrapError(err) };
    } finally {
      await client.end().catch(() => {});
    }
  }

  @Get(":id")
  async getOne(@Param("id") id: string, @Query("connectionString") cs?: string) {
    const resolved = this.snapshots.resolveConnectionString(cs);
    if (!resolved) return { run: null };

    const client = this.providers.createPgClient(resolved);
    try {
      await client.connect();
      await this.snapshots.init(client);
      const run = await this.snapshots.getPipelineRun(client, id);
      return { run };
    } catch (err) {
      return { run: null, error: unwrapError(err) };
    } finally {
      await client.end().catch(() => {});
    }
  }
}
