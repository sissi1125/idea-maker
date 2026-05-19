/**
 * Stage 快照 API — POST /api/snapshots
 *
 * 作用：接收各 Stage 的执行结果（参数、上游产物、输出、耗时），
 *       保存到 PostgreSQL stage_snapshots 表以支持快照回放。
 *
 * 请求体：
 * {
 *   stageId: string;              // 所属 stage ID
 *   methodId: string;             // 使用的 method ID（如 pgvector-upsert-version）
 *   params: Record<string, unknown>;      // 该 stage 的参数副本
 *   upstreamOutput: unknown | null;       // 上一 stage 的输出（可能为 null）
 *   output: unknown;              // 本 stage 的输出
 *   durationMs: number;           // 执行耗时（毫秒）
 *   connectionString?: string;    // 可选，覆盖环境变量 DATABASE_URL
 * }
 *
 * 响应：
 * - { ok: true, id: string }                 成功保存
 * - { ok: false, reason: "no_database_url" } 未配置数据库（静默，不阻断流程）
 * - { ok: false, reason: string }            数据库错误
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { initSnapshotTables, upsertStageSnapshot, resolveConnectionString, unwrapError } from "@/lib/snapshotDb";

export async function POST(req: NextRequest) {
  let body: {
    stageId: string;
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: unknown | null;
    output: unknown;
    durationMs: number;
    connectionString?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  const cs = resolveConnectionString(body.connectionString);
  if (!cs) {
    // 未配置数据库时静默返回 ok（不阻断主流程）
    return NextResponse.json({ ok: false, reason: "no_database_url" });
  }

  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    await initSnapshotTables(client);
    const id = `${body.stageId}-${Date.now()}`;
    await upsertStageSnapshot(client, {
      id,
      stageId: body.stageId,
      methodId: body.methodId,
      params: body.params,
      upstreamOutput: body.upstreamOutput,
      output: body.output,
      durationMs: body.durationMs,
    });
    await client.end();
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ ok: false, reason: unwrapError(err) });
  }
}
