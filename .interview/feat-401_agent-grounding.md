# feat-401 Agent Grounding 面试题

## 1. 为什么 Product Brief 和 RAG 不能同时作为事实源？

Product Brief 有字段级确认状态，代表产品方认可的事实；RAG chunk 只是原始证据，同一段里可能同时出现已确认和未确认信息。若直接把 chunk 原文交给生成模型，模型可以绕过字段状态使用 candidate 事实。因此生成只读取 confirmed field 和 approved Claim，chunk ID 只承担 provenance。

## 2. 为什么只在 outer system prompt 注入 Product Brief 不够？

`generate_draft`、`refine_draft` 和 `critic_review` 都会发起独立的 nested LLM 请求，不继承 outer system prompt。必须在 AgentRunner 服务端构造一次 Grounding Context，并显式传给每个 tool，才能避免模型漏传 evidence 或 constraints 导致上下文丢失。

## 3. 确定性门禁与 LLM critic 如何分工？

代码负责可确定判断的规则：Brief 是否存在、citation 是否有效、价格/规格数字是否有依据、平台长度/禁词/标签是否合规。任一失败直接阻止，critic 高分不能覆盖。critic 负责语义蕴含、完整度和风格等无法靠字符串规则可靠判断的维度。

## 4. 为什么最终交付不能使用 outer Agent 的最后一段文本？

outer Agent 可能在转述时删除 citation、改写事实或加入新句子。runtime 记录最近一次通过代码门禁且 `critic_review.passed=true` 的精确 draft；后续 generate/refine 会使旧批准失效。最终只交付这份被评审原稿。

## 5. 如何兼顾 fail closed 与平台规则修订的可用性？

缺引用或出现无依据硬事实时不返回正文，避免 outer Agent 复制。若事实与引用已通过、仅平台规则失败，可返回 `candidateDraft` 给 refine。只有禁词失败时还可由代码删除配置禁词并重新跑全部门禁，删除项写入 tool result 保持可观测。
