# 阶段 2+ 详细路线图

> 本文档承接 `docs/PRODUCT.md` 的阶段规划，是 feat-010 至 feat-013 系列的执行级实施计划。
> 每个 feature 段落含：**用户故事 / 关键文件 / API 设计 / 验收标准 / 简历亮点**。

## 总览

```
当前位置（阶段 2 收尾）
    │
    ├─ feat-006  RAG Quality Evaluation        [todo]  ← 先收尾
    └─ feat-008  Eval Matrix CLI               [todo]  ← 先收尾
    ↓
阶段 3：Agent 自动化层
    ├─ feat-010  Pipeline Orchestration Agent  (Plan-and-Execute)
    │   ├─ 010.1 核心循环引擎
    │   ├─ 010.2 AutoRun Modal
    │   └─ 010.3 AgentProgressPanel
    └─ feat-011  Content Generation Agent      (ReAct + Tools)
        ├─ 011.1 4 个工具实现
        ├─ 011.2 ReAct 循环引擎
        └─ 011.3 ContentAgentPanel
    ↓
阶段 4：Marketing Studio UX
    └─ feat-012  Studio 工作流
        ├─ 012.1 /studio/[runId] 路由 + 四列看板
        ├─ 012.2 踩赞反馈与 regenerate API
        ├─ 012.3 Content Directions 中间层
        └─ 012.4 帖子扩展 + PostTemplate
    ↓
阶段 5：工程化与生产部署
    └─ feat-013  工程化系列
        ├─ 013.1 Lucia Auth
        ├─ 013.2 Workspace 多租户
        ├─ 013.3 BYOK API Key 管理
        ├─ 013.4 Drizzle ORM 迁移
        └─ 013.5 Fly.io 部署
```

**优先级原则**：先把阶段 2 的两个 todo 收尾，再进阶段 3。**不要把阶段 5 的 Auth 提前到阶段 3** —— Agent 层与 Auth 解耦能让两边都更聚焦。

---

## 阶段 3：Agent 自动化层

### feat-010 Pipeline Orchestration Agent

#### 用户故事
> 作为独立开发者，我已经选好了文档，希望点一个按钮就能从 ingestion 一直跑到生成营销 idea，途中能看到每一步在做什么，失败了能从断点继续。

#### 设计核心：Plan-and-Execute

**为什么不用 ReAct**：pipeline 顺序已由 `app/lib/pipelineDeps.ts` 的 `STAGE_DEPS` 图静态确定，无需 LLM 动态推理「下一步做什么」。用 ReAct 只会增加 token 消耗和不可预测性，违背可调试原则。

**为什么客户端循环而非服务端**：Vercel serverless 默认 30s 超时，整条 pipeline 可能超时；客户端循环无此限制，且 `handleRun`（`PlaygroundShell.tsx`）逻辑已验证可用。

#### 关键文件
| 文件 | 改动 |
|------|------|
| `app/lib/pipelineAgent.ts` | **新增**：核心循环引擎 |
| `app/components/agent/AutoRunModal.tsx` | **新增**：预运行配置 |
| `app/components/agent/AgentProgressPanel.tsx` | **新增**：进度时间线 |
| `app/components/playground/PlaygroundShell.tsx` | 修改：Header 加按钮 + 切换 panel |
| `app/lib/pipelineDeps.ts` | 复用：`resolveEffectiveUpstream` / `isStageActive` |
| `app/lib/pipelineStages.ts` | 复用：`PIPELINE_STAGES` 顺序列表 |

#### 核心类型
```typescript
// app/lib/pipelineAgent.ts

export interface AgentRunConfig {
  documentId: string;
  enabledSteps: Set<string>;
  stageParamsMap: Record<string, Record<string, unknown>>;
  defaultQueries: string[];        // 预设 3 个营销向 query
  pauseAfterIngestion: boolean;
}

export type AgentProgressEvent =
  | { type: "stage_started"; stageId: string }
  | { type: "stage_completed"; stageId: string; output: unknown; durationMs: number }
  | { type: "stage_failed"; stageId: string; error: { code: string; message: string } }
  | { type: "paused"; reason: "user_request" | "ingestion_checkpoint" | "stage_failure" }
  | { type: "done"; totalDurationMs: number; runId: string };

export async function* runPipeline(
  config: AgentRunConfig,
  results: Map<string, unknown>
): AsyncGenerator<AgentProgressEvent> { /* 顺序循环调 handleRun */ }
```

#### 验收标准
- [ ] 选定文档 → 点「一键生成」→ 弹出 Modal → 确认 → 时间线展开
- [ ] 每个 stage 完成时 progress 实时刷新
- [ ] 任意 stage 失败 → agent 暂停 + 错误高亮 + 可重试
- [ ] 全部完成 → 跳转 Marketing Studio（feat-012 上线后）
- [ ] Pipeline trace drawer 中能看到完整 run 历史

#### 简历亮点
- **Plan-and-Execute vs ReAct 取舍**："我们的领域是确定性的，用 ReAct 只增加复杂度"
- **客户端循环规避 serverless 超时**：架构权衡的实例
- **断点续跑**：复用已有 stage_snapshots 表，故障恢复 0 额外存储

---

### feat-011 Content Generation ReAct Agent

#### 用户故事
> 作为独立开发者，我希望 AI 不要只生成一个平庸的 idea 就交差。它应该自己评估生成质量，发现 hook 太弱时主动换角度重试，最多 3 次。我可以随时打断或指定方向。

#### 设计核心：ReAct with Tools

**为什么这里用 ReAct**：内容质量迭代次数不确定，agent 需要「观察评分 → 推理下一步动作」，是真正的动态决策循环。**与 feat-010 形成对比**：两种 agent 模式各司其职，是项目最大的简历亮点之一。

#### 工具集（4 个）

```typescript
// app/lib/contentAgentTools.ts

// Tool 1: 生成 ideas
async function generate_ideas(
  angle: string,
  evidence: EvidenceItem[],
  platform: Platform,
  format: ContentFormat
): Promise<ContentIdea[]>

// Tool 2: 评估 hook（双层评估）
async function evaluate_hook(idea: ContentIdea): Promise<{
  score: number;                 // 0-10
  dimensions: {
    emotional_impact: number;
    curiosity: number;
    platform_fit: number;
  };
  feedback: string;              // "hook 平铺直叙，缺乏悬念感"
}>
// 实现：先规则预检（0 token），通过的候选项再 LLM 精评

// Tool 3: 验证证据覆盖
async function evaluate_evidence(
  idea: ContentIdea,
  evidence: EvidenceItem[]
): Promise<{ coverage: number; uncited_claims: string[] }>

// Tool 4: 推荐下一个角度
async function suggest_angle(
  feedback: string,
  tried_angles: string[]
): Promise<{ new_angle: string; rationale: string }>
// 角度库：痛点故事型 / 教程型 / 对比型 / 悬念开头型 / 数据佐证型 / 场景代入型
```

#### evaluate_hook 双层评估实现要点

**规则预检（同步、0 token）**：
- hook 长度 < 10 字 → score 上限 4
- 不含动词或感叹/疑问标点 → score 上限 5
- 完全是产品名 + 功能描述句式 → score 上限 5

**LLM 精评（异步、消耗 token）**：
- 仅对规则预检 ≥ 5 的候选项调用
- System prompt：「你是一个挑剔的小红书重度用户，每天刷 200 条笔记，对营销味重的内容会立刻划走」
- 输出 JSON：3 个维度评分 + 综合分 + 一句话反馈

#### ReAct 循环逻辑

```typescript
// app/lib/contentAgent.ts

export async function* runContentAgent(config: ContentAgentConfig) {
  let angle = config.initialAngle;
  const triedAngles: string[] = [];
  const iterations: IterationResult[] = [];

  for (let i = 0; i < config.maxIterations; i++) {
    yield { type: "iteration_started", iteration: i, angle };

    // ACT 1: generate
    const ideas = await generate_ideas(angle, config.evidence, config.platform, config.format);
    yield { type: "ideas_generated", ideas };

    // ACT 2: evaluate hook
    const hookEval = await evaluate_hook(ideas[0]);
    yield { type: "hook_evaluated", evaluation: hookEval };

    iterations.push({ angle, ideas, hookScore: hookEval.score });
    triedAngles.push(angle);

    // 终止条件 1: 通过质量门槛
    if (hookEval.score >= config.threshold) {
      yield { type: "passed", finalIteration: iterations.at(-1) };
      return;
    }

    // 终止条件 2: 达到最大迭代
    if (i === config.maxIterations - 1) {
      const best = iterations.reduce((a, b) => b.hookScore > a.hookScore ? b : a);
      yield { type: "max_reached", bestIteration: best };
      return;
    }

    // ACT 3: 决策换角度
    const suggestion = await suggest_angle(hookEval.feedback, triedAngles);
    yield { type: "angle_switching", new_angle: suggestion.new_angle, rationale: suggestion.rationale };

    angle = suggestion.new_angle;
  }
}
// 终止条件 3（用户接管）由 UI 层 abort signal 实现
```

#### 关键文件
| 文件 | 改动 |
|------|------|
| `app/lib/contentAgentTools.ts` | **新增**：4 个独立工具函数 |
| `app/lib/contentAgent.ts` | **新增**：ReAct 循环 |
| `app/components/agent/ContentAgentPanel.tsx` | **新增**：迭代卡片 + 接管按钮 |
| `app/lib/providers.ts` | 复用：LLM client |
| `app/app/api/pipeline/generation/route.ts` | 复用：作为 generate_ideas 的底层实现 |

#### 验收标准
- [ ] 给定一个有水分的产品文档，agent 至少能跑出 2 次迭代且评分递增
- [ ] hook 评分 ≥ 7 时自动停止
- [ ] 用户点「接受当前版本」可立即停止
- [ ] 「手动指定角度」可注入并触发一次新迭代
- [ ] 完整迭代历史持久化到 pipeline_run_history（便于 Studio 复用）

#### 简历亮点
- **两种 Agent 模式都实现**：Pipeline (Plan-and-Execute) + Content (ReAct)，对比适用场景
- **evaluate_hook 双层评估**：规则预检 + LLM 精评，成本与质量的工程权衡
- **三重终止机制**：质量门槛 + 最大迭代 + 用户接管，防止无限循环

---

## 阶段 4：Marketing Studio UX

### feat-012 Studio 工作流

#### 用户故事
> 作为独立开发者，我希望生成结果不要是 JSON 列表，而是一个像 Trello 看板的页面：选卖点 → 看营销方向 → 挑 idea → 一键展开成完整帖子，过程中能踩赞反馈让 AI 重新生成而不用从头跑 pipeline。

#### Studio 路由布局

```
/studio/[runId]
┌────────────┬────────────┬────────────┬────────────┐
│   卖点      │  营销方向   │  Content   │  扩展为     │
│  (Selling   │  (Content  │  Ideas     │  完整帖      │
│  Points)    │  Direct.)  │            │  (PostExp.) │
│            │            │  (踩 / 赞) │  (Drawer)   │
└────────────┴────────────┴────────────┴────────────┘
   选中 → 过滤    选中 → 过滤   选中 → 展开
```

#### 关键 API

**POST /api/marketing/regenerate-idea**
```typescript
// 不重跑整条 pipeline 的关键设计
{
  runId: string;
  ideaIndex: number;
  reason: "down_vote" | "manual_request";
  angleHint?: string;
  excludeAngles: string[];
}
→ ContentIdea  // 单个替换 idea
// 内部：读 stage_snapshots 拿 evidence pack，仅调 /api/pipeline/generation
```

**POST /api/marketing/expand-idea**
```typescript
{
  runId: string;
  idea: ContentIdea;
  platform: "xiaohongshu" | "twitter" | "linkedin" | "wechat";
  targetAudience: string;
  tone: "story" | "tutorial" | "comparison" | "list" | "question";
}
→ PostTemplate {
  hook: string;
  body: string[];      // 3-5 段
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  evidenceIds: string[];
  characterCount: number;
}
```

#### 数据库新增表

```sql
CREATE TABLE idea_feedback (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  idea_index INTEGER NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('up', 'down')),
  angle_override TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_idea_feedback_run ON idea_feedback(run_id);
```

#### 关键文件
| 文件 | 改动 |
|------|------|
| `app/app/studio/[runId]/page.tsx` | **新增**：路由入口 |
| `app/components/studio/IdeaBoardColumn.tsx` | **新增**：通用看板列 |
| `app/components/studio/IdeaCard.tsx` | **新增**：含踩赞 |
| `app/components/studio/PostExpansionDrawer.tsx` | **新增**：抽屉 |
| `app/components/studio/PlatformMockup.tsx` | **新增**：CSS 手机框 |
| `app/app/api/marketing/regenerate-idea/route.ts` | **新增** |
| `app/app/api/marketing/expand-idea/route.ts` | **新增** |
| `app/app/api/pipeline/generation/route.ts` | 修改：新增 `content-directions` method |
| `app/lib/snapshotDb.ts` | 修改：加 `idea_feedback` 表 |

#### 验收标准
- [ ] Pipeline Agent 完成后能跳转到 `/studio/[runId]` 看到看板
- [ ] 踩某个 idea + 填角度 → 5 秒内得到替换 idea（不重跑 pipeline）
- [ ] 点 idea 的「扩展为帖」→ Drawer 中展示手机框预览 + 复制按钮
- [ ] 四个平台模板各有差异（字数限制 / hashtag 风格）
- [ ] 所有 PostTemplate 仍保留 evidenceIds，可点回查证据

#### 简历亮点
- **反馈迭代不重跑 pipeline**："evidence pack 缓存在 snapshot，只换 generation prompt"
- **平台感知的内容生成**：不同平台 prompt 不同，hashtag 策略不同
- **看板式 UX**：从开发者工具升级为面向终端用户的工作流

---

## 阶段 5：工程化与生产部署

### feat-013 系列

#### 用户故事
> 作为求职者，我希望这个项目能上线、能演示给雇主、能让面试官真的注册账号试用。同时项目用户填的 API Key 不能泄露，多个用户的数据不能串扰。

#### feat-013.1 Lucia Auth

**为什么 Lucia 不用 NextAuth**：
- NextAuth (Auth.js v5) 在 App Router 下配置复杂、文档碎片化
- Lucia v3 更透明、TypeScript 友好、好在面试中解释
- 自带 PostgreSQL adapter，与现有 pg 栈无缝

**Token 策略**：
- Access token：15min，存 httpOnly cookie
- Refresh token：7 天，存 `user_sessions` 表
- 防 XSS：禁用 localStorage 存 token

**关键文件**：
```
app/lib/auth.ts                    # Lucia 实例
app/middleware.ts                  # validateRequest 注入
app/app/auth/(login|signup)/page.tsx
app/app/api/auth/{login,logout,signup,refresh}/route.ts
```

#### feat-013.2 Workspace 多租户

**应用层 isolation（不用 PostgreSQL RLS）**：
- RLS 配置复杂、调试困难，对一人项目过重
- 应用层在每个 API route 注入 `workspace_id` 过滤，足够安全

**Schema 改动**：在以下表加 `workspace_id TEXT NOT NULL`：
- `rag_documents` / `rag_chunks` / `stage_snapshots` / `pipeline_run_history` / `idea_feedback`

**Migration 策略**：先加列允许 NULL → 回填默认 workspace → 加 NOT NULL 约束。

#### feat-013.3 BYOK API Key 管理

**为什么 BYOK（Bring Your Own Key）**：
- 目标用户是独立开发者，他们都有自己的 API Key
- 项目不做按量计费 → 不用接 Stripe → 项目复杂度大降
- 用户的 token 消费走自己账户 → 项目无成本风险

**加密存储**：
```typescript
// app/lib/cryptoVault.ts
import crypto from "crypto";

const VAULT_KEY = process.env.VAULT_KEY!;  // 32 字节 base64

export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(VAULT_KEY, "base64"), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}
```

**Provider 读取顺序**（修改 `providers.ts`）：
1. 用户在 form 里临时填入 → 优先（不持久化）
2. 用户在 Settings 里保存的 DB key → 次之
3. 系统 env var → fallback

#### feat-013.4 Drizzle ORM 迁移

**渐进迁移策略**（不要一次性重写）：
1. 加入 Drizzle 依赖 + schema 文件
2. 第一波：迁 `snapshotDb.ts`（surface 最小，4 个函数）
3. 第二波：迁 `docStore.ts`（dev JSON + PG 双实现）
4. 第三波：迁所有 API route 的查询
5. 清理 raw pg 代码

**功能开关**：`USE_DRIZZLE=true` env var 控制实现切换，保证可回滚。

#### feat-013.5 Fly.io 部署

**为什么不用 Vercel**：
- pymupdf Python sidecar 必须 Docker 部署
- Vercel 的 managed Postgres 不保证 pgvector 版本

**Fly.io 配置**：
```toml
# fly.toml
app = "marketing-rag-playground"

[[services]]
  internal_port = 3000
  protocol = "tcp"
  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

[[services]]
  internal_port = 8001
  name = "pymupdf"
```

**CI**：GitHub Actions 在 PR 时跑 `typecheck + lint + build`，合并到 main 后 `fly deploy`。

#### 验收标准（整个 feat-013 系列）
- [ ] 多个用户注册 → 各自数据完全隔离（互相看不到）
- [ ] 用户填的 API Key 在数据库里是密文，日志中不出现
- [ ] 公网 URL 可访问，能从头跑完一整条 pipeline + Content Agent
- [ ] CI 在 PR 时阻塞不合规代码

#### 简历亮点
- **JWT vs session cookies**：httpOnly cookie + 双 token 模式，防 XSS
- **应用层 vs DB 层多租户**：架构取舍的实例
- **BYOK 模式**：避开计费系统的工程取舍
- **渐进式 ORM 迁移**：双实现共存 + feature flag，零风险切换

---

## 总验证清单

每个 feature 完成后，必须确认：

- [ ] `feature_list.json` 状态从 `todo` 改为 `done`，填写 evidence
- [ ] `.interview/<feat-id>_<topic>.md` 写好面试题（AGENTS.md 规定）
- [ ] `docs/API_CONTRACTS.md` 同步新端点契约
- [ ] `progress.md` 记录改动 + 验证结果
- [ ] `session-handoff.md` 更新当前状态 + 下一步
- [ ] Playground 仍可用，已有 stage 无回归
- [ ] `npm run typecheck && npm run lint` 通过

## 排期估算（参考）

| 阶段 | feature | 周数（一人 part-time） |
|------|---------|----------------------|
| 收尾 | feat-006 + feat-008 | 1-2 周 |
| 阶段 3 | feat-010 (Pipeline Agent) | 2-3 周 |
| 阶段 3 | feat-011 (Content Agent) | 3-4 周 |
| 阶段 4 | feat-012 (Marketing Studio) | 4-5 周 |
| 阶段 5 | feat-013 (工程化) | 5-7 周 |
| **合计** | | **~4 个月** |

按这个节奏推，3-4 个月后能拿到一个完整、可上线、可演示的简历项目。
