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

/**
 * ── feat-200.8 Week 8：platform_rules（平台合规约束） ──────────────────────────
 *
 * 用户在 Settings 里给项目定义一组"平台规则"——每条规则描述一个目标平台
 * （小红书 / 微博 / 抖音 / 公众号 等）的产出约束。
 *
 * generate 时前端按需带上 platformRuleIds[]，orchestrator 把规则配置注入到
 * prompt-build 的 systemPrompt，并在 generation 完成后跑 RuleValidator 做
 * 后置校验，返回 violations 数组。
 *
 * config JSONB 形状（前后端共享）：
 *   {
 *     maxLength?: number;              // 整段最大字符数
 *     bannedKeywords?: string[];       // 命中即标违规
 *     mandatoryTagPattern?: string;    // 必须出现的 regex（如 "#\\S+" 表示至少一个话题标签）
 *     mandatoryTagMin?: number;        // 匹配次数下限
 *     styleHint?: string;              // 注入到 prompt 的风格提示（自由文本）
 *   }
 *
 *  - enabled 用于"软开关"：禁用的规则不会出现在 Chat 选择器里，但 Settings
 *    管理面板还能看到 / 编辑 / 重启用，不必删除再重建。
 */

export const DDL_PLATFORM_RULES = `
CREATE TABLE IF NOT EXISTS platform_rules (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_rules_project ON platform_rules (project_id, created_at DESC);
`;

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
 * ── feat-300.1 Phase 3.5：Agent 三张表 ────────────────────────────────────────
 *
 * 真 ReAct Agent 的可观测物理底座。透明性是本项目的核心卖点——所有"LLM 在想
 * 什么、调了哪个工具、为什么停下来"都必须落库，前端 AgentTracePanel 才能逐步
 * 回放。
 *
 * agent_runs：一次 Agent 跑的总账（订单表）
 *   - status：'running' → 'succeeded' | 'failed'
 *   - finish_reason：为什么停（done = LLM 自主结束 / max_steps / budget / aborted = 用户中断 / error）
 *   - budget_usd / cost_used_usd：成本闸门，超 budget 触发 fallback
 *   - max_steps / steps_used：步数闸门，防 ReAct 死循环
 *   - eval_scores JSONB：本次 critic_review 最后一次评分（在线 runtime 评估）
 *
 * agent_steps：逐步流水（物流轨迹），AgentTracePanel 的数据源
 *   - step_type：'reasoning' = LLM 想法 / 'tool_call' = 调工具入参
 *                'tool_result' = 工具返回 / 'finish' = LLM 决定收尾
 *                'context_compress' = 历史摘要压缩（也算一步，保证可观测）
 *   - tool_name：仅 tool_call/tool_result 有值
 *   - input/output JSONB：原始结构化数据，前端按 step_type 渲染
 *   - token_usage JSONB：{ prompt, completion, total }，用于 cost 累计
 *   - 强制每步入库：哪怕中途崩溃也要看到前 N 步在干嘛
 *
 * agent_memory：项目级长期偏好（用户画像），跨会话持久
 *   - kind：4 类（preference 通用偏好 / style 风格 / taboo 禁忌 / audience 受众）
 *   - source：'manual' = 用户在 MemoryPanel 手动加 / 'distilled' = 蒸馏自动产生
 *   - source_feedback_ids JSONB：蒸馏来源的 feedback ID 数组，可溯源（防错误学习）
 *   - confidence：0-1，多条 feedback 印证则提升，矛盾则降低；阈值过低的偏好不注入
 *
 * generations.agent_run_id：把老的 generation 记录挂到 agent_run，前端从
 * "生成历史"可点进 trace 详情。NULL 表示走的是老 pipeline（非 agent 模式）。
 *
 * 为什么不用 ENUM 而用 TEXT + CHECK：与项目现有风格一致（见 generations.status），
 * 后续加新枚举值不用 ALTER TYPE，迁移最轻。
 */

export const DDL_AGENT_RUNS = `
CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  generation_id   TEXT REFERENCES generations (id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'running',
  max_steps       INTEGER NOT NULL DEFAULT 12,
  budget_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0.2,
  steps_used      INTEGER NOT NULL DEFAULT 0,
  cost_used_usd   NUMERIC(10, 6) NOT NULL DEFAULT 0,
  finish_reason   TEXT,
  eval_scores     JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  CHECK (status IN ('running', 'succeeded', 'failed')),
  CHECK (finish_reason IS NULL OR finish_reason IN ('done', 'max_steps', 'budget', 'aborted', 'error'))
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_generation ON agent_runs (generation_id);
`;

export const DDL_AGENT_STEPS = `
CREATE TABLE IF NOT EXISTS agent_steps (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  step_index      INTEGER NOT NULL,
  step_type       TEXT NOT NULL,
  tool_name       TEXT,
  input           JSONB,
  output          JSONB,
  token_usage     JSONB,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (step_type IN ('reasoning', 'tool_call', 'tool_result', 'finish', 'context_compress')),
  UNIQUE (run_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps (run_id, step_index ASC);
`;

export const DDL_AGENT_MEMORY = `
CREATE TABLE IF NOT EXISTS agent_memory (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,
  content               TEXT NOT NULL,
  source                TEXT NOT NULL DEFAULT 'distilled',
  source_feedback_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence            NUMERIC(4, 3) NOT NULL DEFAULT 0.5,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (kind IN ('preference', 'style', 'taboo', 'audience')),
  CHECK (source IN ('manual', 'distilled')),
  CHECK (confidence BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory (project_id, kind);
`;

/**
 * feat-300.3 任务 4：扩展 agent_runs.finish_reason CHECK 增加 'aborted' 值。
 *
 * Postgres 不能直接 "ALTER CHECK"——必须 DROP + ADD。约束名是隐式生成的
 * （类似 agent_runs_finish_reason_check），用 DO 块在运行时动态查名删除，
 * 避免 Postgres 跨版本约束名约定差异。
 *
 * 幂等：DROP IF EXISTS + ADD（已存在的约束名两次跑安全）。新库已经在
 * DDL_AGENT_RUNS 里加了正确 CHECK，本块对新库 no-op。
 */
export const DDL_AGENT_RUNS_ADD_ABORTED = `
DO $$
DECLARE
  c_name text;
BEGIN
  -- 查找现有的 finish_reason CHECK 约束名
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'agent_runs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%finish_reason%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agent_runs DROP CONSTRAINT %I', c_name);
  END IF;

  -- 加新版 CHECK（包含 'aborted'）
  ALTER TABLE agent_runs
    ADD CONSTRAINT agent_runs_finish_reason_check
    CHECK (finish_reason IS NULL OR finish_reason IN ('done', 'max_steps', 'budget', 'aborted', 'error'));
EXCEPTION
  WHEN undefined_table THEN
    -- 新库还没有 agent_runs 表时本块 no-op，DDL_AGENT_RUNS 已用新版 CHECK
    NULL;
  WHEN duplicate_object THEN
    -- 约束已存在（重复跑）no-op
    NULL;
END $$;
`;

/**
 * generations 表追加 agent_run_id 列（幂等加列）。
 * 老的 pipeline 模式 NULL；新的 agent 模式写入对应 run id。
 * ON DELETE SET NULL：哪怕 agent_run 被清，generation 仍保留。
 */
export const DDL_GENERATIONS_AGENT_RUN_ID = `
ALTER TABLE generations
  ADD COLUMN IF NOT EXISTS agent_run_id TEXT
  REFERENCES agent_runs (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_generations_agent_run ON generations (agent_run_id);
`;

/**
 * 顺序：users → projects → project_settings → documents → ingestion_jobs → generations → ... → notes
 *      → agent_runs → agent_steps → agent_memory → generations.agent_run_id 加列。
 * 受外键依赖约束。
 *   - agent_runs 依赖 generations + projects → 必须排在它们之后
 *   - agent_steps 依赖 agent_runs
 *   - generations.agent_run_id 反向指向 agent_runs → 在 agent_runs 之后加列
 *
 * 调用方需要 await db.initSchema(client) 在每个请求开头（db.service.ts 已自动处理）。
 * 依赖 CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS 的幂等性。
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
  // feat-200.8
  DDL_PLATFORM_RULES,
  // feat-300.1
  DDL_AGENT_RUNS,
  DDL_AGENT_STEPS,
  DDL_AGENT_MEMORY,
  DDL_GENERATIONS_AGENT_RUN_ID,
  // feat-300.3 task 4：扩展 finish_reason CHECK 加 'aborted'
  DDL_AGENT_RUNS_ADD_ABORTED,
];
