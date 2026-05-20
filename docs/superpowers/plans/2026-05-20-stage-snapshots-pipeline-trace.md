# Stage 快照持久化 + Pipeline 全链路追踪面板 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 每个 stage 成功运行后自动保存快照到 PostgreSQL，允许用户注入快照作为上游输入（无需重跑上游 stage）；同时新增底部抽屉面板展示当前 pipeline 全链路状态和历史 run 记录。

**架构：** 新增两张 PostgreSQL 表（`stage_snapshots` / `pipeline_run_history`）和 4 个 API 路由处理快照读写。前端通过 `PlaygroundShell` 的 `snapshotUpstreamMap` state 注入快照上游，`StageConfigPanel` 展示快照栏，新增 `PipelineTraceDrawer` 组件作为底部抽屉。`JsonView` / `truncateStrings` / `VectorSummary` 先提取为共享模块供两处复用。

**技术栈：** Next.js App Router API Routes、PostgreSQL (pg)、React useState/useEffect、TypeScript、Tailwind CSS

---

## 文件清单

### 新建
| 文件 | 职责 |
|------|------|
| `app/lib/snapshotDb.ts` | PostgreSQL DDL 初始化 + snapshot/pipeline-run CRUD 函数 |
| `app/components/playground/JsonView.tsx` | 从 OutputTracePanel 提取：JsonView、truncateStrings、VectorSummary、vectorReplacer |
| `app/app/api/snapshots/route.ts` | POST upsert stage snapshot |
| `app/app/api/snapshots/[stageId]/route.ts` | GET latest snapshot for a stage |
| `app/app/api/pipeline-runs/route.ts` | POST save pipeline run + GET list |
| `app/app/api/pipeline-runs/[id]/route.ts` | GET single pipeline run |
| `app/components/playground/PipelineTraceDrawer.tsx` | 底部抽屉：Tab1 当前 pipeline / Tab2 历史 run |

### 修改
| 文件 | 变更内容 |
|------|---------|
| `app/lib/types.ts` | 新增 `StageSnapshot`、`PipelineRunRecord`、`PipelineRunStageEntry` 类型 |
| `app/components/playground/OutputTracePanel.tsx` | 改为从 `JsonView.tsx` 导入，删除本地定义 |
| `app/components/playground/PlaygroundShell.tsx` | 新增快照注入 state、save run 逻辑、drawer toggle、Header 按钮 |
| `app/components/playground/StageConfigPanel.tsx` | 新增快照栏 props 和渲染 |

---

## 任务 1：提取 JsonView 为共享组件

**文件：**
- 创建：`app/components/playground/JsonView.tsx`
- 修改：`app/components/playground/OutputTracePanel.tsx`

- [ ] **步骤 1：创建 `app/components/playground/JsonView.tsx`**

将 `OutputTracePanel.tsx` 中的 `STRING_TRUNCATE`、`VECTOR_THRESHOLD`、`truncateStrings`、`vectorReplacer`、`JsonView`、`JsonValue`、`CollapsibleJson`、`VectorSummary`、`TruncatedString` 提取出来，全部加 `export`：

```typescript
"use client";

import { useState } from "react";

export const STRING_TRUNCATE = 500;
export const VECTOR_THRESHOLD = 16;

export function truncateStrings(value: unknown, maxLen = STRING_TRUNCATE): unknown {
  if (typeof value === "string") {
    return value.length > maxLen
      ? { __truncated: true, preview: value.slice(0, maxLen), full: value, totalChars: value.length }
      : value;
  }
  if (
    Array.isArray(value) &&
    value.length > VECTOR_THRESHOLD &&
    (value as unknown[]).every((v) => typeof v === "number")
  ) {
    return { __vector: true, dimension: value.length, preview: (value as number[]).slice(0, 6), full: value };
  }
  if (Array.isArray(value)) return value.map((v) => truncateStrings(v, maxLen));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, truncateStrings(v, maxLen)])
    );
  }
  return value;
}

export function vectorReplacer(_key: string, val: unknown): unknown {
  if (val !== null && typeof val === "object" && !Array.isArray(val) &&
      (val as Record<string, unknown>).__vector === true) {
    const { full: _full, ...summary } = val as Record<string, unknown>;
    return { ...summary, full: `[…${summary.dimension} 维，点击上方 VectorSummary 展开]` };
  }
  return val;
}

export function JsonView({ value }: { value: unknown }) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.__truncated === true) {
      return <TruncatedString preview={obj.preview as string} full={obj.full as string} totalChars={obj.totalChars as number} />;
    }
    if (obj.__vector === true) {
      return <VectorSummary dimension={obj.dimension as number} preview={obj.preview as number[]} full={obj.full as number[]} />;
    }
    return (
      <div className="px-4 py-3 text-[10px] font-mono text-zinc-700 space-y-1 overflow-x-auto">
        {"{"}
        {Object.entries(obj).map(([k, v]) => (
          <div key={k} className="pl-3">
            <span className="text-purple-600">&quot;{k}&quot;</span>
            <span className="text-zinc-400">: </span>
            <JsonValue value={v} />
          </div>
        ))}
        {"}"}
      </div>
    );
  }
  return (
    <pre className="px-4 py-3 text-[10px] font-mono text-zinc-700 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function JsonValue({ value }: { value: unknown }): React.ReactNode {
  if (value === null) return <span className="text-zinc-400">null</span>;
  if (typeof value === "boolean") return <span className="text-blue-600">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-amber-600">{value}</span>;
  if (typeof value === "string") return <span className="text-green-700">&quot;{value}&quot;</span>;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.__truncated === true) {
      return <TruncatedString preview={obj.preview as string} full={obj.full as string} totalChars={obj.totalChars as number} />;
    }
    if (obj.__vector === true) {
      return <VectorSummary dimension={obj.dimension as number} preview={obj.preview as number[]} full={obj.full as number[]} />;
    }
    return <CollapsibleJson value={value} />;
  }
  if (Array.isArray(value)) return <CollapsibleJson value={value} />;
  return <span>{JSON.stringify(value)}</span>;
}

function CollapsibleJson({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const preview = Array.isArray(value) ? `[…${(value as unknown[]).length} items]` : "{…}";
  return (
    <span>
      <button onClick={() => setOpen((v) => !v)} className="text-zinc-400 hover:text-zinc-600 underline underline-offset-2">
        {open ? "▾" : "▸"} {preview}
      </button>
      {open && (
        <pre className="mt-1 ml-2 text-[10px] font-mono text-zinc-600 whitespace-pre-wrap break-all">
          {JSON.stringify(value, vectorReplacer, 2)}
        </pre>
      )}
    </span>
  );
}

export function VectorSummary({ dimension, preview, full }: { dimension: number; preview: number[]; full: number[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="inline-block w-full">
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[9px] font-medium text-violet-600">
          向量 [{dimension} 维]
        </span>
        <span className="text-amber-600 text-[10px]">
          [{preview.map((v) => v.toFixed(4)).join(", ")}{dimension > preview.length ? ", …" : ""}]
        </span>
        <button onClick={() => setExpanded((v) => !v)}
          className="text-[9px] text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded px-1 py-0.5">
          {expanded ? "折叠" : "展开全部"}
        </button>
      </span>
      {expanded && (
        <pre className="mt-1 ml-2 text-[10px] font-mono text-zinc-500 whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto">
          [{full.map((v) => v.toFixed(6)).join(", ")}]
        </pre>
      )}
    </span>
  );
}

function TruncatedString({ preview, full, totalChars }: { preview: string; full: string; totalChars: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="inline-block w-full">
      <span className="text-green-700 whitespace-pre-wrap break-all">
        &quot;{expanded ? full : preview}&quot;
      </span>
      {!expanded && (
        <button onClick={() => setExpanded(true)}
          className="ml-1 text-[9px] text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded px-1 py-0.5">
          …展开（共 {totalChars.toLocaleString()} 字符）
        </button>
      )}
      {expanded && (
        <button onClick={() => setExpanded(false)}
          className="ml-1 text-[9px] text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded px-1 py-0.5">
          折叠
        </button>
      )}
    </span>
  );
}
```

- [ ] **步骤 2：更新 `OutputTracePanel.tsx` 改为导入**

删除本地定义的 `STRING_TRUNCATE`、`VECTOR_THRESHOLD`、`truncateStrings`、`vectorReplacer`、`JsonView`、`JsonValue`、`CollapsibleJson`、`VectorSummary`、`TruncatedString`，改为从共享模块导入：

```typescript
// 在文件顶部添加：
import { truncateStrings, vectorReplacer, JsonView } from "./JsonView";
// 删除原来的本地定义（约第 7-284 行中的相关函数）
```

`OutputSection` 和 `TraceSection` 继续使用 `truncateStrings` + `JsonView`，行为不变。

- [ ] **步骤 3：运行 typecheck 确认无错误**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 4：Commit**

```bash
git add app/components/playground/JsonView.tsx app/components/playground/OutputTracePanel.tsx
git commit -m "refactor: extract JsonView to shared component for reuse in TraceDrawer"
```

---

## 任务 2：新增类型定义

**文件：**
- 修改：`app/lib/types.ts`（末尾追加）

- [ ] **步骤 1：追加类型到 `app/lib/types.ts`**

```typescript
// ─── Snapshot & Pipeline Run History ─────────────────────────────────────────

export interface StageSnapshot {
  id: string;
  stageId: string;
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: unknown | null;
  output: unknown;
  durationMs: number;
  createdAt: string;
}

export interface PipelineRunStageEntry {
  methodId: string;
  params: Record<string, unknown>;
  output: unknown;
  trace: unknown;
  durationMs: number;
  status: string;
  warnings?: string[];
}

export interface PipelineRunRecord {
  id: string;
  name: string;
  documentId?: string;
  stages: Record<string, PipelineRunStageEntry>;
  stageCount: number;
  createdAt: string;
}
```

- [ ] **步骤 2：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 3：Commit**

```bash
git add app/lib/types.ts
git commit -m "feat: add StageSnapshot and PipelineRunRecord types"
```

---

## 任务 3：数据库工具层

**文件：**
- 创建：`app/lib/snapshotDb.ts`

- [ ] **步骤 1：创建 `app/lib/snapshotDb.ts`**

```typescript
/**
 * snapshotDb.ts — Stage 快照和 Pipeline Run 历史的数据库工具函数
 *
 * 复用 storage/route.ts 的 pg.Client 连接模式。
 * 调用方负责 connect/end，此模块只提供 DDL 和 CRUD 函数。
 */
import { Client } from "pg";
import type { StageSnapshot, PipelineRunRecord, PipelineRunStageEntry } from "./types";

// ─── DDL ──────────────────────────────────────────────────────────────────────

export const SNAPSHOT_DDL = `
CREATE TABLE IF NOT EXISTS stage_snapshots (
  id              TEXT PRIMARY KEY,
  stage_id        TEXT NOT NULL,
  method_id       TEXT NOT NULL,
  params          JSONB NOT NULL DEFAULT '{}',
  upstream_output JSONB,
  output          JSONB,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_snapshots_stage_id
  ON stage_snapshots (stage_id);

CREATE TABLE IF NOT EXISTS pipeline_run_history (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  document_id TEXT,
  stages      JSONB NOT NULL DEFAULT '{}',
  stage_count INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_history_created_at
  ON pipeline_run_history (created_at DESC);
`;

export async function initSnapshotTables(client: Client): Promise<void> {
  await client.query(SNAPSHOT_DDL);
}

// ─── Stage Snapshot CRUD ──────────────────────────────────────────────────────

export async function upsertStageSnapshot(
  client: Client,
  snap: Omit<StageSnapshot, "createdAt">
): Promise<void> {
  await client.query(
    `INSERT INTO stage_snapshots
       (id, stage_id, method_id, params, upstream_output, output, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (stage_id) DO UPDATE SET
       id              = EXCLUDED.id,
       method_id       = EXCLUDED.method_id,
       params          = EXCLUDED.params,
       upstream_output = EXCLUDED.upstream_output,
       output          = EXCLUDED.output,
       duration_ms     = EXCLUDED.duration_ms,
       created_at      = NOW()`,
    [snap.id, snap.stageId, snap.methodId,
     JSON.stringify(snap.params),
     snap.upstreamOutput != null ? JSON.stringify(snap.upstreamOutput) : null,
     snap.output != null ? JSON.stringify(snap.output) : null,
     snap.durationMs]
  );
}

export async function getLatestStageSnapshot(
  client: Client,
  stageId: string
): Promise<StageSnapshot | null> {
  const res = await client.query<{
    id: string; stage_id: string; method_id: string;
    params: Record<string, unknown>; upstream_output: unknown;
    output: unknown; duration_ms: number; created_at: Date;
  }>(
    `SELECT id, stage_id, method_id, params, upstream_output, output, duration_ms, created_at
     FROM stage_snapshots WHERE stage_id = $1 LIMIT 1`,
    [stageId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id, stageId: r.stage_id, methodId: r.method_id,
    params: r.params, upstreamOutput: r.upstream_output,
    output: r.output, durationMs: r.duration_ms,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Pipeline Run History CRUD ────────────────────────────────────────────────

export async function insertPipelineRun(
  client: Client,
  run: Omit<PipelineRunRecord, "createdAt">
): Promise<void> {
  await client.query(
    `INSERT INTO pipeline_run_history (id, name, document_id, stages, stage_count)
     VALUES ($1, $2, $3, $4, $5)`,
    [run.id, run.name, run.documentId ?? null,
     JSON.stringify(run.stages), run.stageCount]
  );
}

export async function listPipelineRuns(
  client: Client,
  limit = 50
): Promise<Omit<PipelineRunRecord, "stages">[]> {
  const res = await client.query<{
    id: string; name: string; document_id: string | null;
    stage_count: number; created_at: Date;
  }>(
    `SELECT id, name, document_id, stage_count, created_at
     FROM pipeline_run_history ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => ({
    id: r.id, name: r.name,
    documentId: r.document_id ?? undefined,
    stageCount: r.stage_count,
    createdAt: r.created_at.toISOString(),
    stages: {},   // 列表不返回 stages，减少数据量
  }));
}

export async function getPipelineRun(
  client: Client,
  id: string
): Promise<PipelineRunRecord | null> {
  const res = await client.query<{
    id: string; name: string; document_id: string | null;
    stages: Record<string, PipelineRunStageEntry>;
    stage_count: number; created_at: Date;
  }>(
    `SELECT id, name, document_id, stages, stage_count, created_at
     FROM pipeline_run_history WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id, name: r.name, documentId: r.document_id ?? undefined,
    stages: r.stages, stageCount: r.stage_count,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── 连接工具 ─────────────────────────────────────────────────────────────────

/** 解包 AggregateError（Node 18+ ECONNREFUSED 会包在里面） */
export function unwrapError(err: unknown): string {
  const unwrapped = err instanceof AggregateError && err.errors?.length > 0
    ? err.errors[0] : err;
  const e = unwrapped as Record<string, unknown>;
  return typeof e?.message === "string" ? e.message : String(err);
}

/** 从参数或环境变量取连接串 */
export function resolveConnectionString(paramCs?: string): string | null {
  const cs = (typeof paramCs === "string" && paramCs.trim()) ? paramCs.trim() : null;
  return cs ?? process.env.DATABASE_URL ?? null;
}
```

- [ ] **步骤 2：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 3：Commit**

```bash
git add app/lib/snapshotDb.ts
git commit -m "feat: add snapshotDb utility layer for stage snapshots and pipeline run history"
```

---

## 任务 4：快照 API

**文件：**
- 创建：`app/app/api/snapshots/route.ts`
- 创建：`app/app/api/snapshots/[stageId]/route.ts`

- [ ] **步骤 1：创建目录**

```bash
mkdir -p /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app/app/api/snapshots/\[stageId\]
```

- [ ] **步骤 2：创建 `app/app/api/snapshots/route.ts`（POST upsert）**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { initSnapshotTables, upsertStageSnapshot, resolveConnectionString, unwrapError } from "@/lib/snapshotDb";

export async function POST(req: NextRequest) {
  let body: {
    stageId: string; methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: unknown | null;
    output: unknown; durationMs: number;
    connectionString?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: { code: "invalid_json", message: "请求体不是合法 JSON" } }, { status: 400 }); }

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
      id, stageId: body.stageId, methodId: body.methodId,
      params: body.params, upstreamOutput: body.upstreamOutput,
      output: body.output, durationMs: body.durationMs,
    });
    await client.end();
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ ok: false, reason: unwrapError(err) });
  }
}
```

- [ ] **步骤 3：创建 `app/app/api/snapshots/[stageId]/route.ts`（GET）**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { initSnapshotTables, getLatestStageSnapshot, resolveConnectionString, unwrapError } from "@/lib/snapshotDb";

export async function GET(
  req: NextRequest,
  { params }: { params: { stageId: string } }
) {
  const cs = resolveConnectionString(
    req.nextUrl.searchParams.get("connectionString") ?? undefined
  );
  if (!cs) return NextResponse.json({ snapshot: null });

  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    await initSnapshotTables(client);
    const snapshot = await getLatestStageSnapshot(client, params.stageId);
    await client.end();
    return NextResponse.json({ snapshot });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ snapshot: null, error: unwrapError(err) });
  }
}
```

- [ ] **步骤 4：curl 验证（需要 dev server + postgres 运行）**

```bash
# POST snapshot
curl -s -X POST http://localhost:3000/api/snapshots \
  -H "Content-Type: application/json" \
  -d '{"stageId":"chunk","methodId":"recursive","params":{"chunkSize":200},"upstreamOutput":{"text":"test"},"output":{"chunkCount":3},"durationMs":150}' \
  | python3 -m json.tool
# 预期：{ "ok": true, "id": "chunk-1234567890" }

# GET snapshot
curl -s http://localhost:3000/api/snapshots/chunk | python3 -m json.tool
# 预期：{ "snapshot": { "stageId": "chunk", "methodId": "recursive", ... } }
```

- [ ] **步骤 5：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 6：Commit**

```bash
git add app/app/api/snapshots/
git commit -m "feat: add stage snapshot API (POST upsert + GET latest)"
```

---

## 任务 5：Pipeline Run 历史 API

**文件：**
- 创建：`app/app/api/pipeline-runs/route.ts`
- 创建：`app/app/api/pipeline-runs/[id]/route.ts`

- [ ] **步骤 1：创建目录**

```bash
mkdir -p /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app/app/api/pipeline-runs/\[id\]
```

- [ ] **步骤 2：创建 `app/app/api/pipeline-runs/route.ts`（POST + GET list）**

```typescript
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
```

- [ ] **步骤 3：创建 `app/app/api/pipeline-runs/[id]/route.ts`（GET single）**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { initSnapshotTables, getPipelineRun, resolveConnectionString, unwrapError } from "@/lib/snapshotDb";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const cs = resolveConnectionString(
    req.nextUrl.searchParams.get("connectionString") ?? undefined
  );
  if (!cs) return NextResponse.json({ run: null });

  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    await initSnapshotTables(client);
    const run = await getPipelineRun(client, params.id);
    await client.end();
    return NextResponse.json({ run });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({ run: null, error: unwrapError(err) });
  }
}
```

- [ ] **步骤 4：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 5：Commit**

```bash
git add app/app/api/pipeline-runs/
git commit -m "feat: add pipeline run history API (POST save + GET list + GET by id)"
```

---

## 任务 6：PlaygroundShell 状态扩展

**文件：**
- 修改：`app/components/playground/PlaygroundShell.tsx`

- [ ] **步骤 1：新增 import 和 state**

在文件顶部 import 区域追加：
```typescript
import type { StageSnapshot, PipelineRunRecord, PipelineRunStageEntry } from "@/lib/types";
```

在现有 state 声明区（`stageParamsMap` 附近）追加：
```typescript
// 用户手动加载的快照上游（stageId → upstreamOutput）
const [snapshotUpstreamMap, setSnapshotUpstreamMap] = useState<Record<string, unknown>>({});
// 当前 activeStage 的快照（从 DB 拉取）
const [activeStageSnapshot, setActiveStageSnapshot] = useState<StageSnapshot | null>(null);
// 全链路抽屉开关
const [traceDrawerOpen, setTraceDrawerOpen] = useState(false);
// 历史 pipeline run 列表（抽屉 Tab2 用）
const [pipelineRunHistory, setPipelineRunHistory] = useState<PipelineRunRecord[]>([]);
```

- [ ] **步骤 2：在 activeStage 变化时拉取快照**

在现有 `useEffect`（监听 `activeStage.id`）之后追加一个新的 useEffect：
```typescript
useEffect(() => {
  if (!activeStage) { setActiveStageSnapshot(null); return; }
  fetch(`/api/snapshots/${activeStage.id}`)
    .then((r) => r.json())
    .then((data: { snapshot: StageSnapshot | null }) => setActiveStageSnapshot(data.snapshot ?? null))
    .catch(() => setActiveStageSnapshot(null));
}, [activeStage?.id]);
```

- [ ] **步骤 3：修改 `handleRun` — 成功后保存快照 + 支持快照注入**

在 `handleRun` 内找到 `const upstreamOutput = ...` 这行，改为：
```typescript
// 若用户已加载快照上游，优先使用它；否则走原有依赖图逻辑
const injectedUpstream = snapshotUpstreamMap[stageId];
let upstreamOutput: unknown | null;
if (injectedUpstream !== undefined) {
  upstreamOutput = injectedUpstream;
} else {
  const upstreamStageId = resolveEffectiveUpstream(
    stageId, pipelineRun.enabledSteps, pipelineRun.runtimeContext
  );
  upstreamOutput = upstreamStageId ? latestRun(upstreamStageId)?.output ?? null : null;
}
```

在 `updateStepRun(stageId, runId, { status: "success", ... })` 之后追加：
```typescript
// 异步保存快照（失败不阻断主流程）
fetch("/api/snapshots", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    stageId, methodId, params, upstreamOutput,
    output: data.output, durationMs,
  }),
}).catch(() => {/* 静默失败 */});
// 刷新当前 stage 快照
setActiveStageSnapshot({
  id: `${stageId}-${Date.now()}`,
  stageId, methodId, params,
  upstreamOutput: upstreamOutput ?? null,
  output: data.output,
  durationMs,
  createdAt: new Date().toISOString(),
});
```

- [ ] **步骤 4：新增 `handleLoadSnapshotUpstream` 和 `handleClearSnapshotUpstream`**

```typescript
const handleLoadSnapshotUpstream = useCallback((stageId: string, upstream: unknown) => {
  setSnapshotUpstreamMap((prev) => ({ ...prev, [stageId]: upstream }));
}, []);

const handleClearSnapshotUpstream = useCallback((stageId: string) => {
  setSnapshotUpstreamMap((prev) => {
    const next = { ...prev };
    delete next[stageId];
    return next;
  });
}, []);
```

- [ ] **步骤 5：新增 `handleSavePipelineRun`**

```typescript
const handleSavePipelineRun = useCallback(async () => {
  const stages: Record<string, PipelineRunStageEntry> = {};
  for (const [sid, runs] of Object.entries(stepRuns)) {
    const latest = runs[0];
    if (latest) {
      stages[sid] = {
        methodId: latest.methodId,
        params: latest.params,
        output: latest.output,
        trace: latest.trace,
        durationMs: latest.durationMs ?? 0,
        status: latest.status,
        warnings: latest.warnings,
      };
    }
  }
  const name = window.prompt("为本次 Pipeline Run 命名（留空自动命名）：") ?? "";
  const res = await fetch("/api/pipeline-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name.trim() || undefined,
      documentId: pipelineRun.selectedDocumentId ?? undefined,
      stages,
    }),
  });
  const data = await res.json();
  if (data.ok) {
    // 刷新历史列表
    fetch("/api/pipeline-runs")
      .then((r) => r.json())
      .then((d: { runs: PipelineRunRecord[] }) => setPipelineRunHistory(d.runs))
      .catch(() => {});
  }
}, [stepRuns, pipelineRun.selectedDocumentId]);
```

- [ ] **步骤 6：拉取历史 run 列表（在抽屉打开时）**

追加 useEffect：
```typescript
useEffect(() => {
  if (!traceDrawerOpen) return;
  fetch("/api/pipeline-runs")
    .then((r) => r.json())
    .then((d: { runs: PipelineRunRecord[] }) => setPipelineRunHistory(d.runs ?? []))
    .catch(() => {});
}, [traceDrawerOpen]);
```

- [ ] **步骤 7：更新 JSX — 向 Header、StageConfigPanel、PipelineTraceDrawer 传入新 props**

在 Header 的 JSX（内联函数 `<Header ...>`）位置，追加属性：
```tsx
onSavePipelineRun={handleSavePipelineRun}
onToggleDrawer={() => setTraceDrawerOpen((v) => !v)}
hasSuccessfulRuns={Object.values(stepRuns).some((runs) => runs.some((r) => r.status === "success"))}
```

在 `<StageConfigPanel ...>` 追加：
```tsx
snapshot={activeStageSnapshot}
snapshotUpstreamLoaded={snapshotUpstreamMap[activeStage?.id ?? ""] !== undefined}
onLoadSnapshotUpstream={handleLoadSnapshotUpstream}
onClearSnapshotUpstream={handleClearSnapshotUpstream}
```

在 JSX 最后（`</div>` 结束前）追加：
```tsx
<PipelineTraceDrawer
  open={traceDrawerOpen}
  onClose={() => setTraceDrawerOpen(false)}
  stepRuns={stepRuns}
  stages={ALL_STAGES}
  enabledSteps={pipelineRun.enabledSteps}
  pipelineRunHistory={pipelineRunHistory}
/>
```

其中 `PIPELINE_STAGES` 从 `PipelineStepList` 导入（与 StageConfigPanel 保持一致）：
```typescript
import { PIPELINE_STAGES } from "./PipelineStepList";
```

并将 `<PipelineTraceDrawer stages={ALL_STAGES}` 改为 `stages={PIPELINE_STAGES}`。

- [ ] **步骤 8：更新内联 Header 函数签名**

找到 `function Header({` 位置，扩展 props：
```typescript
function Header({
  pipelineRun, selectedDoc, runningStageId, activeStage,
  onSavePipelineRun, onToggleDrawer, hasSuccessfulRuns,
}: {
  pipelineRun: PipelineRun;
  selectedDoc: DocumentRecord | undefined;
  runningStageId: string | null;
  activeStage: PipelineStage | null;
  onSavePipelineRun: () => void;
  onToggleDrawer: () => void;
  hasSuccessfulRuns: boolean;
}) {
```

在 Header 的 JSX 里追加两个按钮（在现有状态徽章右侧）：
```tsx
<button
  onClick={onToggleDrawer}
  className="text-[10px] px-2 py-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
>
  🔗 全链路
</button>
<button
  onClick={onSavePipelineRun}
  disabled={!hasSuccessfulRuns}
  className="text-[10px] px-2 py-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
>
  💾 保存 Run
</button>
```

- [ ] **步骤 9：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 10：Commit**

```bash
git add app/components/playground/PlaygroundShell.tsx
git commit -m "feat: add snapshot injection state, save pipeline run, and trace drawer toggle to PlaygroundShell"
```

---

## 任务 7：StageConfigPanel 快照栏

**文件：**
- 修改：`app/components/playground/StageConfigPanel.tsx`

- [ ] **步骤 1：扩展 Props 类型**

找到 Props interface（约第 10-30 行），追加：
```typescript
snapshot?: import("@/lib/types").StageSnapshot | null;
snapshotUpstreamLoaded?: boolean;
onLoadSnapshotUpstream?: (stageId: string, upstream: unknown) => void;
onClearSnapshotUpstream?: (stageId: string) => void;
```

并在函数参数解构中追加：
```typescript
snapshot,
snapshotUpstreamLoaded,
onLoadSnapshotUpstream,
onClearSnapshotUpstream,
```

- [ ] **步骤 2：在方法选择器和 Run 按钮之间插入快照栏**

找到 Run 按钮区域（约 `{/* Run button + 状态 */}` 注释处），在其上方插入：

```tsx
{/* 快照栏 */}
{snapshot && (
  <div className="px-5 py-2 border-t border-zinc-100 bg-zinc-50">
    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
      <span className="text-violet-500">📌 上次快照</span>
      <span>{new Date(snapshot.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
      <span className="font-mono bg-zinc-100 px-1 rounded">{snapshot.methodId}</span>
      <span className="ml-auto flex gap-1">
        {snapshotUpstreamLoaded ? (
          <>
            <span className="text-green-600 font-medium">✓ 已加载快照输入</span>
            <button
              onClick={() => onClearSnapshotUpstream?.(stage.id)}
              className="text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded px-1"
            >
              清除
            </button>
          </>
        ) : (
          <button
            onClick={() => onLoadSnapshotUpstream?.(stage.id, snapshot.upstreamOutput)}
            className="text-violet-600 hover:text-violet-800 border border-violet-200 rounded px-1.5 py-0.5 bg-violet-50"
          >
            使用此快照作为上游输入
          </button>
        )}
      </span>
    </div>
  </div>
)}
```

- [ ] **步骤 3：在 Run 按钮上显示快照注入状态**

找到 Run 按钮的文案部分（`{isRunning ? ...`），在 success 分支里将文案改为：
```tsx
{isRunning ? "运行中…" : snapshotUpstreamLoaded ? "▶ 运行（快照输入）" : "▶ 运行"}
```

- [ ] **步骤 4：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 5：Commit**

```bash
git add app/components/playground/StageConfigPanel.tsx
git commit -m "feat: add snapshot bar to StageConfigPanel for upstream injection"
```

---

## 任务 8：PipelineTraceDrawer 组件

**文件：**
- 创建：`app/components/playground/PipelineTraceDrawer.tsx`

- [ ] **步骤 1：创建 `PipelineTraceDrawer.tsx`**

```typescript
"use client";

import { useState } from "react";
import { PipelineStage } from "./PipelineStepList";
import { StepRunMap, PipelineRunRecord } from "@/lib/types";
import { JsonView, truncateStrings } from "./JsonView";

interface PipelineTraceDrawerProps {
  open: boolean;
  onClose: () => void;
  stepRuns: StepRunMap;
  stages: PipelineStage[];
  enabledSteps: Record<string, boolean>;
  pipelineRunHistory: PipelineRunRecord[];
}

const CATEGORY_LABEL: Record<string, string> = {
  ingestion: "Ingestion",
  retrieval: "Retrieval",
  generation: "Generation",
};

export default function PipelineTraceDrawer({
  open, onClose, stepRuns, stages, enabledSteps, pipelineRunHistory,
}: PipelineTraceDrawerProps) {
  const [tab, setTab] = useState<"current" | "history">("current");
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedHistoryRun, setExpandedHistoryRun] = useState<string | null>(null);
  const [expandedHistoryStage, setExpandedHistoryStage] = useState<string | null>(null);

  const drawerH = open ? "h-[40vh]" : "h-8";

  // 按 category 分组
  const grouped = stages.reduce<Record<string, PipelineStage[]>>((acc, s) => {
    const cat = s.category ?? "ingestion";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 shadow-lg transition-[height] duration-200 z-40 flex flex-col ${drawerH}`}
    >
      {/* 拉条 / 标题栏 */}
      <div className="flex items-center gap-3 px-4 h-8 shrink-0 border-b border-zinc-100 cursor-pointer select-none"
        onClick={open ? onClose : undefined}>
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          🔗 Pipeline 全链路追踪
        </span>
        {open && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setTab("current"); }}
              className={`text-[10px] px-2 py-0.5 rounded ${tab === "current" ? "bg-zinc-100 text-zinc-700 font-medium" : "text-zinc-400 hover:text-zinc-600"}`}
            >
              当前运行
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setTab("history"); }}
              className={`text-[10px] px-2 py-0.5 rounded ${tab === "history" ? "bg-zinc-100 text-zinc-700 font-medium" : "text-zinc-400 hover:text-zinc-600"}`}
            >
              历史记录 {pipelineRunHistory.length > 0 && `(${pipelineRunHistory.length})`}
            </button>
          </>
        )}
        <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-zinc-600 text-[10px]">
          {open ? "▼ 收起" : "▲ 展开"}
        </button>
      </div>

      {/* 内容区 */}
      {open && (
        <div className="flex-1 overflow-y-auto">
          {tab === "current" && (
            <CurrentTab
              grouped={grouped}
              stepRuns={stepRuns}
              enabledSteps={enabledSteps}
              expandedStage={expandedStage}
              onToggleStage={(id) => setExpandedStage((prev) => prev === id ? null : id)}
            />
          )}
          {tab === "history" && (
            <HistoryTab
              runs={pipelineRunHistory}
              expandedRun={expandedHistoryRun}
              expandedStage={expandedHistoryStage}
              onToggleRun={(id) => { setExpandedHistoryRun((prev) => prev === id ? null : id); setExpandedHistoryStage(null); }}
              onToggleStage={(id) => setExpandedHistoryStage((prev) => prev === id ? null : id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── 当前运行 Tab ──────────────────────────────────────────────────────────────

function CurrentTab({ grouped, stepRuns, enabledSteps, expandedStage, onToggleStage }: {
  grouped: Record<string, PipelineStage[]>;
  stepRuns: StepRunMap;
  enabledSteps: Record<string, boolean>;
  expandedStage: string | null;
  onToggleStage: (id: string) => void;
}) {
  return (
    <div className="p-3 space-y-3">
      {Object.entries(grouped).map(([cat, stageList]) => (
        <div key={cat}>
          <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 mb-1">
            {CATEGORY_LABEL[cat] ?? cat}
          </div>
          <div className="space-y-0.5">
            {stageList.map((s) => {
              const latestRun = stepRuns[s.id]?.[0];
              const isDisabled = enabledSteps[s.id] === false;
              return (
                <StageRow
                  key={s.id}
                  stage={s}
                  latestRun={latestRun}
                  isDisabled={isDisabled}
                  expanded={expandedStage === s.id}
                  onToggle={() => onToggleStage(s.id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function StageRow({ stage, latestRun, isDisabled, expanded, onToggle }: {
  stage: PipelineStage;
  latestRun: import("@/lib/types").StepRun | undefined;
  isDisabled: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusColor = !latestRun || isDisabled ? "bg-zinc-200"
    : latestRun.status === "success" ? "bg-green-400"
    : latestRun.status === "error" ? "bg-red-400"
    : latestRun.status === "running" ? "bg-blue-400 animate-pulse"
    : "bg-zinc-200";

  return (
    <div>
      <button
        onClick={latestRun ? onToggle : undefined}
        className="w-full flex items-center gap-2 text-left px-2 py-1 rounded hover:bg-zinc-50 group"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
        <span className={`text-[10px] font-mono ${isDisabled ? "text-zinc-300 line-through" : "text-zinc-600"}`}>
          {stage.id}
        </span>
        {latestRun && (
          <>
            <span className="text-[9px] text-zinc-400 font-mono">{latestRun.methodId}</span>
            <span className="text-[9px] text-zinc-300 ml-auto">{latestRun.durationMs}ms</span>
          </>
        )}
        {latestRun && (
          <span className="text-[9px] text-zinc-300 group-hover:text-zinc-500">{expanded ? "▾" : "▸"}</span>
        )}
      </button>
      {expanded && latestRun && (
        <div className="ml-4 mt-0.5 border-l border-zinc-100 pl-2 space-y-1">
          {latestRun.output !== undefined && (
            <div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Output</div>
              <JsonView value={truncateStrings(latestRun.output)} />
            </div>
          )}
          {latestRun.trace !== undefined && (
            <div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Trace</div>
              <JsonView value={truncateStrings(latestRun.trace)} />
            </div>
          )}
          {latestRun.error && (
            <div className="text-[9px] text-red-600 font-mono">{latestRun.error.code}: {latestRun.error.message}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 历史记录 Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ runs, expandedRun, expandedStage, onToggleRun, onToggleStage }: {
  runs: PipelineRunRecord[];
  expandedRun: string | null;
  expandedStage: string | null;
  onToggleRun: (id: string) => void;
  onToggleStage: (id: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-zinc-400 py-8">
        暂无历史记录。运行 pipeline 后点击「💾 保存 Run」保存。
      </div>
    );
  }
  return (
    <div className="p-3 space-y-1">
      {runs.map((run) => (
        <div key={run.id}>
          <button
            onClick={() => onToggleRun(run.id)}
            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-zinc-50"
          >
            <span className="text-[10px] font-medium text-zinc-700">{run.name}</span>
            <span className="text-[9px] text-zinc-400">{run.stageCount} stages</span>
            <span className="text-[9px] text-zinc-300 ml-auto">
              {new Date(run.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-[9px] text-zinc-300">{expandedRun === run.id ? "▾" : "▸"}</span>
          </button>
          {expandedRun === run.id && (
            <div className="ml-2 space-y-0.5 border-l border-zinc-100 pl-2">
              {Object.entries(run.stages).map(([sid, entry]) => (
                <div key={sid}>
                  <button
                    onClick={() => onToggleStage(sid)}
                    className="w-full flex items-center gap-2 text-left px-1 py-0.5 rounded hover:bg-zinc-50"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${entry.status === "success" ? "bg-green-400" : entry.status === "error" ? "bg-red-400" : "bg-zinc-200"}`} />
                    <span className="text-[10px] font-mono text-zinc-600">{sid}</span>
                    <span className="text-[9px] text-zinc-400">{entry.methodId}</span>
                    <span className="text-[9px] text-zinc-300 ml-auto">{entry.durationMs}ms</span>
                    <span className="text-[9px] text-zinc-300">{expandedStage === sid ? "▾" : "▸"}</span>
                  </button>
                  {expandedStage === sid && (
                    <div className="ml-4 border-l border-zinc-100 pl-2">
                      {entry.output !== undefined && <JsonView value={truncateStrings(entry.output)} />}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **步骤 2：运行 typecheck**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker/app && npm run typecheck
```
预期：0 错误

- [ ] **步骤 3：Commit**

```bash
git add app/components/playground/PipelineTraceDrawer.tsx
git commit -m "feat: add PipelineTraceDrawer component with current/history tabs"
```

---

## 任务 9：验证 + 最终清理

- [ ] **步骤 1：运行完整验证**

```bash
cd /Users/sissi/Documents/Claude/Projects/harness_idea_maker
./init.sh
```
预期：全部通过（harness 文件检查 + JSON 校验 + typecheck + lint）

- [ ] **步骤 2：浏览器端到端验证（需要 dev server + postgres）**

```bash
# Terminal 1
docker compose up postgres

# Terminal 2
cd app && npm run dev
```

验证流程（按顺序）：
1. 上传文档 → 运行 idempotency + preprocess
2. 切换到 chunk → 快照栏应出现"📌 上次快照 · preprocess"
3. 点击"使用此快照作为上游输入" → Run 按钮变为"▶ 运行（快照输入）"→ 运行 chunk
4. 修改 chunk 方法（如从 recursive 改 fixed-size）→ 再次运行 → 确认两次都出现在右侧历史
5. 点击 Header「🔗 全链路」→ 底部抽屉展开 → 「当前运行」Tab 显示所有 stage
6. 点击某个 stage 行 → 内联展开 output/trace JSON
7. 点击 Header「💾 保存 Run」→ 命名后确认 → 切到抽屉「历史记录」Tab → 记录已出现
8. 在 PostgreSQL 验证：
   ```bash
   psql "$DATABASE_URL" -c "SELECT stage_id, method_id, created_at FROM stage_snapshots;"
   psql "$DATABASE_URL" -c "SELECT id, name, stage_count, created_at FROM pipeline_run_history;"
   ```

- [ ] **步骤 3：更新 harness 状态文档**

更新 `progress.md`（追加会话记录）和 `session-handoff.md`（HEAD、当前状态、下一步）：
- feature_list.json 里 feat-005 标记为 done（若此前未标）
- 新增 feat-006（Pipeline 快照与全链路追踪）状态为 done

- [ ] **步骤 4：最终 commit**

```bash
git add progress.md session-handoff.md feature_list.json
git commit -m "docs: update harness state for stage snapshots + pipeline trace drawer"
```
