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
 * 顺序：users → projects → project_settings（受外键依赖约束，顺序敏感）。
 *
 * 调用方需要 await initFeat200Schema(client) 在每个请求开头。
 * 与 SnapshotsService 一致，依赖 CREATE TABLE IF NOT EXISTS 的幂等性。
 */
export const FEAT_200_DDL_BLOCKS = [DDL_USERS, DDL_PROJECTS, DDL_PROJECT_SETTINGS];
