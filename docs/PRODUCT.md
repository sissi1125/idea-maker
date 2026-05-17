# 产品说明

## 名称

暂定名：Marketing RAG Playground

备选名：IdeaGraph AI

## 产品定位

一个面向产品运营、独立开发者、一人公司和小团队的可视化 RAG Pipeline Playground。它把产品资料处理成可复用、可检索、可追踪的知识库，再基于可信 evidence 生成产品画像、卖点地图和运营内容 idea。

更简洁地说：一个可调试的 RAG 驱动运营选题生成系统。

## 目标用户

- 准备做产品发布或增长内容的独立开发者。
- 有产品资料但没有完整市场团队的一人公司。
- 需要验证内容方向的小团队产品运营。
- 希望围绕自己产品构建营销工作流的开发者。

## 核心用户流程

1. 上传产品资料，或从已上传文档库中选择历史 document version。
2. 配置 RAG ingestion pipeline。
3. 执行 ingestion 并查看每一步产物。
4. 配置 retrieval。
5. 检索相关 evidence chunks。
6. 生成产品画像。
7. 生成结构化卖点地图。
8. 基于卖点和 evidence 生成内容 idea。
9. 查看引用和 confidence。
10. 调整 pipeline 参数并重新运行。

## 项目阶段规划

项目整体按“先闭环、再增强、再产品化”的方式推进。每个阶段都应保持可验证、可回退、可追踪，不把后续复杂能力提前塞进当前阶段。

### 阶段 0：Harness 与工程基座

目标：让后续 agent 或开发者进入项目后，能快速理解产品边界、当前状态、验证方式和交接规则。

范围：

- 建立 `AGENTS.md`、`feature_list.json`、`progress.md`、`session-handoff.md` 和 `init.sh`。
- 记录产品说明、架构说明、API 契约和验证清单。
- 明确“文档默认中文、工程标识保留英文”的协作规则。
- 定义 feature 状态、完成标准和会话交接机制。

交付标准：

- `./init.sh` 可以完成 harness 文件检查。
- 后续开发者可以基于文档直接启动下一个 feature。

### 阶段 1：可调试 RAG Playground 闭环

目标：先跑通从产品文档到 evidence-backed marketing ideas 的最小闭环。

范围：

- Playground Web UI：左侧 pipeline steps，中间配置，右侧 output/trace。
- Document Upload & Library：上传 MD/TXT/PDF 或粘贴文本，保存原始内容、metadata、hash 和 version；页面进入时自动加载已上传文档并可选择历史版本。
- Ingestion steps：document idempotency、preprocess、chunk、transform、embedding、storage。
- Retrieval steps：query rewrite、retrieval、filter、rerank、citation。
- Marketing generation：product profile、selling point map、content ideas。
- 每个卖点和 idea 都带 evidence references。
- 存储主线采用 PostgreSQL + pgvector，保留 provider 抽象和可调试 trace。
- Embedding 支持 OpenAI、Hugging Face TEI、Hugging Face Transformers.js 和 debug deterministic provider。
- REST endpoints 具备 request、response、mock 和 error schema。

交付标准：

- 用户可以导入一份产品资料，并在界面上看到每一步输入、参数、输出、耗时和 trace。
- 系统能基于 retrieval evidence 生成产品画像、卖点地图和内容 idea。
- 无远程 API key 时，非 LLM 阶段和 debug embedding 仍可运行；用户选择需要真实 provider 的方法时，系统必须返回明确 provider 错误。

### 阶段 2：RAG 质量评估与调参能力

目标：让用户能判断生成效果不好时，到底是文档处理、chunk、embedding、retrieval、rerank 还是 prompt 出了问题。

范围：

- 展示 chunk count、token estimate、chunk coverage 和 source coverage。
- 增加 retrieval hit rate、score distribution、evidence coverage、citation correctness 等指标。
- 支持 curated test queries，用固定问题回归 retrieval 表现。
- 增加 chunk 参数、threshold、topK、transform 方法的对比视图。
- 可选接入 RAGAS 或自定义轻量评估器。

交付标准：

- 用户能对同一文档运行多组 retrieval 配置并比较结果。
- 每次生成结果都能看到 evidence 覆盖率和低置信 warning。
- 质量问题能被定位到具体 pipeline 阶段。

### 阶段 3：卖点地图与内容策略增强

目标：从“生成几个 idea”升级为“围绕产品定位持续产出内容方向”。

范围：

- 扩展结构化卖点地图：functional、emotional、scenario、differentiation。
- 引入 Product -> Feature -> User Pain -> Scenario -> Selling Point -> Content Angle -> Idea 的图谱化关系。
- 支持按平台、目标用户、内容类型、营销目标生成 idea。
- 增加内容方向模板：教程型、痛点型、场景型、故事型、对比型、更新型、反常识型、清单型。
- 支持 idea 去重、聚类、优先级和 confidence 排序。

交付标准：

- 用户能从同一套 evidence 中生成多平台、多目标的内容方向。
- 每个 selling point 和 idea 都能回溯到原始 chunks。
- 系统能解释某个 idea 为什么适合某个目标用户或平台。

### 阶段 4：真实存储、协作与产品化

目标：把 Playground 从本地验证工具推进到可持续使用的产品形态。

范围：

- 在 PostgreSQL + pgvector 主线之上完善文档版本管理、重复导入处理、历史 retrieval runs 和 artifact 保存。
- 引入项目/workspace 概念，但保持权限模型尽量简单。
- 支持导出卖点地图、idea 列表和 evidence report。
- 增加基础内容管理能力，例如收藏、标记、状态流转和批量导出。

交付标准：

- 用户可以长期维护一个产品知识库。
- 不同版本文档、检索记录和生成结果可追踪。
- 关键运营资产可以导出或复用。

### 阶段 5：高级自动化与生态集成

目标：在可信 RAG 和可调试链路稳定后，再扩展自动化和外部系统集成。

范围：

- 扩展真实 LLM provider 和 embedding provider，并保留 debug deterministic 等显式调试 provider。
- 支持 rerank、query rewrite、semantic chunking 和更强的 citation builder。
- 可选接入内容发布平台、分析工具或外部知识库。
- 探索轻量 agent workflow，但必须建立在可观测、可回放的 pipeline 之上。
- 增加 benchmark、成本统计和质量回归报告。

交付标准：

- 自动化能力不会破坏 evidence-first 和 debuggable 的产品原则。
- 外部集成产生的结果仍然能追溯到文档证据和 pipeline trace。
- 系统具备质量回归和成本观测能力。

## 产品原则

- Evidence first：生成声明必须能指向 chunk IDs。
- Debuggable by default：每一步都应该展示 input、params、output、status、timing 和 trace。
- Provider explicit：用户选择哪个 provider 就执行哪个 provider，不静默 fallback。
- Small surface, complete loop：先交付能证明 RAG 质量影响营销输出的最小闭环。

## 主要输出

产品画像：

```json
{
  "productName": "",
  "targetUsers": [],
  "coreProblems": [],
  "coreFeatures": [],
  "positioning": "",
  "evidenceChunkIds": []
}
```

卖点地图：

```json
{
  "sellingPointMap": {
    "functional": [],
    "emotional": [],
    "scenario": [],
    "differentiation": []
  },
  "evidence": []
}
```

内容 idea：

```json
{
  "ideas": [
    {
      "title": "",
      "angle": "",
      "sellingPointId": "",
      "targetUser": "",
      "platform": "",
      "hook": "",
      "outline": [],
      "evidenceChunkIds": []
    }
  ]
}
```
