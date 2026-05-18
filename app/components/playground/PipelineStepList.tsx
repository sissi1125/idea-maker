"use client";

import { PipelineRun } from "./PlaygroundShell";
import { StepRunMap } from "@/lib/types";

export interface PipelineStage {
  id: string;
  name: string;
  group: "ingestion" | "retrieval" | "generation";
  featureId: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "document-upload", name: "文档上传 & 文档库", group: "ingestion", featureId: "feat-002.5" },
  { id: "idempotency", name: "文档幂等性检查", group: "ingestion", featureId: "feat-003.1" },
  { id: "preprocess", name: "文档预处理", group: "ingestion", featureId: "feat-003.2" },
  { id: "chunk", name: "分块 Chunk", group: "ingestion", featureId: "feat-003.3" },
  { id: "transform", name: "增强 Transform", group: "ingestion", featureId: "feat-003.4" },
  { id: "embedding", name: "向量嵌入 Embedding", group: "ingestion", featureId: "feat-003.5" },
  { id: "storage", name: "存储 Storage", group: "ingestion", featureId: "feat-003.6" },
  { id: "query-rewrite", name: "Query 改写", group: "retrieval", featureId: "feat-004.1" },
  { id: "retrieval", name: "检索 Retrieval", group: "retrieval", featureId: "feat-004.2" },
  { id: "filter", name: "过滤 Filter", group: "retrieval", featureId: "feat-004.3" },
  { id: "rerank", name: "重排 Rerank", group: "retrieval", featureId: "feat-004.4" },
  { id: "citation", name: "引用 Citation", group: "retrieval", featureId: "feat-004.5" },
  { id: "generation", name: "内容生成", group: "generation", featureId: "feat-005" },
];

const GROUP_LABELS: Record<PipelineStage["group"], string> = {
  ingestion: "Ingestion",
  retrieval: "Retrieval",
  generation: "Generation",
};

interface Props {
  activeStage: PipelineStage;
  onSelectStage: (stage: PipelineStage) => void;
  pipelineRun: PipelineRun;
  stepRuns: StepRunMap;
}

export default function PipelineStepList({ activeStage, onSelectStage, pipelineRun, stepRuns }: Props) {
  const groups: PipelineStage["group"][] = ["ingestion", "retrieval", "generation"];

  return (
    <aside className="w-52 shrink-0 bg-white border-r border-zinc-200 overflow-y-auto flex flex-col py-1">
      {groups.map((group) => (
        <div key={group} className="mb-2">
          <div className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
            {GROUP_LABELS[group]}
          </div>
          {PIPELINE_STAGES.filter((s) => s.group === group).map((stage) => {
            const isActive = stage.id === activeStage.id;
            const blocked = stage.id !== "document-upload" && !pipelineRun.selectedDocumentId;
            const latest = stepRuns[stage.id]?.[0];
            const dot = latest
              ? latest.status === "running"
                ? "bg-blue-400 animate-pulse"
                : latest.status === "success"
                ? "bg-green-400"
                : "bg-red-400"
              : null;

            return (
              <button
                key={stage.id}
                onClick={() => onSelectStage(stage)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-left text-xs transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white"
                    : blocked
                    ? "text-zinc-400 hover:bg-zinc-50"
                    : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <span className="flex-1 truncate leading-snug">{stage.name}</span>
                {dot ? (
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                ) : blocked && !isActive ? (
                  <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-zinc-200" />
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
