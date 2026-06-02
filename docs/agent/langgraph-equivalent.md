# 自建 Agent vs LangGraph 对照

> 我们没用 LangGraph 是有意决策。本文 60 行内对照核心概念 + 50 行等价代码，让面试官能快速判断「为什么自建」。

---

## 概念对照表

| 我们的实现 | LangGraph 等价物 | 我们为什么不用 LangGraph |
|---|---|---|
| `AgentRunnerService.run` ReAct 主循环 | `StateGraph` + 节点边定义 | ai-sdk 的 `generateText(maxSteps, onStepFinish)` 已经替我们做了循环，再加 StateGraph 是双倍状态机 |
| `agent_steps` 表 + JSONB 每步入库 | `MemorySaver` checkpointer | 我们需要前端实时回放 trace，DB 直读比 checkpointer 序列化拆包更直观 |
| `AgentSseService` + `ReplaySubject` | `graph.stream()` + `astream_events` | LangGraph stream 是 Python 协程边产边消费，Node 用 ai-sdk 配 Rx 同等效果 |
| `CostTracker` + `budget` 闸门 | `RunnableConfig.recursionLimit` + 自写 callback | recursionLimit 只管步数，**没有原生美元闸门**——我们 budget 维度更贴生产 |
| `AgentToolsService` 8 个 tool factory | `@tool` 装饰器 + ToolNode | 等价；但我们用 `ai-sdk.tool({ description, parameters, execute })` 类型更稳 |
| `MemoryDistiller` @OnEvent → 蒸馏 | **无原生等价** | LangGraph 只管"运行时记忆"（checkpoint），没有"从 feedback 蒸馏长期偏好"模式 |
| `ContextManager` 滑动窗口 + LLM 摘要压缩 | `trim_messages()` + 自写压缩节点 | LangGraph 提供 trim 但摘要要自写——等价工作量 |
| `EvalRunner` + golden + judge | LangSmith Evaluations | LangSmith 商用付费，我们自建 600 行 TS 覆盖核心 |

---

## 50 行 LangGraph 等价代码（核心 ReAct）

```python
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.postgres import PostgresSaver
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages

# 1. State：消息累加 + budget 跟踪
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    cost_usd: float
    budget_usd: float

# 2. Tools（等价我们的 8 个 tool）
@tool
def search_kb(query: str, top_k: int = 3) -> str:
    """检索项目知识库..."""
    ...

tools = [search_kb, ...]  # 8 个

# 3. LLM with tools
llm = ChatOpenAI(model="glm-4-flash", base_url="https://...").bind_tools(tools)

# 4. agent node：调 LLM + budget 守门
def agent_node(state: AgentState):
    if state["cost_usd"] >= state["budget_usd"]:
        return {"messages": [AIMessage(content="预算超出，停止")]}
    response = llm.invoke(state["messages"])
    cost = estimate_cost(response.usage_metadata)  # 自写
    return {"messages": [response], "cost_usd": state["cost_usd"] + cost}

# 5. 路由：有 tool_call 走 tools，否则收尾
def should_continue(state):
    return "tools" if state["messages"][-1].tool_calls else END

# 6. 组图
graph = StateGraph(AgentState)
graph.add_node("agent", agent_node)
graph.add_node("tools", ToolNode(tools))
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")

# 7. Checkpoint（持久化每步 state，等价我们 agent_steps）
checkpointer = PostgresSaver.from_conn_string("postgresql://...")
app = graph.compile(checkpointer=checkpointer)

# 8. 运行（recursionLimit ≈ 我们的 maxSteps）
config = {"configurable": {"thread_id": run_id}, "recursion_limit": 12}
result = app.invoke(
    {"messages": [HumanMessage("...")], "cost_usd": 0, "budget_usd": 0.2},
    config=config,
)

# 9. SSE 流（等价 ReplaySubject）
async for event in app.astream_events({...}, config=config, version="v2"):
    yield event  # 推到 SSE
```

---

## 选择「自建」的 4 个理由

1. **学习目的**：简历项目核心是「我懂 ReAct loop 怎么转起来」——直接用 LangGraph 等于黑盒，写不进面试故事。
2. **TypeScript 一等公民**：项目其他部分（NestJS + Next.js）都是 TS，引入 Python LangGraph 多一套技术栈。ai-sdk 是 TS 原生。
3. **MemoryDistiller 无等价**：LangGraph 只管"当前对话内"记忆（checkpointer），我们要的「从 feedback 自动学偏好」是 LangGraph 不覆盖的产品逻辑。
4. **Eval 体系自由度**：LangSmith 商用付费，golden 集本地 JSON + 三层评分（judge + trajectory + agent_runs 元数据）的设计比商用更适合 demo。

---

## 但 LangGraph 这些地方比我们好

| LangGraph 优势 | 我们的应对 |
|---|---|
| Human-in-the-loop（中断 → 用户确认 → 继续）原生支持 | 我们没做，留 feat-301+ |
| Multi-agent / 子图嵌套清晰 | 我们单 ReAct 不支持，但 plan 阶段已留扩展位 |
| Time-travel debugging（按 checkpoint 回放/分叉） | agent_steps 可读历史，但没"分叉重跑"UI |
| 自带 Streaming + Threads + Threads State Schema 抽象 | 我们用 Rx + ReplaySubject 等价但工程量大 |
| 生态：LangSmith / LangChain Hub 现成 prompts/tools | 我们都自写——好处是可控，代价是工程量 |

---

## 一句话总结

**"我们选自建是因为：① 学习目的、② TS 一等公民、③ MemoryDistiller 无等价、④ Eval 自由度。LangGraph 在 human-in-the-loop / multi-agent / time-travel 上比我们强，留作 feat-301+ 升级路径——但简历项目阶段，自建 600 行 TS 比引入 Python 框架更能讲清楚『我理解 ReAct』。"**
