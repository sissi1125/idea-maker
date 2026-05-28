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
-- feat-200.6 patch：每个 stage 的输出摘要（JSONB，按 stage 名做 key）。
-- 形状：{ idempotency?:{...}, preprocess?:{...}, chunk?:{...}, embedding?:{...}, storage?:{...} }
-- 用 ADD COLUMN IF NOT EXISTS 保证向后兼容已有库。
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS stage_outputs JSONB;
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
  source            TEXT NOT NULL DEFAULT 'manual',
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
-- feat-200.4：补 source 列（已有库幂等加列）
ALTER TABLE generations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
`;

/**
 * ── feat-200.4 Week 4：feedbacks / auto_generations / cost_summary ──────────
 *
 * feedbacks：用户对 generation 的多维反馈。
 *   - 4 维评分：relevance / accuracy / creativity / overall（1-5 整数，NULL 表示该维未评分）
 *   - edit_diff：用户在 GenerationEditor 里改完保存的最终文本（保留原始作为差异 base 在前端比对）
 *   - comment：可选自由文本
 *   - 单 generation 一条 feedback（UNIQUE(generation_id)），再次提交走 ON CONFLICT 更新
 *     ↳ 避免列表里出现"同一 generation 多评分"的脏数据
 *
 * auto_generations：自动生成触发记录。
 *   - 监听 ingestion.completed，对 category=product / compete 各触发一次 generate
 *   - generation_id 指向 generations 表的实际产物；status 提供独立的 queued/succeeded/failed
 *     ↳ 即便后续 generation 被删，触发记录仍可保留作审计
 *   - 同一 document_id 多次 ingestion 完成会插多条；前端按 created_at DESC 取最新
 *
 * cost_summary：按天聚合的项目级成本视图。
 *   - 主键 (project_id, day)；generate 完成后做 ON CONFLICT upsert
 *   - 不是事实表，单纯加速 /cost/summary 查询；明细仍在 generations.cost_breakdown
 *   - day 用 DATE（UTC），跨时区按需在前端转换
 */

export const DDL_FEEDBACKS = `
CREATE TABLE IF NOT EXISTS feedbacks (
  id                TEXT PRIMARY KEY,
  generation_id     TEXT NOT NULL UNIQUE REFERENCES generations (id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  relevance         SMALLINT,
  accuracy          SMALLINT,
  creativity        SMALLINT,
  overall           SMALLINT,
  edit_diff         TEXT,
  comment           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (relevance  IS NULL OR (relevance  BETWEEN 1 AND 5)),
  CHECK (accuracy   IS NULL OR (accuracy   BETWEEN 1 AND 5)),
  CHECK (creativity IS NULL OR (creativity BETWEEN 1 AND 5)),
  CHECK (overall    IS NULL OR (overall    BETWEEN 1 AND 5))
);
CREATE INDEX IF NOT EXISTS idx_feedbacks_user_id ON feedbacks (user_id);
`;

export const DDL_AUTO_GENERATIONS = `
CREATE TABLE IF NOT EXISTS auto_generations (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  document_id       TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  card_type         TEXT NOT NULL,
  generation_id     TEXT REFERENCES generations (id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  error             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_generations_project_id ON auto_generations (project_id);
CREATE INDEX IF NOT EXISTS idx_auto_generations_document_id ON auto_generations (document_id);
`;

export const DDL_COST_SUMMARY = `
CREATE TABLE IF NOT EXISTS cost_summary (
  project_id              TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  day                     DATE NOT NULL,
  generations_count       INTEGER NOT NULL DEFAULT 0,
  llm_tokens_prompt       BIGINT NOT NULL DEFAULT 0,
  llm_tokens_completion   BIGINT NOT NULL DEFAULT 0,
  embedding_calls         INTEGER NOT NULL DEFAULT 0,
  retrieval_calls         INTEGER NOT NULL DEFAULT 0,
  reranker_calls          INTEGER NOT NULL DEFAULT 0,
  cost_usd                NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, day)
);
CREATE INDEX IF NOT EXISTS idx_cost_summary_day ON cost_summary (project_id, day DESC);
`;

/**
 * ── feat-200.7 Week 7：notes（笔记库） ────────────────────────────────────────
 *
 * 用户把心仪的 generation 结果（或自由编辑后的版本）保存到笔记库便于复用 / 对外发布。
 *   - generation_id ON DELETE SET NULL：原 generation 被删后笔记保留（笔记是已脱钩的资产）
 *   - tags 用 TEXT[]：MVP 阶段不做归一化标签库，前端自由填写
 *   - 不存 trace / cost：那些是 generation 的属性，需要时去 generations 查
 *
 * 与 generations 的区别：
 *   generations 是事实记录（所有调用都进表，包括 auto-gen 和失败的）；
 *   notes 是用户筛选过的精品库，体量小，是营销文案/笔记内容的真实出口。
 */

export const DDL_NOTES = `
CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  generation_id TEXT REFERENCES generations (id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_generation ON notes (generation_id);
`;

/**
 * 顺序：users → projects → project_settings → documents → ingestion_jobs → generations → ... → notes。
 * 受外键依赖约束。notes 依赖 generations（可选外键）和 projects，所以放在 generations 之后。
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
  // feat-200.4
  DDL_FEEDBACKS,
  DDL_AUTO_GENERATIONS,
  DDL_COST_SUMMARY,
  // feat-200.7
  DDL_NOTES,
];
