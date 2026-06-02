#!/usr/bin/env node
/**
 * e2e smoke 测试 — feat-200.8 Week 8 验收
 *
 * 走完整链路验证 MVP 8 周交付：
 *   1. 注册 / 登录
 *   2. 创建项目
 *   3. 上传产品文档（md）
 *   4. 等 ingestion 完成
 *   5. 创建一条小红书平台规则
 *   6. 用规则跑一次 generate
 *   7. 校验 violations 字段存在
 *   8. 保存生成结果为笔记
 *   9. 提交一条反馈
 *
 * 任意步骤失败 → 进程 exit 1；全过 → exit 0。
 *
 * 用法：
 *   node scripts/smoke.mjs
 *   API_BASE_URL=http://localhost:3001 node scripts/smoke.mjs
 *
 * 假设：API server 已经跑起来、env 配齐（LLM_API_KEY / EMBEDDING_API_KEY /
 * DATABASE_URL / JWT_SECRET）、postgres 跑着、Ollama embedding 可用。
 */

const BASE = process.env.API_BASE_URL ?? "http://localhost:3001";
const TIMESTAMP = Date.now();
const TEST_USER = {
  email: `smoke-${TIMESTAMP}@test.local`,
  password: "smoke-test-password-1234",
  displayName: "Smoke Tester",
};

// ── HTTP helper ─────────────────────────────────────────────────────────────

let token = null;

async function http(method, path, body, opts = {}) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token && !opts.noAuth) headers["Authorization"] = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined && body !== null && method !== "GET") {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
    if (body instanceof FormData) delete headers["Content-Type"];
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
  if (!res.ok) {
    throw new Error(
      `[${method} ${path}] ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`,
    );
  }
  return json;
}

// ── 步骤封装 + 计时 + 彩色输出 ────────────────────────────────────────────

let stepNum = 0;
async function step(name, fn) {
  stepNum++;
  const start = Date.now();
  process.stdout.write(`\x1b[36m[${stepNum}]\x1b[0m ${name} ... `);
  try {
    const out = await fn();
    const ms = Date.now() - start;
    console.log(`\x1b[32m✓\x1b[0m \x1b[90m(${ms}ms)\x1b[0m`);
    return out;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`\x1b[31m✗ ${err.message}\x1b[0m \x1b[90m(${ms}ms)\x1b[0m`);
    process.exit(1);
  }
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\x1b[1m▶ e2e smoke vs ${BASE}\x1b[0m\n`);

  await step("health check", async () => {
    await http("GET", "/health", null, { noAuth: true });
  });

  await step("注册新用户", async () => {
    const r = await http("POST", "/auth/register", TEST_USER, { noAuth: true });
    if (!r?.token) throw new Error("register 未返回 token");
    token = r.token;
  });

  // 创建项目
  let projectId;
  await step("创建项目", async () => {
    const r = await http("POST", "/projects", {
      name: `Smoke 项目 ${TIMESTAMP}`,
      description: "e2e smoke",
      emoji: "🧪",
    });
    projectId = r.project?.id;
    if (!projectId) throw new Error("创建项目无 id");
  });

  // 上传 product 文档
  let documentId, ingestionJobId;
  await step("上传产品文档", async () => {
    const form = new FormData();
    const content = [
      "# 智能笔记 Pro 产品说明",
      "",
      "## 核心卖点",
      "- 30 天超长待机：单次充电支持 30 天高强度笔记记录",
      "- 200g 轻量化：随身携带不增加负担",
      "- AI 智能总结：自动摘要、关键词标注、知识图谱",
      "- 多端同步：iOS / Android / Web 实时同步",
      "- 离线优先：无网络也能正常使用",
      "",
      "## 目标用户",
      "知识工作者、学生、研究者、内容创作者",
      "",
      "## 使用场景",
      "课堂笔记、会议纪要、读书笔记、灵感速记",
    ].join("\n");
    form.append("file", new Blob([content], { type: "text/markdown" }),
                "smoke-product.md");
    form.append("category", "product");
    const r = await http("POST", `/projects/${projectId}/documents`, form);
    documentId = r.document?.id;
    ingestionJobId = r.ingestionJobId;
    if (!documentId || !ingestionJobId) {
      throw new Error("缺 documentId 或 ingestionJobId");
    }
  });

  // 等 ingestion 完成（最多 30s）
  await step("等 ingestion 完成", async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const r = await http("GET", `/projects/${projectId}/ingestion/${ingestionJobId}`);
      const s = r.job?.status;
      if (s === "succeeded") return;
      if (s === "failed") throw new Error(`ingestion 失败：${r.job?.error}`);
      await sleep(1000);
    }
    throw new Error("ingestion 30s 内未完成（超时）");
  });

  // 创建小红书平台规则
  let ruleId;
  await step("创建平台规则（小红书预设）", async () => {
    const r = await http("POST", `/projects/${projectId}/platform-rules`, {
      name: "小红书",
      config: {
        maxLength: 1000,
        mandatoryTagPattern: "#\\S+",
        mandatoryTagMin: 3,
        bannedKeywords: ["最佳", "第一", "顶级"],
        styleHint: "口语化、亲切、emoji 多",
      },
    });
    ruleId = r.rule?.id;
    if (!ruleId) throw new Error("创建规则无 id");
  });

  // generate with rule
  let generationId;
  let resultNotes;
  let violations;
  await step("generate 带规则（请求耗时较长）", async () => {
    const r = await http("POST", `/projects/${projectId}/generate`, {
      query: "请基于产品资料生成 3 个适合小红书发布的卖点笔记，带话题标签。",
      platformRuleIds: [ruleId],
    });
    generationId = r.generationId;
    resultNotes = r.resultNotes;
    violations = r.violations;
    if (r.status !== "succeeded") {
      throw new Error(`generate status=${r.status}, error=${r.error}`);
    }
    if (!resultNotes) throw new Error("generate 无 resultNotes");
    if (!Array.isArray(violations)) {
      throw new Error("response 缺 violations 数组");
    }
  });

  console.log(`    \x1b[90m生成 ${resultNotes.length} 字符；${violations.length} 处违规\x1b[0m`);

  // 反馈
  await step("提交反馈（4 维评分）", async () => {
    await http("POST", `/generations/${generationId}/feedback`, {
      relevance: 5, accuracy: 4, creativity: 4, overall: 5,
      comment: "smoke test 反馈",
    });
  });

  // 保存到笔记库
  await step("保存为笔记", async () => {
    await http("POST", `/projects/${projectId}/notes`, {
      generationId,
      title: "Smoke 测试笔记",
      content: resultNotes,
      tags: ["smoke", "测试"],
    });
  });

  await step("列笔记（验证已保存）", async () => {
    const r = await http("GET", `/projects/${projectId}/notes`);
    if (!r.notes?.length) throw new Error("笔记列表为空");
  });

  // ── feat-300.7：Agent 全流程 e2e（300.3 + 300.4 + 300.5 链路） ─────────────
  //
  // 在 MVP smoke 之后追加 4 步 agent 验证：
  //   (A) 设 project_settings 让 agent 用得上 LLM（默认空设置 fallback 到 gpt-4o-mini 会 404）
  //   (B) POST /agent/run 验证非阻塞返回 ids（feat-300.6 修的关键 bug）
  //   (C) 轮询 /agent/runs/:id 等 run 跑完，验证 finish_reason='done' + steps ≥ 1
  //   (D) 提多条高分 feedback + POST /memory/distill 验证蒸馏（成功 or no_candidates 都算 OK）
  //
  // 任何一步失败 → 进程 exit 1，CI 直接红。
  console.log(`\n\x1b[1m▶ feat-300 Agent 全流程\x1b[0m`);

  await step("配置项目 LLM settings（让 agent 用得上 GLM/Qwen 兼容协议）", async () => {
    // settings.model 为空时 AgentRunner 硬编码 fallback 到 'gpt-4o-mini'
    // smoke 环境通常没 OpenAI 真 key，所以显式设成 env 里配的 model
    const envModel = process.env.LLM_MODEL || "glm-4-flash";
    await http("PUT", `/projects/${projectId}/settings`, {
      provider: "openai-compat",
      model: envModel,
    });
  });

  let agentRunId, agentGenerationId;
  await step("POST /agent/run 验证非阻塞返回 ids（< 5s）", async () => {
    const start = Date.now();
    const r = await http("POST", `/projects/${projectId}/agent/run`, {
      messages: [{ role: "user", content: "用一句话夸我们的产品" }],
      maxSteps: 3,
      budgetUsd: 0.05,
    });
    const took = Date.now() - start;
    if (!r?.runId) throw new Error("agent/run 未返回 runId");
    if (!r?.generationId) throw new Error("agent/run 未返回 generationId");
    if (took > 5000) {
      // feat-300.6 修的 bug：原来 await 整个 ReAct 60-120s 才返回
      throw new Error(`agent/run 返回慢 ${took}ms，疑似阻塞 bug 复发`);
    }
    agentRunId = r.runId;
    agentGenerationId = r.generationId;
  });

  await step("等 agent 后台跑完（轮询 ≤ 60s）", async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await http("GET", `/projects/${projectId}/agent/runs/${agentRunId}`);
      if (r.status === "succeeded" || r.status === "failed") {
        if (r.status === "failed") {
          throw new Error(`agent run failed: ${r.error ?? "unknown"}`);
        }
        if (!r.finishReason) throw new Error("succeeded 但 finishReason 为空");
        return;
      }
      await sleep(1500);
    }
    throw new Error("agent run 超 60s 未结束");
  });

  await step("验证 agent_steps 有 ≥ 1 步入库", async () => {
    const r = await http("GET", `/projects/${projectId}/agent/runs/${agentRunId}/steps?limit=50`);
    const arr = Array.isArray(r) ? r : r?.steps;
    if (!Array.isArray(arr) || arr.length < 1) {
      throw new Error(`agent_steps 为空或非数组: ${JSON.stringify(arr).slice(0, 100)}`);
    }
  });

  // 准备 distill：先提一条高分 feedback（distiller 阈值默认 5 条，但手动 distill 会跑现有的）
  await step("对 agent 输出提一条高分 feedback（含 edit_diff）", async () => {
    await http("POST", `/generations/${agentGenerationId}/feedback`, {
      relevance: 5,
      accuracy: 5,
      creativity: 4,
      overall: 5,
      editDiff: "（用户改写版本）这产品真的太好用了——简洁、稳定、贴心。",
      comment: "smoke：模拟用户改写后的最终版本",
    });
  });

  await step("POST /memory/distill 手动触发蒸馏", async () => {
    // 手动触发返回形状：{ inserted, merged, processed, skipped? }
    // （`triggered` 字段只在 auto 路径 @OnEvent 的 maybeDistill 返回，REST 端点不带）
    const r = await http("POST", `/projects/${projectId}/memory/distill`);
    const result = r?.result ?? r;
    if (typeof result?.processed !== "number") {
      throw new Error(`distill 返回结构异常: ${JSON.stringify(result).slice(0, 200)}`);
    }
    // 合法终态：
    //   inserted/merged > 0（蒸馏出新偏好）
    //   skipped='no_new_feedback' / 'no_candidates' / 'in_flight'
    const ok =
      result.inserted > 0 ||
      result.merged > 0 ||
      result.skipped === "no_new_feedback" ||
      result.skipped === "no_candidates" ||
      result.skipped === "in_flight";
    if (!ok) {
      throw new Error(`distill 异常状态: ${JSON.stringify(result).slice(0, 200)}`);
    }
    const counts = result.skipped
      ? `skipped=${result.skipped}`
      : `inserted=${result.inserted ?? 0} merged=${result.merged ?? 0} processed=${result.processed}`;
    process.stdout.write(`\x1b[90m${counts}\x1b[0m `);
  });

  await step("GET /memory 验证表可读（不强制有内容）", async () => {
    const r = await http("GET", `/projects/${projectId}/memory`);
    if (!Array.isArray(r?.memory)) {
      throw new Error(`memory 列表结构异常: ${JSON.stringify(r).slice(0, 100)}`);
    }
    process.stdout.write(`\x1b[90m${r.memory.length} 条偏好\x1b[0m `);
  });

  console.log(`\n\x1b[32m\x1b[1m✓ All ${stepNum} steps passed.\x1b[0m`);
  console.log(`\x1b[90m用户：${TEST_USER.email}\x1b[0m`);
  console.log(`\x1b[90m项目：${projectId}\x1b[0m`);
  console.log(`\x1b[90mAgent run：${agentRunId}\x1b[0m`);
}

main().catch((err) => {
  console.error("\n\x1b[31m\x1b[1mFATAL:\x1b[0m", err);
  process.exit(1);
});
