# feat-300.1 面试题：Agent Schema + LLM 层

> 本期交付：3 张 Agent 表（agent_runs / agent_steps / agent_memory）+ generations.agent_run_id 列 + LlmService（ai-sdk 封装）+ TavilyClient（带 LRU 缓存与降级）。
> 面试时这些都是"工程化决策的入口"——一个表结构 / 一个客户端选型背后都对应一道考题。

---

## Q1：为什么 `agent_steps` 表要逐步落库？直接把每次 run 的完整 trace 当一个 JSONB 存到 `agent_runs` 不就够了？

**考点：可观测性的"实时性"和"可查询性"两个维度。**

参考答案：
1. **实时推送**：前端 AgentTracePanel 走 SSE 边跑边显示。如果只在 run 结束才写一行 JSONB，用户在跑的过程中什么都看不到——这就是 toy 系统。逐步落库 + EventEmitter 推流是同一个写入点。
2. **崩溃可观测**：agent 中途崩了（budget 超 / LLM 超时 / 进程挂），完整 JSONB 这条路写不进去，整条 trace 丢失。逐步落库保证前 N 步永远在表里，可以排查"它崩在第几步、调用什么 tool 时崩的"。
3. **可查询性**：未来要做"哪个 tool 最常被调"、"哪类 query 平均步数最多"这类分析，逐步落库是关系型查询；JSONB 内查询要 `jsonb_path_query` 性能差。
4. **物理压力**：单次 ReAct 跑 10 步、每步带 tool 输入输出，JSONB 单行可能几十 KB；行宽过大触发 TOAST，读写慢且占内存。10 行各几 KB 是健康的。

**对比反例**：LangGraph 默认用 `MemorySaver` 把整个 State 序列化存一次，调试时只能 replay 不能 query。这是我们选择"自建 + 逐步入库"的工程原因之一。

---

## Q2：`agent_memory.kind` 为什么只设了 4 类（preference/style/taboo/audience）？多了少了有什么后果？

**考点：领域建模的"粒度选择"，避免 over-engineering。**

参考答案：
- **太粗（1 类）**：所有偏好混成一坨自由文本，distiller 输出长且重，injected system prompt 不可控，agent 一会儿当合规检查、一会儿当文风提示，混乱。
- **太细（10+ 类，比如分 "title 偏好 / 段落长度 / 表情符号风格 / 标签数量..."）**：distiller 要做小类分类，本身就需要更强的 LLM 提示；用户在 MemoryPanel 看到 50 条细碎条目无法管理；类目错分（"应该归 style 却归 taboo"）会让偏好失效。
- **4 类是"够注入 system prompt 时分段"的最小集合**：preference（通用："多用数据少用形容词"）、style（语气/句式）、taboo（绝对禁忌：不准提某竞品）、audience（受众：写给 25-30 岁宝妈）。distiller 4-way classification 也好做。

**面试加分**：拿 OpenAI 自家的 Custom Instructions（也只分了 "About you" / "How to respond" 两类）做对照，说明大厂也倾向粗粒度。

---

## Q3：为什么 `agent_memory.confidence` 是 `NUMERIC(4,3)` 不是 `FLOAT`？置信度怎么算？

**考点：钱和精度的权衡 + 学习闭环的工程实现。**

参考答案：
- **类型选 NUMERIC**：FLOAT 在 PG 里是 4 字节 IEEE754，跨语言/JSON 序列化容易出 `0.30000000000000004` 这种漂浮，前端展示时尴尬。`NUMERIC(4,3)` = 0.000~9.999 范围内严格小数，3 位精度足以排序和比较，存储 5 字节，可控。
- **置信度算法（distiller 内）**：
  - 一条偏好初次提炼出来 = 0.5（中性）
  - 后续每收到一条新 feedback 印证同方向 → confidence += 0.1（封顶 1.0）
  - 出现矛盾的 feedback（用户改回相反方向）→ confidence -= 0.2（地板 0）
  - 注入 system prompt 时只挑 confidence ≥ 0.6 的条目，低置信度的不影响 agent
- **soft delete 而非 hard delete**：用户在 MemoryPanel 删除偏好时，可以选"暂时禁用"（confidence 降到 0）保留历史 source_feedback_ids 供溯源，避免误删后无法恢复。

**陷阱题**：如果 distiller 把"用户偶尔吐槽一次"也算成偏好，会污染 memory。答：`source_feedback_ids JSONB` 数组长度 < 2 时不允许 confidence > 0.5，强制要求至少两条 feedback 印证才能"晋级"。

---

## Q4：LlmService 用 `@ai-sdk/openai` 配合改 baseURL 接所有国产 provider，这种"OpenAI 兼容协议"假设的风险是什么？

**考点：抽象稳定性 + 平台依赖风险。**

参考答案：
- **风险 1：兼容程度参差**。智谱 GLM 对 `tool_choice='auto'` 支持完整，但旧版本对 `parallel_tool_calls`（一步调多个 tool）不支持；DeepSeek 对 `response_format: json_schema` 实现不严格；SiliconFlow 转发不同上游模型时行为有差异。**对冲手段**：LlmService.create() 在创建 provider 时记录 provider 标识，AgentRunner 在调 generateText 时按 provider 黑名单关掉某些参数（比如 zhipu 关 parallel_tool_calls）。
- **风险 2：未来非 OpenAI 协议的模型（Claude / Gemini）**。这两个原生协议差别大，不可能强行套 OpenAI compatibility。**对冲手段**：LlmService 设计成"return LanguageModelV1"——ai-sdk 提供 @ai-sdk/anthropic / @ai-sdk/google 时，只在 LlmService 内部 switch provider 选不同 createXxx()，下游 agent 代码无需任何改动。这就是为什么不直接 return `OpenAI` 实例而是抽象 `LanguageModelV1`。
- **风险 3：compatibility: 'compatible'** 关闭了 OpenAI 专属字段（structured outputs strict mode 等），代价是放弃 OpenAI 独有能力。值得换"一套代码接 5 家 provider"的好处。

**面试卖点**：拿 LangChain 的 `ChatOpenAI` vs `ChatAnthropic` 对比——LangChain 让你必须 import 不同类，业务代码要分支；ai-sdk 的 LanguageModelV1 让业务代码完全无感，这是抽象层的胜利。

---

## Q5：TavilyClient 的 LRU 用 `Map` 实现，为什么不用 `lru-cache` 这个 npm 包？规模到什么程度需要换？

**考点：依赖最小化 + 实事求是的容量评估。**

参考答案：
- **Map 的属性**：ES2015 起规范保证 Map 迭代顺序 = 插入顺序。读时 `delete` + `set` = LRU 触摸（移到末尾），写时 `keys().next().value` = 最老的（迭代器头）。20 行代码做完整 LRU。
- **不引 lru-cache 的理由**：MVP 阶段每多一个 dep 就多一份升级负担、license 风险、bundle 大小。lru-cache 提供的额外能力（异步过期回调、staleWhileRevalidate）我们当前用不到。
- **什么时候必须换**：
  1. **跨进程共享**：API 起多实例 / 跑 worker 时，进程内 Map 不共享，命中率掉。换 Redis（不是换 lru-cache）。
  2. **量级 > 10k 条**：Map 没有 size-based 自动淘汰之外的策略，老条目可能驻留 30 天；如果 query 多样性大，内存膨胀。换 lru-cache 的 maxAge + sizeCalculation。
  3. **需要持久化**：Tavily 命中是真金白银，进程重启就丢了。生产期上 Redis 持久化是收益最大的优化。

**陷阱题**：如果两个用户同时 search 同 query，会不会一个看到 cache 命中、一个真实请求？答：会，因为 Promise 没去重。改进：`inflight` Map（同 query 在飞的 Promise 复用），是后续 feat-400 的优化点。

---

## Q6：TavilyClient 在缺 key 时返回 `status: 'unavailable'` 而不是抛错。这个设计选择对 agent 行为有什么影响？

**考点：ReAct 自主性 + 错误传播的语义层级。**

参考答案：
- **抛错的后果**：tool execute 异常 → ai-sdk 的 tool call 失败 → 错误塞回 messages 让 LLM "修复"。但 LLM 无法"修复"一个"key 没配"的环境问题——它只会反复重试 search_web，浪费 step 和 budget。
- **返回 unavailable 的后果**：tool 调用本身成功，agent 看到的是一个**结构化观察**："工具暂不可用，建议改用别的"。它在下一步 reasoning 时会自己决定走 search_kb 或直接 generate_draft。这是把"环境问题"翻译成"agent 可以理解的世界状态"。
- **更深一层的原则**：**异常 vs 业务结果的边界要严守**。异常 = 程序员错误（参数类型错、不可恢复 bug）；业务结果 = "查不到 / 没权限 / 服务不可用" 这类**正常但失败**的情况，必须用返回值表达，不能用异常。这条对 agent 系统尤其重要——LLM 无法 catch 异常。

**面试加分**：联系到 Go 的 `error` 不抛、Rust 的 `Result<T,E>`——它们的设计哲学和 agent tool 接口是同构的，都拒绝"环境问题异常化"。

---

## Q7：`generations.agent_run_id` 用 `ON DELETE SET NULL` 而不是 `CASCADE`，为什么？

**考点：实体生命周期 + 数据治理。**

参考答案：
- `generations` 是**用户的核心资产**（生成历史是产品价值），即使删除 agent_run 也要保留。
- `agent_runs` 是**审计/可观测数据**，体量大、可定期清理（比如 90 天前的 trace 归档）。
- CASCADE 会让"清理老 trace" → 误删用户的生成历史，不可接受。SET NULL 让 generation 仍然在，只是"对应的 trace 已归档"。
- 对应的，`agent_runs.generation_id` 是 CASCADE：用户删除 generation 意味着完全不要这条记录，对应的 trace 也无意义，可以一起清。

**面试加分**：拓展到通用原则——CASCADE 的方向应该是"低价值资产指向高价值实体"，而不是反过来。

---

## Q8：为什么 LlmModule 标 `@Global()`？什么时候不该用 @Global？

**考点：DI 设计 + 显式依赖的工程价值。**

参考答案：
- **该用的理由**：LlmService 是"基础设施"，几乎所有未来模块（agent / memory / eval / 任何调 LLM 的地方）都要注入。让 8 个 tool 文件每个都 `imports: [LlmModule]` 是样板噪音。
- **不该用的边界**：业务模块绝对不能 @Global——比如 ProjectsModule、FeedbacksModule。原因：
  1. **模块边界即认知边界**：一个新人看到 imports: [AuthModule, ProjectsModule] 就知道这个模块在哪两个领域之间起作用；如果都是 @Global，模块的依赖关系会消失在隐式注入里，难以理解。
  2. **测试隔离**：业务模块单测时希望 mock 它的依赖；@Global 模块在测试 module 里要专门 override，麻烦。
  3. **重构成本**：@Global 模块改 public API 全工程隐式受影响；普通模块改 API 通过 imports 显式可追踪。
- **判断标准**：**问"未来 80% 模块都要用吗？"**。是 → @Global；否 → 普通 module。LlmService / DbService / CommonService 是；ProjectsService 不是。

---

## 自查清单（提交前对照）

- [x] 3 张表 DDL 写入 schema.ts 且加入 FEAT_200_DDL_BLOCKS
- [x] generations 加列用 ADD COLUMN IF NOT EXISTS（幂等）
- [x] LlmService 暴露 create(LlmConfig) → LanguageModelV1
- [x] BYOK 解密集中在 decryptApiKey()，TODO 标记加密接入点
- [x] TavilyClient 缺 key 走 unavailable 不抛错
- [x] TavilyClient 30 天 TTL + 500 条容量 LRU
- [x] LlmModule @Global，AppModule 引入
- [x] 单测覆盖：apiKey 优先级 / 缓存命中 / TTL 失效 / 错误分类（共 15 用例）
- [x] typecheck 通过
