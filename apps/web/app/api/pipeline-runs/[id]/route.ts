import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { initSnapshotTables, getPipelineRun, resolveConnectionString, unwrapError } from "@/lib/snapshotDb";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cs = resolveConnectionString(
    req.nextUrl.searchParams.get("connectionString") ?? undefined
  );
  if (!cs) return NextResponse.json({ run: null });

  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    await initSnapshotTables(client);
    const run = await getPipelineRun(client, id);
    await client.end();
    return NextResponse.json({ run });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ run: null, error: unwrapError(err) });
  }
}
