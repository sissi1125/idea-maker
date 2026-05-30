/**
 * Prompt 基础设施 — feat-300.3 Phase 3.5
 *
 * 把分散在 tool 文件 / runner / context-manager 里的 prompt string literal
 * 抽到一处统一管理。设计目标：**不复杂、扩展性好**。
 *
 * 三个要解决的未来场景（决策记录在 docs/agent/feat-300.3-plan.md §3.10）：
 *   1. eval 复用：feat-300.5 离线 eval 直接 import 同一份 critic prompt，行为 1:1
 *   2. memory/rules 注入：每个 prompt 用纯函数接收结构化入参，组合时按需拼
 *   3. 可编辑：未来管理后台想 override 时，只改 definePrompt 一处拦截，调用方零改动
 *
 * 不做的事（YAGNI）：
 *   ❌ DB 表存 prompt（PromptDefinition 是代码 + git 管理就够）
 *   ❌ Mustache/Handlebars 模板引擎（TS 模板字符串清晰可读）
 *   ❌ i18n 抽象（未来在 input 里加 locale 字段即可）
 *   ❌ NestJS DI service（纯函数 import 用，无运行时副作用）
 */

/**
 * 一个 Prompt 的完整描述：稳定标识 + 版本 + 可读说明 + 渲染函数。
 *
 * - id：业务稳定标识，命名约定 `<scope>.<role>`，如 'critic.judge' / 'agent.system'。
 *       永远不变（即使 prompt 内容大改也保持同 id），这样 trace / eval 的关联不断。
 *
 * - version：语义版本 'v1' / 'v2'。**prompt 内容有任何实质变化都必须 bump**。
 *       原因：3 个月后看一条不及格的 trace，要立刻知道"它用的是改之前还是之后的版本"。
 *
 * - description：人类可读说明，给未来 admin UI / 文档生成 / 新人 onboarding 用。
 *
 * - render：纯函数 (TInput) => string。
 *       做成函数而不是模板字符串：注入物（memory / rules / 上文摘要）按入参动态拼。
 *       泛型 TInput 确保调用方拼错入参会编译失败。
 */
export interface PromptDefinition<TInput> {
  id: string;
  version: string;
  description: string;
  render: (input: TInput) => string;
}

/**
 * 包装器。现在是恒等函数，看上去多余——但**预留拦截点**是它的全部价值。
 *
 * 未来需要做 prompt override（如管理后台改了 prompt 实时生效）：
 *   把 render 包一层，先查 override 表，命中则用 override，未命中走代码默认。
 *   调用方 `criticReviewPrompt.render({...})` 一行不动。
 *
 * 未来需要做 trace dump（自动把每次渲染结果写入 agent_steps）：
 *   wrap render 做副作用，调用方仍然无感。
 *
 * **这是 1 行代码换未来 50 行重构成本，是经典的"延迟具体化"模式**。
 */
export function definePrompt<TInput>(spec: PromptDefinition<TInput>): PromptDefinition<TInput> {
  return spec;
}

/**
 * agent_steps.input JSONB 里 prompt 标识的统一形状。
 * AgentRunner / tool 在记 step 时按这个 shape 写入，便于前端 trace 渲染。
 */
export interface PromptTraceTag {
  promptId: string;
  promptVersion: string;
}

/** 工具：从一个 PromptDefinition 抽出 trace tag */
export function toPromptTraceTag(def: Pick<PromptDefinition<unknown>, "id" | "version">): PromptTraceTag {
  return { promptId: def.id, promptVersion: def.version };
}
