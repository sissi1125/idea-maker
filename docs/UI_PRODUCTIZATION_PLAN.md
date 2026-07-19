# IDEA-MAKER UI 产品化方案（feat-402）

## 目标

在不修改后端业务模型的前提下，把现有功能集合重组为一条用户可理解的营销内容主链路：

```text
添加产品资料 -> 确认产品信息 -> 创建内容 -> 核查并保存
```

AI 对话保留为开放任务入口，用于探索、追问和继续修改；它不再承担项目首页职责。

## 信息架构

- 项目总览：根据现有资料、Product Brief、Claim 和 Campaign 数据派生下一步。
- 产品资料：管理文档、官方网站和历史内容等原始依据。
- 产品信息：审核 Product Brief 与可用卖点，内部数据模型不改名。
- 内容创作：通过结构化 Campaign 表单生成多平台内容候选。
- AI 对话：复用现有 Agent、Trace、Context 和事实核查能力。
- 内容资产：聚合内容包、笔记、海报、生成记录和评估报告。
- 项目设置：模型、表达偏好、平台规则和高级配置。

## 设计系统

参考 Klaviyo 当前官网的字体层级、信息密度与编辑式排版，不复制其专有字体、源码或品牌资产。第一版珊瑚红方案经产品评审否决，第二版改为中性、克制的运营型工作台：

| Token | 值 | 用途 |
| --- | --- | --- |
| Ink | `#17191B` | 主文字、主按钮、品牌骨架 |
| Canvas | `#FFFFFF` | 主内容表面 |
| Cool Gray | `#F7F9FC` | 页面背景与次级分区 |
| Accent | `#2563EB` | 参考 Hyperbound 的选中态、链接与主操作 |
| Accent Soft | `#ECF2FF` | 导航选中、Guide 与 hover 背景 |
| Border | `#E4EAF2` | 边框和分隔线 |
| Success | `#48635A` | 克制的事实核查通过状态 |
| Warning | `#806A42` | 待确认与冲突 |
| Danger | `#9B403B` | 只用于阻止与错误 |

字体使用自托管 `Noto Sans SC Variable`，不依赖苹方或远程字体；版本和成本等少量数据使用等宽字体。组件原则：无装饰渐变、轻量阴影、8-14px 圆角、无斜体空状态、减少胶囊标签、Lucide 图标、清晰 label、可见 focus、150-200ms 颜色和阴影过渡。产品工作区的 Select 统一使用共享 `SelectField`，隐藏系统箭头并保留原生键盘和无障碍能力。

项目总览的四步链路不是重复导航，而是解释性 Guide：每一步包含一句目的说明，并与“建议下一步”位于同一个引导容器。内容创作页不重复展示该项目级 Guide，只保留内容任务自身的生成、审核和采纳状态。

内容创作使用前端显式工作流投影：`drafting / ready / generating / reviewing / accepted / failed`。状态由现有 Campaign、Variant 与请求状态派生，不新增后端表或第二份业务真相；界面稳定映射为“设置任务、生成内容、审核选择、采纳保存”四步。

## 后端边界

本 feature 不修改数据库 schema、Product Brief 状态机、Claim 审批、Campaign 模型、Agent Grounding、RAG、事实检查或评测 Agent。项目总览和内容资产均聚合现有接口；只有 UI 和前端派生状态发生变化。

## 验收

1. `pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test`、`pnpm -r build`。
2. PostgreSQL/pgvector healthy，NestJS API 全模块启动，真实 multipart 上传和 ingestion 入库。
3. 浏览器走通注册、创建项目、项目总览、产品资料、产品信息、内容创作、AI 对话和内容资产。
4. 375px 与桌面视口无横向溢出、遮挡或不可达导航；控制台无新增错误。
5. 配置真实 LLM/Embedding 后，继续走通 Brief 提取、Claim 审批、Campaign 生成、核查、保存和 Agent 修改。
