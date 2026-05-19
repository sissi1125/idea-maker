import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { initSnapshotTables, insertPipelineRun, listPipelineRuns, resolveConnectionString, unwrapError } from "@/lib/snapshotDb";
import type { PipelineRunStageEntry } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    documentId?: string;
    stages: Record<string, PipelineRunStageEntry>;
    connectionString?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

  const cs = resolveConnectionString(body.connectionString);
  if (!cs) return NextResponse.json({ error: { code: "no_database_url", message: "未配置 DATABASE_URL" } }, { status: 400 });

  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    await initSnapshotTables(client);

    // 自动命名：查当前最大序号
    let name = body.name?.trim();
    if (!name) {
      const countRes = await client.query<{ cnt: string }>("SELECT COUNT(*) AS cnt FROM pipeline_run_history");
      name = `Run #${parseInt(countRes.rows[0].cnt, 10) + 1}`;
    }

    const id = `run-${Date.now()}`;
    const stageCount = Object.keys(body.stages).length;
    await insertPipelineRun(client, {
      id, name, documentId: body.documentId,
      stages: body.stages, stageCount,
    });
    await client.end();
    return NextResponse.json({ ok: true, id, name });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ error: { code: "db_error", message: unwrapError(err) } }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const cs = resolveConnectionString(
    req.nextUrl.searchParams.get("connectionString") ?? undefined
  );
  if (!cs) return NextResponse.json({ runs: [] });

  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    await initSnapshotTables(client);
    const runs = await listPipelineRuns(client);
    await client.end();
    return NextResponse.json({ runs });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ runs: [], error: unwrapError(err) });
  }
}
