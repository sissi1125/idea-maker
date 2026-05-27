/**
 * DDL — feat-200.1 Week 1：用户 / 项目 / 项目设置三张表
 *
 * 设计思路：
 *   - 复用 snapshots.service.ts 的"CREATE TABLE IF NOT EXISTS + 每请求初始化"模式，
 *     不引入 ORM / migration 工具，保持依赖最少（feat-200.1 只多一个 bcrypt + jsonwebtoken）
 *   - 表使用 TEXT id（uuid v4 由 Node 端 crypto.randomUUID 生成），免开启 pgcrypto 扩展
 *   - project_settings.encrypted_api_key 留 TEXT 字段，Week 5 真正接 AES-256 时再做加密；
 *     Week 1 先允许 NULL，不强制设置
 *   - 索引：users(email) 唯一，projects(owner_id) 普通索引
 *
 * 为什么 DDL 集中在一处：
 *   每个 Module 自己跑 CREATE TABLE 会导致跨模块表关系散乱（projects → users 外键）。
 *   feat-200.1 三张表强相关（user 1-n project 1-1 project_settings），统一 init 更清晰。
 */

export const DDL_USERS = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
`;

export const DDL_PROJECTS = `
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  emoji         TEXT,
  description   TEXT,
  docs_count    INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects (owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
`;

export const DDL_PROJECT_SETTINGS = `
CREATE TABLE IF NOT EXISTS project_settings (
  project_id          TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  provider            TEXT,
  encrypted_api_key   TEXT,
  model               TEXT,
  temperature         NUMERIC(3, 2),
  max_tokens          INTEGER,
  thinking_depth      TEXT,
  retrieval_mode      TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
`;

/**
 * ── feat-200.2 Week 2：documents + ingestion_jobs ─────────────────────────────
 *
 * documents：MVP 项目级文档表（与旧 apps/web/data/documents.json store 并存）。
 *   - storage_ref：文件实际存储路径（apps/api/data/uploads/{projectId}/{docId}）
 *     不存 base64 内容到 PG 是为避免大 BLOB 拖慢 SELECT
 *   - category：'product' / 'compete' / 'history'（与原型 Upload.jsx 三 Tab 对应，TEXT 而非 ENUM
 *     方便 Week 8 增加分类）
 *   - hash：内容 sha256，给 idempotency 判重
 *   - processing_status：'queued' / 'processing' / 'ready' / 'error'（ingestion_job 完成
 *     后 runner 反写）
 *
 * ingestion_jobs：异步处理任务表
 *   - status：'queued' → 'running' → 'succeeded' | 'failed'
 *   - progress：0-100；current_stage：当前 stage 名称（idempotency / preprocess / ...）
 *   - 单文档可有多次 ingestion 历史（同一 doc 多版本），按 document_id 查最新
 */

export const DDL_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  category          TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  hash              TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  processing_status TEXT NOT NULL DEFAULT 'queued',
  storage_ref       TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents (project_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_category ON documents (project_id, category);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents (hash);
`;

export const DDL_INGESTION_JOBS = `
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',
  progress      INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT,
  chunks_done   INTEGER NOT NULL DEFAULT 0,
  chunks_total  INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12, 6) NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_project_id ON ingestion_jobs (project_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_document_id ON ingestion_jobs (document_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_updated
  ON ingestion_jobs (status, updated_at DESC);
`;

/**
 * ── feat-200.3 Week 3：generations ───────────────────────────────────────────
 *
 * generations：每次 generate 调用产出的完整记录。
 *   - query：用户原始提问
 *   - pipeline_trace (JSONB)：11-stage 编排的完整执行轨迹
 *     结构：{ stages: Array<{ stageId, methodId, durationMs, output?, trace?, warnings? }> }
 *   - retrieved_chunks (JSONB)：检索阶段命中的 chunks 快照（脱离向量表存一份，方便回放）
 *   - result_notes (TEXT)：最终生成的营销文案 / 笔记内容
 *   - cost_breakdown (JSONB)：本次请求的 token / 调用次数 / 美元明细
 *   - status：'running' → 'succeeded' | 'failed'
 *   - error：失败时的错误信息
 */

export const DDL_GENERATIONS = `
CREATE TABLE IF NOT EXISTS generations (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  query             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running',
  pipeline_trace    JSONB,
  retrieved_chunks  JSONB,
  result_notes      TEXT,
  cost_breakdown    JSONB,
  error             TEXT,
  duration_ms       INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_generations_project_id ON generations (project_id);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations (project_id, created_at DESC);
`;

/**
 * 顺序：users → projects → project_settings → documents → ingestion_jobs → generations。
 * 受外键依赖约束。
 *
 * 调用方需要 await db.initSchema(client) 在每个请求开头（db.service.ts 已自动处理）。
 * 依赖 CREATE TABLE IF NOT EXISTS 的幂等性。
 */
export const FEAT_200_DDL_BLOCKS = [
  DDL_USERS,
  DDL_PROJECTS,
  DDL_PROJECT_SETTINGS,
  DDL_DOCUMENTS,
  DDL_INGESTION_JOBS,
  DDL_GENERATIONS,
];
