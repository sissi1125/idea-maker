# feat-300.2 面试题：8 个 Agent Tools

> 本期交付：apps/api/src/agent/tools/ 下 8 个 ai-sdk `tool()` 定义 + AgentToolsService 集中绑定。
> tool 是 LLM 和后端能力之间的"接口契约"——每个设计决策都对应可考的工程点。

---

## Q1：Tool 的 description 应该写"做什么"还是"什么时候用"？为什么？

**考点：LLM 决策机制——LLM 无法读 code，只能读 description。**

参考答案：
- LLM 在 ReAct 循环里要决策"下一步调哪个 tool"，**它唯一的决策依据就是每个 tool 的 description**。zod schema 描述参数细节，不影响"该不该调"的判断。
- 因此 description 必须围绕**调用场景**展开，不是功能列表。我们项目里每个 tool description 都有三段：
  1. "什么时候调用"——正例触发场景
  2. "什么时候不要调"——反例触发场景（避免 LLM 在不该用的时候用）
  3. "返回结构"——告诉 LLM 看观察的时候期待什么
- **反例**：写 "search_kb: searches the knowledge base" —— LLM 不知道知识库里有啥、跟 search_notes 区别是什么、空结果该怎么办。结果是 LLM 要么不调，要么乱调。
- **测验**：把 search_kb 和 search_history description 互换，LLM 会不会调错？如果会，说明 description 缺乏区分度，需要补"vs 另一个 tool 用什么"。

**面试加分**：联系到 OpenAI Cookbook 的 "tool description = an internal API doc written for an LLM"，跟人类 API doc 唯一不同的是要写"什么时候不要用"。

---

## Q2：search_kb 为什么没把 rerank 和 citation 也封进 tool？rag-core 完整流水线和 agent tool 的边界怎么划？

**考点：单一职责 + 灵活组合 vs 一体化打包的权衡。**

参考答案：
- **包进去的代价**：rerank 需要外部 reranker 服务 / LLM 评分，未必每个项目都配。citation 是给 prompt-build 用的格式化层，agent 视角不需要——agent 自己的 messages 已经在做 context 整合。
- **拆开的好处**：search_kb 单一职责"找相关 chunks"，可独立测试、可独立换实现（feat-300.4 加 pgvector 时只动这个 tool）。Agent 想要 rerank 可以再调一次 `search_kb_rerank`（未来需要时再加）。
- **设计原则**：tool 是"原子能力"，agent 是"组合策略"。把 rerank 包进 search_kb 就把组合权交给了开发者，违反 ReAct 的核心——agent 自主决策。
- **反面**：老 pipeline 把 retrieval→filter→rerank→citation→prompt-build→generation 一条路走死，YAML 写死顺序。我们正是反着走。

**陷阱题**：那 search_kb 现在没 rerank，质量不会下降吗？答：会有损失，但收益是简洁的 tool 边界。如果质量不达标，feat-300.5 eval 会发现并促使我们加专用 rerank tool；先用最简方案落地。**这是 YAGNI 的体现**。

---

## Q3：generate_draft 为什么没真正委托给 rag-core 的 runGeneration？是不是违背了"委托给现有代码"的承诺？

**考点：诚实地认识委托的边界 + 渐进迁移策略。**

参考答案：
- **承认半委托**：generate_draft 用 ai-sdk `generateText` 自己写了 prompt 和 system，没调 runGeneration。代码里 TODO 注释明确标了原因。
- **理由**：
  1. runGeneration 需要 `upstream: PromptBuildOutput` 和老形态的 `LLMChatClient`（OpenAI SDK shape）。在 agent 上下文里要凑齐这两样，得跑一遍 prompt-build，重复工作。
  2. Agent 调 generate_draft 时已经通过前面 search_* 收集了 evidence，自己的 messages 数组就是上下文。再过 prompt-build 是把 agent 自己已经组织好的内容拆开重组。
  3. ai-sdk 的 `generateText` 比 OpenAI SDK 多了 onStepFinish 等钩子，agent 路径用 ai-sdk 是统一性的需求。
- **正确的渐进路径**：rag-core/generation.ts 里真正的 IP 是 prompt 模板和 JSON-mode schema（4 个 method：marketing-ideas / product-persona / selling-points / content-ideas）。下一步抽离成纯函数 `buildMarketingPrompt(input) → string`，agent tool 调它再走 ai-sdk。这样 prompt IP 复用、LLM 调用机制各自合适。
- **承担的代价**：本期老 pipeline 和 agent 跑两套 prompt，行为可能轻微分叉。eval suite（feat-300.5）会检测这种分叉。

**面试卖点**：能明确说出"我做了半委托，因为 X；完整委托需要先做 Y 的重构；权衡是 Z"。这比假装"我什么都委托了"诚实得多。

---

## Q4：critic_review 用 generateObject 而不是 generateText + 手解 JSON，为什么？

**考点：结构化输出的工程必要性 + 错误处理。**

参考答案：
- **下游强依赖结构**：critic 的输出 `{ scores, passed, suggestions }` 会被：
  1. AgentRunner 用 `passed` 决定要不要进 refine_draft
  2. agent_runs.eval_scores 入库供 trend 分析
  3. feat-300.5 离线 eval 复用同一 schema 算指标
  任何字段缺失或类型错都会破坏下游。手解 `JSON.parse(text)` 一次解析失败整链断。
- **generateObject 内置的健壮性**：
  - 用 zod schema 校验，LLM 输出不合规则自动重试 + 修正
  - 对 OpenAI 走 structured outputs（strict JSON mode），对兼容 provider 走 JSON instruction 注入
  - 失败的 retry 计数 + token 累计在 result.usage 里可观测
- **手解的隐性成本**：处理"LLM 偶尔输出 markdown 代码块包 JSON / 字段名大小写错 / 数组当对象返回"——每个 edge case 都要写防御代码。一年积累下来 200 行的解析层。

**反面**：generateObject 也有成本：JSON mode 对 LLM 来说比自由文本更难，生成质量会轻微下降。对 critic（输出短）影响小，对 generate_draft（输出长）就不该用。**这是为什么我们 generate 用 generateText、critic 用 generateObject 的根据**。

---

## Q5：critic_review 的 safety=0 直接判 fail（绕过其他维度），其他维度只是 ≥ 阈值。这种"硬约束 vs 软指标"的二元区分意味着什么？

**考点：合规 vs 质量的本质差异。**

参考答案：
- **合规是 0/1 不是连续值**：含禁词、超字数、违反 platform_rules 就是不合规，没有"60% 合规"。所以 safety 维度的 0 分必须有绝对否决权——即使其他三维都是 5，整体也不能 pass。
- **质量是连续的**：完整度差一点、风格不那么活泼，是程度问题。用阈值（默认 3.5）允许"有瑕疵但及格"的草稿通过，避免无穷修正。
- **如果都按阈值会怎样**：safety=2 + 其他=5 平均 4.25 通过 → 给用户发了违规内容，可能炸。
- **如果都按硬约束会怎样**：必须 5/5/5/5 才过，agent 反复 refine 烧钱烧步数都过不去。
- **跟 platform_rules 的耦合**：safety 维度的判断依据就是注入的 `criteria.platformRules`，没规则就没违规可能。这是为什么 critic 是有状态的 factory（criteria 是构造参数），不是无状态 tool。

**面试加分**：联系到产品 / 工程的不同价值观——产品看综合分，合规看红线。任何审核系统都需要这种"软指标 + 硬约束"的复合模型。

---

## Q6：log_decision 看起来只是写一条 DB 记录，为什么要单独成 tool 而不是依赖 ai-sdk 自动记录的 reasoning？

**考点：观察粒度 + memory distillation 的输入质量。**

参考答案：
- **ai-sdk 自动 onStepFinish 记的是 raw reasoning**——LLM 思考的整段文本，可能几百字、半结构化、夹杂"嗯让我想想"之类的口水话。颗粒粗、信噪比低。
- **log_decision 让 agent 主动产出结构化反思**：`{ choice: "决定不再调 search_web", reasoning: "前两次都没增量" }`。这是 agent 自己提炼过的"决策摘要"，比 raw reasoning 准确得多。
- **下游 distiller 受益最大**：feat-300.4 MemoryDistiller 从 feedbacks + agent_steps 提炼用户偏好。从 raw reasoning 提炼，LLM 容易被无关词干扰；从 log_decision 抽取，信号清晰。
- **代价**：增加 1 个 tool 让 LLM 选择，可能它不会主动调（"用 log_decision 还是直接想"）。**对冲**：description 里写明"什么时候调"+ 在 system prompt 里强调"关键决策点请用 log_decision 记录"。
- **trace 可读性**：AgentTracePanel 上 reasoning step 太多用户也读不过来。log_decision 是 agent 自标的"重要里程碑"，前端可高亮。

**陷阱题**：为什么不在 onStepFinish 里用 LLM 二次提炼 reasoning 成结构化摘要？答：每步都跑一次 LLM 总结 = 100% 翻倍成本和延迟。log_decision 是按需触发，agent 只在关键节点用，成本可控。

---

## Q7：AgentToolsService.build(ctx) 为什么不缓存？每次 run 都重新创建 8 个 tool 不浪费吗？

**考点：闭包 + per-run 状态隔离。**

参考答案：
- **每个 tool 都是闭包**，绑定了 ctx 里的 projectId / runId / pgClient / llmModel。这些是"本次 run"的实例，跨 run 必须重新绑。
- **缓存的后果**：A 用户的 run 缓存了一组 tool，B 用户的 run 进来命中缓存 → 用 A 的 projectId 查数据库 → 跨用户数据泄露。**这是安全事故等级的 bug**。
- **重新创建的成本**：tool 实例是几个对象 + 闭包，nanoseconds 级。8 个 tool 共几百 bytes 内存。每次 run 几秒到几十秒，构造成本忽略不计。
- **正确的缓存层在哪**：service 本身是单例（NestJS @Injectable），它持有的 TavilyClient 是单例（含 LRU cache）。底层缓存在 TavilyClient 内部，tool 实例不缓存。

**面试加分**：这是 functional core / imperative shell 的体现——shell（tool 实例）是 cheap 一次性的，core（TavilyClient、rag-core）是持久的可复用的。理解这个分层就能直觉判断"什么该缓存什么不该"。

---

## Q8：search_notes 现在用 ILIKE 而不是 pgvector，未来 feat-300.4 切换成 embedding 检索时，怎么保证不破坏 agent 的行为？

**考点：渐进迁移 + 接口稳定性。**

参考答案：
- **稳定的契约层**：search_notes tool 的 description 和 zod schema 不变。Agent 调用方式不变。
- **可变的内部**：execute 内部从 ILIKE SQL 切到 `NotesService.searchByEmbedding()`。返回结构相同（notes 数组），只是 ranking 来源不同。
- **eval 锁住行为**：feat-300.5 的 golden dataset 里有"用户问 X，期望召回历史笔记 Y" 的样例。embedding 切换后跑 eval，召回率应不降反升；否则切换不通过。
- **风险点**：
  1. embedding 检索时 query 太短可能返结果偏移 → description 里强调 "建议关键词式 query"
  2. embedding 计算成本 → 笔记数量级小，每个笔记一次 embed 可接受
- **不要做的事**：不要在切换的同时改 zod schema 加新参数 / 改返回结构。切换和扩展分两个 commit，回滚成本最小。

**面试卖点**：这是软件工程"separate the what from the how" 的实践——tool 边界（what）稳定，实现（how）随技术演进。

---

## 自查清单

- [x] 8 个 tool 全部建好：search_kb / search_web / search_notes / search_history / generate_draft / refine_draft / critic_review / log_decision
- [x] 每个 tool 的 description 含"何时调 / 何时不调 / 返回结构"
- [x] AgentToolContext 把 per-run 状态显式化（projectId/runId/pgClient/llmModel）
- [x] AgentToolsService.build(ctx) 无缓存，避免跨 run 污染
- [x] critic_review 用 generateObject + zod schema（结构化输出）
- [x] safety 维度具备硬约束语义（=0 直接 fail）
- [x] generate_draft 抽取 [evidence-N] cited sources（faithfulness 可校验）
- [x] log_decision 通过 step_type='reasoning' + tool_name 入 agent_steps，无需新 step_type
- [x] 7 个 tool 单测覆盖核心边界（共 31 用例，加上 feat-300.1 共 46 用例全过）
- [x] typecheck 通过
- [x] AgentModule 已在 AppModule 注册
