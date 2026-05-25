/**
 * Stage 快照 API — GET /api/snapshots/[stageId]
 *
 * 作用：获取某个 stage 最新的快照数据，用于快照回放和调试。
 *
 * 查询参数：
 * - connectionString?: string     可选，覆盖环境变量 DATABASE_URL
 *
 * 响应：
 * - { snapshot: StageSnapshot }   成功获取快照
 * - { snapshot: null }            stage 无快照或数据库未配置
 * - { snapshot: null, error: ... } 数据库查询错误
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { initSnapshotTables, getLatestStageSnapshot, resolveConnectionString, unwrapError } from "@/lib/snapshotDb";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stageId: string }> }
) {
  const { stageId } = await params;
  const cs = resolveConnectionString(
    req.nextUrl.searchParams.get("connectionString") ?? undefined
  );
  if (!cs) return NextResponse.json({ snapshot: null });

  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    await initSnapshotTables(client);
    const snapshot = await getLatestStageSnapshot(client, stageId);
    await client.end();
    return NextResponse.json({ snapshot });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ snapshot: null, error: unwrapError(err) });
  }
}
