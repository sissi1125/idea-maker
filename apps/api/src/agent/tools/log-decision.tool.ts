/**
 * log_decision tool — feat-300.2 Phase 3.5
 *
 * 给 agent 一个显式记录"我决定 X，理由 Y"的口子，写到 agent_steps 表里 step_type='reasoning'。
 *
 * 为什么单独成 tool 而不是依赖 ai-sdk onStepFinish 自动记录每步 reasoning：
 *   1. onStepFinish 记的是"LLM 的中间 reasoning 文本"，颗粒粗，可能整段几百字
 *   2. log_decision 让 agent 主动用结构化的 (choice, reasoning) 记录关键决策点：
 *      "我选择不再调 search_web 因为前两次结果都没增量"
 *      这种"反思性总结"比 raw reasoning 对 trace 回放和 memory distillation 更有价值
 *   3. distiller 可以从 log_decision 记录里学到"这个用户什么时候会停手"，比从
 *      raw reasoning 文本提炼更准
 *
 * 写入方向：agent_steps 表，step_type='reasoning'（不是新建 step_type）
 *   - 复用现有 step_type 集合，不污染 schema
 *   - tool_name='log_decision' 在 SELECT 时可以 WHERE 过滤出"显式决策"
 */

import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { DbClient as PgClient } from "../../db/db-client";
import type { AgentToolContext, AgentToolFactory } from "./types";

const ParamsSchema = z.object({
  choice: z.string().min(1).describe("一句话总结的决策结果，如：'决定使用 search_kb 而非 search_web'"),
  reasoning: z.string().min(1).describe("做出该决策的理由，越具体越好"),
});

const DESCRIPTION = `记录一个关键决策到 trace。

什么时候调用：
- 你在两条路径间做了选择，且选择理由对后续步骤重要
- 你决定"停下不再调更多 tool"——记一笔说明为什么足够了
- 你识别到 evidence 互相矛盾，决定信哪一边

什么时候不要调：
- 日常每步思考都记一笔（太啰嗦，浪费 token）
- 决策内容已经显而易见（例如 search_kb 返回空 → 改 search_web，无需记）

返回：{ stepId, recordedAt }。这一步会出现在 AgentTracePanel 的时间轴上。`;

const INSERT_SQL = `
INSERT INTO agent_steps (id, run_id, step_index, step_type, tool_name, input, output)
VALUES (
  $1, $2,
  COALESCE((SELECT MAX(step_index) + 1 FROM agent_steps WHERE run_id = $2), 0),
  'reasoning', 'log_decision', $3::jsonb, $4::jsonb
)
RETURNING id, created_at
`;

interface InsertRow {
  id: string;
  created_at: Date;
}

export const buildLogDecisionTool: AgentToolFactory = (ctx: AgentToolContext) =>
  tool({
    description: DESCRIPTION,
    parameters: ParamsSchema,
    execute: async ({ choice, reasoning }) => {
      const pg = ctx.pgClient as PgClient;
      const stepId = randomUUID();

      // 注：step_index 用 SELECT MAX 子查询是简易方案。AgentRunner 真正接管后
      // 会用单调递增的 in-memory counter 注入到 ctx，避免并发 race；本期 tool 单独被
      // 调用（不并发）所以子查询安全。TODO(concurrency): 接 AgentRunner 后改 counter。
      const { rows } = await pg.query<InsertRow>(INSERT_SQL, [
        stepId,
        ctx.runId,
        JSON.stringify({ choice }),
        JSON.stringify({ reasoning }),
      ]);

      return {
        status: "ok" as const,
        stepId: rows[0].id,
        recordedAt: rows[0].created_at.toISOString(),
      };
    },
  });
