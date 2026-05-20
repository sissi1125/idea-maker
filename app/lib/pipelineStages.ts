/**
 * Pipeline 步骤元数据注册表
 *
 * 定义所有步骤的分类（required/optional/conditional/optimization）、
 * 所属模块、默认启用状态和条件触发键。
 *
 * 分类语义：
 *   required     — 核心流程，始终执行，UI 不显示开关
 *   optional     — 用户可按需启用/禁用，UI 显示 toggle 开关
 *   optimization — 同 optional，UI 额外显示 ★ 优化推荐标记
 *   conditional  — 根据 runtimeContext 自动判断；用户可通过 enabledSteps 强制覆盖
 *
 * 与 stageRegistry.ts 的分工：
 *   pipelineStages.ts  — 步骤的 UI 元数据（分类、顺序、分组、依赖解析）
 *   stageRegistry.ts   — 步骤的 API 元数据（methods、params schema、implemented 标志）
 */

import { PipelineRuntimeContext } from "./types";

export type StepCategory = "required" | "optional" | "conditional" | "optimization";

export interface PipelineStage {
  id: string;
  name: string;
  /** 左侧面板分组 */
  group: "ingestion" | "retrieval" | "generation";
  /** 中间面板模块标签 */
  module: string;
  category: StepCategory;
  /**
   * optional/optimization 步骤的默认开关状态。
   * required 步骤忽略此字段。
   * conditional 步骤的默认由 conditionKey 决定，此字段作为 fallback。
   */
  defaultEnabled: boolean;
  /**
   * conditional 步骤的自动触发键：读取 PipelineRuntimeContext[conditionKey]。
   * 只有 category === "conditional" 的步骤才有此字段。
   */
  conditionKey?: keyof PipelineRuntimeContext;
  featureId: string;
}

// ─── Ingestion Pipeline ───────────────────────────────────────────────────────

const INGESTION_STAGES: PipelineStage[] = [
  {
    id: "document-upload",
    name: "文档上传 & 文档库",
    group: "ingestion",
    module: "数据接入",
    category: "required",
    defaultEnabled: true,
    featureId: "feat-002.5",
  },
  {
    id: "idempotency",
    name: "幂等性检查",
    group: "ingestion",
    module: "数据接入",
    category: "optional",
    defaultEnabled: true,
    featureId: "feat-003.1",
  },
  {
    id: "preprocess",
    name: "文档预处理",
    group: "ingestion",
    module: "数据处理",
    category: "optional",
    defaultEnabled: true,
    featureId: "feat-003.2",
  },
  {
    id: "chunk",
    name: "分块 Chunk",
    group: "ingestion",
    module: "数据处理",
    category: "required",
    defaultEnabled: true,
    featureId: "feat-003.3",
  },
  {
    id: "transform",
    name: "增强 Transform",
    group: "ingestion",
    module: "数据处理",
    // optimization：功能上可选，但对 embedding 质量有显著提升，建议开启
    category: "optimization",
    defaultEnabled: true,
    featureId: "feat-003.4",
  },
  {
    id: "embedding",
    name: "向量嵌入 Embedding",
    group: "ingestion",
    module: "向量化",
    category: "required",
    defaultEnabled: true,
    featureId: "feat-003.5",
  },
  {
    id: "storage",
    name: "存储 Storage",
    group: "ingestion",
    module: "索引",
    category: "required",
    defaultEnabled: true,
    featureId: "feat-003.6",
  },
];

// ─── Query / Retrieval Pipeline ───────────────────────────────────────────────

const RETRIEVAL_STAGES: PipelineStage[] = [
  {
    id: "context-management",
    name: "对话上下文管理",
    group: "retrieval",
    module: "查询理解",
    category: "conditional",
    defaultEnabled: false,
    conditionKey: "isMultiTurn",
    featureId: "feat-004.0",
  },
  {
    id: "intent-recognition",
    name: "意图识别 / 路由",
    group: "retrieval",
    module: "查询理解",
    category: "optional",
    defaultEnabled: false,
    featureId: "feat-004.0",
  },
  {
    id: "query-rewrite",
    name: "Query 改写",
    group: "retrieval",
    module: "查询理解",
    category: "optional",
    defaultEnabled: true,
    featureId: "feat-004.1",
  },
  {
    id: "retrieval",
    name: "检索 Retrieval",
    group: "retrieval",
    module: "检索",
    category: "required",
    defaultEnabled: true,
    featureId: "feat-004.2",
  },
  {
    id: "multi-recall-merge",
    name: "多路召回合并",
    group: "retrieval",
    module: "检索后处理",
    category: "conditional",
    defaultEnabled: false,
    conditionKey: "multipleRetrievalSources",
    featureId: "feat-004.2",
  },
  {
    id: "filter",
    name: "过滤 Filter",
    group: "retrieval",
    module: "检索后处理",
    category: "optional",
    defaultEnabled: true,
    featureId: "feat-004.3",
  },
  {
    id: "rerank",
    name: "重排 Rerank",
    group: "retrieval",
    module: "检索后处理",
    category: "optional",
    defaultEnabled: true,
    featureId: "feat-004.4",
  },
  {
    id: "fallback",
    name: "降级 Fallback",
    group: "retrieval",
    module: "流程控制",
    // optional（非 conditional）：Playground 语境下由用户主动开启来测试降级路径
    category: "optional",
    defaultEnabled: false,
    featureId: "feat-004.x",
  },
  {
    id: "prompt-build",
    name: "Prompt 构造",
    group: "retrieval",
    module: "生成前",
    category: "required",
    defaultEnabled: true,
    featureId: "feat-004.x",
  },
];

// ─── Generation Pipeline ──────────────────────────────────────────────────────

const GENERATION_STAGES: PipelineStage[] = [
  {
    id: "generation",
    name: "内容生成",
    group: "generation",
    module: "生成",
    category: "required",
    defaultEnabled: true,
    featureId: "feat-005",
  },
  {
    id: "output-validation",
    name: "输出校验",
    group: "generation",
    module: "生成后",
    category: "optional",
    defaultEnabled: false,
    featureId: "feat-005.x",
  },
  {
    id: "citation",
    name: "引用 Citation",
    group: "generation",
    module: "生成后",
    category: "optional",
    defaultEnabled: true,
    featureId: "feat-004.5",
  },
  {
    id: "evaluation",
    name: "RAG 质量评估",
    group: "generation",
    module: "生成后",
    category: "optional",
    defaultEnabled: true,
    featureId: "feat-006",
  },
];

export const PIPELINE_STAGES: PipelineStage[] = [
  ...INGESTION_STAGES,
  ...RETRIEVAL_STAGES,
  ...GENERATION_STAGES,
];

export const GROUP_LABELS: Record<PipelineStage["group"], string> = {
  ingestion: "Ingestion",
  retrieval: "Retrieval",
  generation: "Generation",
};

/** ingestion 链的步骤 ID 集合（用于 getBlockReason 区分两条链） */
export const INGESTION_STAGE_IDS = new Set(
  INGESTION_STAGES.filter((s) => s.id !== "document-upload").map((s) => s.id)
);
