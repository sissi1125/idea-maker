/**
 * SnapshotsController — /snapshots
 *
 *   GET  /snapshots               列出所有 stage 的最新快照（页面 mount 用）
 *   POST /snapshots               upsert 单个 stage 快照
 *   GET  /snapshots/:stageId      取单个 stage 最新快照
 *
 * 注意：未配置 DATABASE_URL 时返回空数据 + ok:false，不抛错（保持与 Next.js 行为一致）。
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SnapshotsService, unwrapError } from "./snapshots.service";
import { ProvidersService } from "../pipeline/providers.service";

interface UpsertSnapshotBody {
  stageId: string;
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: unknown | null;
  output: unknown;
  durationMs: number;
  connectionString?: string;
}

@ApiTags("snapshots")
@Controller("snapshots")
export class SnapshotsController {
  constructor(
    private readonly snapshots: SnapshotsService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  async listAll(@Query("connectionString") cs?: string) {
    const resolved = this.snapshots.resolveConnectionString(cs);
    if (!resolved) return { snapshots: [] };

    const client = this.providers.createPgClient(resolved);
    try {
      await client.connect();
      await this.snapshots.init(client);
      const rows = await this.snapshots.listAllSnapshots(client);
      return { snapshots: rows };
    } catch (err) {
      return { snapshots: [], error: unwrapError(err) };
    } finally {
      await client.end().catch(() => {});
    }
  }

  @Post()
  @HttpCode(200)
  async upsert(@Body() body: UpsertSnapshotBody) {
    const cs = this.snapshots.resolveConnectionString(body.connectionString);
    if (!cs) return { ok: false, reason: "no_database_url" };

    const client = this.providers.createPgClient(cs);
    try {
      await client.connect();
      await this.snapshots.init(client);
      const id = `${body.stageId}-${Date.now()}`;
      await this.snapshots.upsertStageSnapshot(client, {
        id,
        stageId: body.stageId,
        methodId: body.methodId,
        params: body.params,
        upstreamOutput: body.upstreamOutput,
        output: body.output,
        durationMs: body.durationMs,
      });
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: unwrapError(err) };
    } finally {
      await client.end().catch(() => {});
    }
  }

  @Get(":stageId")
  async getOne(@Param("stageId") stageId: string, @Query("connectionString") cs?: string) {
    const resolved = this.snapshots.resolveConnectionString(cs);
    if (!resolved) return { snapshot: null };

    const client = this.providers.createPgClient(resolved);
    try {
      await client.connect();
      await this.snapshots.init(client);
      const snapshot = await this.snapshots.getLatestStageSnapshot(client, stageId);
      return { snapshot };
    } catch (err) {
      return { snapshot: null, error: unwrapError(err) };
    } finally {
      await client.end().catch(() => {});
    }
  }
}
