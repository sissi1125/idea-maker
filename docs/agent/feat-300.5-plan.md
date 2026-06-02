# feat-300.5 实施规划：Agent 评估体系（offline eval + LLM-as-judge + CI）

> 本文记录 feat-300.5 启动前的设计决策与实现细节。
>
> **特别标注「易忽略点」段落 ⚠️ —— 这些是面试常考的工程细节**，比显眼的功能模块更值钱。

---

## 1. 范围与目标

把 feat-300.1（schema/LLM）/ 300.2（8 tools）/ 300.3（Runner）/ 300.4（Memory）真正"持续可信"。新增：

- **Golden 集** — 文件形态的回归测试集（query + expectedTools + referenceAnswer + thresholds）
- **GoldenLoader** — fs sync 读 + 字段校验 + id 冲突检测
- **JudgePrompt** — LLM-as-judge v1：三维（faithfulness/completeness/style）1-5 + rationale
- **TrajectoryMatch** — expected vs actual tool 集合相似度（precision/recall/jaccard/fullCover）
- **EvalRunner** — 主循环：对每条 golden 跑 AgentRunner.run → judge 评分 → trajectory 对比 → 入库
- **EvalRepository** — eval_runs / eval_items CRUD + baseline 查询
- **EvalService** — promote-feedback-to-golden 闭环
- **EvalController** — REST：POST /eval/run / GET /eval/runs / GET /eval/runs/:id / POST /eval/golden/from-feedback/:generationId
- **CLI** — `pnpm eval` + 退出码 0/1/2 ⚠️
- **DDL** — eval_runs / eval_items 双表 + baseline_run_id 自关联 ⚠️

**不在本期**：前端 EvalReport.tsx（feat-300.6）/ 并行跑 golden（feat-300.7）/ Eval SSE 进度流 / 7 天移动平均 baseline / 分布式锁。

---

## 2. 已确认的设计决策

| 决策 | 选项 | 理由 |
|---|---|---|
| Golden 存储 | 文件 `apps/api/src/eval/golden/*.json` | git 跟踪 + PR review + 跨环境一致；DB 散落无法 blame |
| 测试方法 | 直调 `AgentRunner.run` | 测的就是生产路径，避免 eval/生产分叉；agent_run_id 入库可回放 trace |
| Judge LLM | 与 agent 共用项目 BYOK | 不引入第二套配置；未来用不同 provider 做交叉评估留 300.7 |
| 评分维度 | faithfulness/completeness/style 三维 1-5 | 与 feedbacks 量纲一致，便于 promote 闭环；锚点 1/3/5 减少 LLM 漂移 |
| passed 判定 | 三维 AND + jaccard ≥ 0.5 | AND 防"单维灾难被 avg 掩盖"；trajectory 门防"投机取巧拿高分" ⚠️ |
| Trajectory 比较 | 集合相似度（去重） | ReAct 路径有非确定性，序列比较会大量误判 ⚠️ |
| Baseline 选取 | 最近一次 succeeded（同 project） | 简单稳定；7 天移动平均留 300.7 |
| CI 阈值 | thresholdDrop=0.5（avgOverall 下降） | 配合 1-5 量纲意味着「半档落差」即报警 |
| 退出码 | 0/1/2 三态 | 区分「业务回归（block merge）」与「执行异常（通知 ops）」⚠️ |
| Golden 文件写入 | 严格目录白名单 + 文件存在不覆盖 | 防越权写盘 + 防误覆盖人工手改的 reference |
| Schema 触发 | DDL_EVAL_RUNS / DDL_EVAL_ITEMS 加入 FEAT_200_DDL_BLOCKS 末尾 | 与既有 DDL 风格一致（IF NOT EXISTS 幂等）|
| 写库时机 | 每条 item 独立 withClient appendItem | 单 item 慢不阻塞其他 item 的写入；avoid 长时间占用单一连接 ⚠️ |

---

## 3. ⚠️ 易忽略点（面试重点）

### 3.1 退出码 0/1/2 的语义分离

**问题**：CI 看到红色，PR 作者无法分辨"我的代码引入回归"还是"OpenAI 临时挂了"。

**实现**：
- `0` = eval 跑通且无回归 → 绿
- `1` = eval 跑通但 avgOverall 相比 baseline 下降 > thresholdDrop → **业务回归**，block merge
- `2` = eval 执行异常（LLM 配置错 / DB 连不上 / golden 解析失败）→ **基础设施问题**，通知 ops，不归责作者

**面试卖点**：
- 类比 Unix 程序对 SIGKILL(137)/SIGTERM(143) 的区分
- 单一红绿语义会"训练 PR 作者忽略 CI"，因为相当一部分红是非作者引起的
- 配合 GitHub Actions：`if: ${{ steps.eval.outcome == 'failure' && steps.eval.outputs.exit_code == '1' }}` 区分通知策略

### 3.2 trajectory 集合相似度 vs 序列相似度

**问题**：ReAct agent 的工具调用顺序有合法的非确定性。

**实现**：
- precision = |A∩E| / |A|
- recall = |A∩E| / |E|
- jaccard = |A∩E| / |A∪E|
- fullCover = E ⊆ A
- expected 为空 → 全 1（不关心路径）；actual 为空但 expected 非空 → 全 0

**面试卖点**：
- 序列严格要求会让"先 search_history 再 search_kb"和反过来都正确的 case 误判
- 重复 actual 去重（agent 多次 search_kb 改 query 应视为 1 次）
- 未来要测"先 search 再 generate"这类弱时序约束，再加独立的 `order-pattern` 函数

### 3.3 passed = 三维 AND + jaccard ≥ 0.5 而非 avg ≥ 阈值

**问题**：avg=4 可能是 (faithfulness=2, completeness=5, style=5)，**幻觉灾难被掩盖**。

**实现**：
- 每维度 per-item 在 golden 里配阈值（thresholds.faithfulness 等）
- 三维都过门 + jaccard ≥ 0.5 才算 passed
- jaccard 门防止"agent 输出文本不错但路径完全偏（跳过 search 直接编）"

**面试卖点**：
- 生产中"幻觉一票否决"通常比"平均分上 4"重要得多
- 文案 / 合规 / 头脑风暴场景的阈值差异（per-item 配置而非全局）

### 3.4 baseline + thresholdDrop 防止"分数缓慢漂移"

**问题**：只看绝对线，每周 -0.03 看起来都过，6 个月后已经从 4.5 跌到 3.6。

**实现**：
- 每次 eval_run 创建时查 `WHERE project_id=$1 AND status='succeeded' ORDER BY finished_at DESC LIMIT 1` 作为 baseline
- baseline_run_id 写入当前 run（事后可追溯"当时跟谁比")
- summary.deltaVsBaseline = avgOverall - baseline.avgOverall
- shouldFailCI = -delta > thresholdDrop

**面试卖点**：
- 同时设"绝对线（passed_rate < 80%）"和"相对线（avgOverall 退步 > 0.5）"，互补
- 单纯相对线会被"每次退一点点"绕过；单纯绝对线对慢性退化盲目
- 7 天移动平均做 baseline 替代"上次跑"是 300.7 优化点

### 3.5 EvalRunner 直接调 AgentRunner.run 而非 mock

**问题**：如果 EvalRunner 内部拼简化版 ReAct 跑，会出现"eval 通过但生产挂"。

**实现**：
- EvalRunner 是 AgentRunner 的"测试外壳"——它不重写 LLM 主循环，反复调用 `agentRunner.run` + 评分
- 同一份 prompt / tools / BYOK 配置
- eval_items.agent_run_id 写进库 → 点进 trace UI 可回放

**面试卖点**：
- "集成测试 + 回归监控"二合一
- 代价：30 条 golden 串行 ≈ 60s+，慢；并行需要 BYOK rate-limit 控制留 300.7
- 防"测试代码自我证明"陷阱（mock 路径与生产路径分叉）

### 3.6 promote-feedback-to-golden 的闭环价值

**问题**：开发手写 golden 有偏见，捕捉不到真实长尾。

**实现**：
- 资格门：overall ≥ 4（高分项才入回归集）
- referenceAnswer 优先用 **edit_diff**（用户改写后的版本比原 LLM 输出更接近"理想"）
- expectedTools 从该 generation 关联的 agent_steps 自动反推（agent_run_id 链路）
- 写文件而非入库 → 仍走 PR review（"半自动"语义）

**面试卖点**：
- feedbacks→memory（300.4）和 feedbacks→eval（300.5）双闭环
- "测试集随真实使用进化"——开发不用猜用户会问什么
- 防止覆盖：existsSync 检查 + 路径白名单（防 goldenId 含 `../`）

### 3.7 单 item 失败不阻整批 + 独立 withClient

**问题**：30 条 golden 跑到第 7 条 LLM 超时，前 6 条要不要保留？

**实现**：
- runOne 内部 try/catch 单 item，错误存到 EvalItemResult.error 字段，passed=false 继续下一条
- 每条 item 独立 `withClient(appendItem)`，避免单一连接被整批跑占用 60s+
- 循环外致命错（如 LLM 配置错）才 break，并把已跑出来的成绩 finalize 入库

**面试卖点**：
- 批处理任务的可恢复性："看到前 N 条在干嘛" > "全跑完才有结果"
- DB 连接池稀缺资源（同 300.3-plan §3.6 的连接生命周期讨论）

### 3.8 Judge prompt 的「不必模仿措辞」约束

**问题**：LLM judge 容易把"和 reference 不一样"当成"错"。

**实现**：
- prompt 显式声明：「候选不必模仿参考的措辞。**只要表达力相当、信息正确，措辞不同也给 5 分。**」
- 锚点 1/3/5 给具体描述，减少 judge 主观
- rationale 必填，方便人工 review 时发现"分数 vs 理由不一致"的 case

**面试卖点**：
- LLM-as-judge 的最大风险是"评委自己不稳定"——同一对 (ref, cand) 两次评分可能不一致
- 对冲：低温度 + 锚点 + rationale + 未来用不同 provider 做 judge 防"自评偏袒"
- 终极对冲：保留人工 review 入口（promote API + PR review），让人类标注做 ground truth

### 3.9 golden 文件加载用 fs sync 而非 import.meta.glob

**问题**：ts-node / nest build / vitest 三个运行环境对 glob 支持不一。

**实现**：
- `readdirSync` + 过滤 `.json` + 逐文件 `JSON.parse`
- 解析失败抛错带文件名（不静默吞，测试集错误必须立即可见）
- id 冲突抛错（同 id 两个文件会让 baseline 对比错乱）

**面试卖点**：
- "加载发生在启动时一次性，不在请求路径，sync 性能足够"
- 失败必须明显（fail loud）vs 静默 fallback（fail silent）的权衡

### 3.10 DDL 顺序：先定义 EVAL DDL 再放入 FEAT_200_DDL_BLOCKS 数组

**问题**：TS/JS 顶层 `const X = [..., DDL_EVAL_RUNS]` 在 `DDL_EVAL_RUNS` 声明之前会触发 TDZ。

**实现**：
- 把 `export const DDL_EVAL_RUNS = ...` 放在 `FEAT_200_DDL_BLOCKS` 之前
- 注释里提示后续 feat 也要遵守顺序

**面试卖点**：
- TS top-level const 不像 function 声明有 hoisting；TDZ 会让看似合法的代码模块加载即崩
- 这种 bug 在 dev 不一定立刻暴露（按需 import 顺序可能掩盖），CI 起 ApplicationContext 才显形

---

## 4. 文件清单

```
apps/api/src/eval/
├── eval.types.ts                       # GoldenItem / JudgeScores / TrajectoryMatch / 各 row 类型
├── eval.module.ts                      # 模块注册（依赖 Agent / Projects / Auth）
├── eval.controller.ts                  # 4 个 REST 端点
├── eval-runner.service.ts              # 主循环：golden→AgentRunner.run→judge+trajectory
├── eval.service.ts                     # promoteFeedbackToGolden + list/get
├── eval.repository.ts                  # eval_runs / eval_items CRUD + baseline 查询
├── golden-loader.ts                    # fs sync 读 + 校验
├── trajectory-match.ts                 # 集合相似度
├── golden/
│   ├── gold-skincare-001.json          # 5 个 sample 覆盖 rag/compete/history/notes/web
│   ├── gold-compete-002.json
│   ├── gold-history-003.json
│   ├── gold-notes-004.json
│   └── gold-web-005.json
└── __tests__/
    ├── trajectory-match.test.ts        # 6 场景
    ├── judge.prompt.test.ts            # prompt 快照
    └── golden-loader.test.ts           # 异常路径

apps/api/src/agent/prompts/eval/
└── judge.prompt.ts                     # eval.judge v1

apps/api/scripts/
└── eval.ts                             # pnpm eval CLI

apps/api/src/db/schema.ts                # +DDL_EVAL_RUNS / +DDL_EVAL_ITEMS / 加入 FEAT_200_DDL_BLOCKS
apps/api/src/agent/agent.module.ts       # exports + AgentRunnerService（让 Eval 能注入）
apps/api/src/app.module.ts               # imports + EvalModule
apps/api/package.json                    # +scripts.eval
```

---

## 5. 任务分解（含工期）

| # | 任务 | 工期 | 依赖 |
|---|---|---|---|
| 0 | DDL: eval_runs / eval_items 表 + 加入 FEAT_200_DDL_BLOCKS | 0.2d | — |
| 1 | eval.types.ts + golden/*.json（5 条 sample）+ golden-loader.ts + 单测 | 0.4d | — |
| 2 | judge prompt（agent/prompts/eval/judge.prompt.ts）+ 快照测试 | 0.2d | — |
| 3 | trajectory-match.ts + 6 场景单测 | 0.3d | — |
| 4 | eval.repository.ts（createRun / appendItem / finalizeRun / findLatestSucceededBaseline / getRun / listRecent） | 0.4d | 0 |
| 5 | eval-runner.service.ts（runOne + judge 解析 + scoreItemPassed + aggregate） | 0.6d | 1-4 |
| 6 | eval.service.ts: promoteFeedbackToGolden + list/get（路径白名单 + existsSync） | 0.3d | 4 |
| 7 | eval.controller.ts + eval.module.ts + app.module 注册 | 0.2d | 5, 6 |
| 8 | scripts/eval.ts + package.json eval 脚本（退出码 0/1/2） | 0.2d | 5 |
| 9 | feature_list 标 done + .interview/feat-300.5_eval.md（8 题） | 0.2d | 7, 8 |

**合计：~3 天**

---

## 6. HTTP 接口契约

```
POST /projects/:projectId/eval/run
  body: { triggeredBy?, gitCommit?, gitBranch?, thresholdDrop?, ids?[], tags?[] }
  返回: 200 { summary: EvalRunSummary }
  说明: 同步阻塞（30 条 golden ≈ 60s+），客户端务必设大 timeout；SSE 进度留 300.7

GET /projects/:projectId/eval/runs?limit=
  返回: { runs: EvalRunRowLite[] }

GET /projects/:projectId/eval/runs/:runId
  返回: { run: EvalRunRowLite }

POST /projects/:projectId/eval/golden/from-feedback/:generationId
  返回: 201 { item: GoldenItem, filePath: string }
  说明: 写文件后开发需 git add；feedback.overall>=4 才允许；id 冲突 400
```

## 6b. CLI 接口契约

```
pnpm --filter @harness/api eval -- \
  --project=<projectId> --user=<userId> \
  [--threshold-drop=0.5] \
  [--ids=gold-skincare-001,gold-compete-002] \
  [--tags=xiaohongshu] \
  [--commit=$(git rev-parse HEAD)] \
  [--branch=$(git rev-parse --abbrev-ref HEAD)]

# 退出码（CI 关键）
# 0 = 跑通且无回归
# 1 = 跑通但 avgOverall 退步 > thresholdDrop（业务回归，block merge）
# 2 = 执行异常（基础设施问题，不归责作者）

# 输出格式：markdown 报告（pass 率 + 各维度 avg + delta vs baseline + shouldFailCI）
```

---

## 7. 测试覆盖目标

- **trajectory-match.test.ts**：6 场景
  - 完全命中 / 部分命中 / expected 空 / actual 空 / 重复去重 / fullCover 判定
- **judge.prompt.test.ts**：
  - id/version 稳定
  - 渲染包含三维 + JSON-only 约定 + 1/3/5 锚点 + "不必模仿措辞"
  - 三段输入都注入到 prompt
- **golden-loader.test.ts**：
  - 默认目录加载 5 条 + 按 id 排序
  - 字段缺失抛错带文件名
  - id 冲突抛错

- **未做（手工或 300.7 自动化）**：
  - eval-runner 集成测试（需要 DB + mock LLM）
  - promoteFeedbackToGolden 写盘 + 鉴权
  - 退出码 0/1/2 在 shell 层验证

---

## 8. 不在本期范围 & 已知"未解决"开放点

**不在本期**：
- 前端 EvalReport.tsx（feat-300.6）
- 并行跑 golden + BYOK rate-limit（feat-300.7）
- eval 进度 SSE 推流（feat-300.7）
- 7 天移动平均 baseline（feat-300.7）
- 自动跑 eval 的 cron / GitHub Action workflow（feat-300.7）
- 不同 provider 做 judge 防"自评偏袒"（feat-300.7+）
- promote-feedback 的 PR 自动 open（需 GitHub App，远期）

**开放点（实施时再定）**：
- thresholdDrop 默认 0.5 是否合适——跑 1-2 周 baseline 后再校准
- 失败 item 是否计入 avg 分母？当前实现：`scores=null` 的不算 avg 分母，但算 totalItems 分母（passed_rate 拉低）
- promote API 的 expectedTools 反推规则——若 generation 走老 pipeline（agent_run_id IS NULL）当前给 []，是否应该提示用户手动填？

---

## 9. 风险与对冲

| 风险 | 对冲 |
|---|---|
| LLM judge 评分漂移 | 低温度 + 锚点 prompt + rationale 必填 + 未来用不同 provider |
| eval 跑一半 LLM API 限速 / 临时挂 | 单 item try/catch 不阻整批 + 退出码 2 区分基础设施问题 |
| golden 集 PR review 被绕过 | service 强制写到固定目录 + git status 必须 clean 才能 deploy（infra 约束）|
| baseline 失真 | 同 project 同 commit 跑多次取最新；7 天移动平均留 300.7 |
| 慢性分数漂移 | thresholdDrop 同时设绝对线（passed_rate 阈值）和相对线（avg 退步） |
| 测试集与生产路径分叉 | EvalRunner 直接调 AgentRunner.run，不写第二份循环 |
| 写盘越权（goldenId 含 `../`） | resolve 后必须 startsWith 白名单目录 + existsSync 禁止覆盖 |
| TDZ：DDL 数组引用未声明的 const | 把 EVAL DDL 放在 FEAT_200_DDL_BLOCKS 之前；CI 起 ApplicationContext 才能暴露此类 bug |

---

## 10. 面试题预埋清单

`.interview/feat-300.5_eval.md` 8 题覆盖：

1. Golden 集为何存文件不入库 ⚠️
2. LLM-as-judge 最大风险 + 对冲（temperature / 锚点 / rationale / 跨 provider）⚠️
3. trajectory 集合 vs 序列相似度的选择 ⚠️
4. passed = AND + jaccard 门 vs avg 阈值 ⚠️
5. baseline + thresholdDrop 防慢性漂移 ⚠️
6. promote-feedback-to-golden 闭环价值 ⚠️
7. 为何直调 AgentRunner.run 而非 mock LLM ⚠️
8. 退出码 0/1/2 的语义分离 ⚠️

⚠️ = 这次规划阶段挖出来的"易忽略点"，是最有差异化的面试加分项。
