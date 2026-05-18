"use client";

import { useCallback, useEffect, useState } from "react";
import PipelineStepList, { PIPELINE_STAGES, PipelineStage } from "./PipelineStepList";
import StageConfigPanel from "./StageConfigPanel";
import OutputTracePanel from "./OutputTracePanel";
import { StepRun, StepRunMap } from "@/lib/types";
import { DocumentRecord } from "@/lib/docStore";

export type PipelineRunStatus = "idle" | "running" | "success" | "error";

export interface PipelineRun {
  status: PipelineRunStatus;
  selectedDocumentId: string | null;
  selectedDocumentVersionId: string | null;
}

export default function PlaygroundShell() {
  const [activeStage, setActiveStage] = useState<PipelineStage>(PIPELINE_STAGES[0]);
  const [pipelineRun, setPipelineRun] = useState<PipelineRun>({
    status: "idle",
    selectedDocumentId: null,
    selectedDocumentVersionId: null,
  });
  const [stepRuns, setStepRuns] = useState<StepRunMap>({});
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  // Load document library on mount
  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.documents)) setDocuments(data.documents); })
      .catch(() => {});
  }, []);

  const handleDocumentUploaded = useCallback((doc: DocumentRecord) => {
    setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
  }, []);

  const handleDocumentDeleted = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    // 如果删除的是当前选中文档，重置 pipeline
    setPipelineRun((p) => p.selectedDocumentId === id
      ? { status: "idle", selectedDocumentId: null, selectedDocumentVersionId: null }
      : p
    );
  }, []);

  const handleDocumentSelected = useCallback((doc: DocumentRecord) => {
    setPipelineRun((p) => ({
      ...p,
      status: "idle",
      selectedDocumentId: doc.id,
      selectedDocumentVersionId: `${doc.id}-v${doc.version}`,
    }));
    setStepRuns({});
  }, []);

  const addStepRun = useCallback((run: StepRun) => {
    setStepRuns((prev) => ({
      ...prev,
      [run.stageId]: [run, ...(prev[run.stageId] ?? [])],
    }));
  }, []);

  const updateStepRun = useCallback((stageId: string, runId: string, patch: Partial<StepRun>) => {
    setStepRuns((prev) => ({
      ...prev,
      [stageId]: (prev[stageId] ?? []).map((r) => (r.id === runId ? { ...r, ...patch } : r)),
    }));
  }, []);

  const latestRun = useCallback((stageId: string): StepRun | undefined => stepRuns[stageId]?.[0], [stepRuns]);

  const anyRunning = Object.values(stepRuns).flat().some((r) => r.status === "running");

  const handleRun = useCallback(
    async (stageId: string, methodId: string, params: Record<string, unknown>) => {
      const runId = `${stageId}-${Date.now()}`;
      const newRun: StepRun = { id: runId, stageId, methodId, params, status: "running", startedAt: Date.now() };

      addStepRun(newRun);
      setPipelineRun((p) => ({ ...p, status: "running" }));

      try {
        const res = await fetch(`/api/pipeline/${stageId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ methodId, params, pipelineRun }),
        });
        const data = await res.json();
        const durationMs = Date.now() - newRun.startedAt;

        if (!res.ok) {
          updateStepRun(stageId, runId, {
            status: "error", durationMs,
            error: data.error ?? { code: "unknown_error", message: "未知错误" },
            trace: data.trace, warnings: data.warnings,
          });
          setPipelineRun((p) => ({ ...p, status: "error" }));
        } else {
          updateStepRun(stageId, runId, {
            status: "success", durationMs,
            output: data.output, trace: data.trace, warnings: data.warnings,
          });
          setPipelineRun((p) => ({ ...p, status: "success" }));
        }
      } catch (err) {
        const durationMs = Date.now() - newRun.startedAt;
        updateStepRun(stageId, runId, {
          status: "error", durationMs,
          error: { code: "network_error", message: String(err) },
        });
        setPipelineRun((p) => ({ ...p, status: "error" }));
      }
    },
    [addStepRun, updateStepRun, pipelineRun]
  );

  const selectedDoc = documents.find((d) => d.id === pipelineRun.selectedDocumentId);

  // 找出当前正在运行的 stage 名称，用于 Header 显示
  const runningStageId = Object.entries(stepRuns)
    .find(([, runs]) => runs[0]?.status === "running")?.[0];
  const runningStageName = runningStageId
    ? PIPELINE_STAGES.find(s => s.id === runningStageId)?.name
    : undefined;

  return (
    <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden">
      <Header pipelineRun={pipelineRun} anyRunning={anyRunning} selectedDoc={selectedDoc} runningStageName={runningStageName} />
      <div className="flex flex-1 overflow-hidden">
        <PipelineStepList
          activeStage={activeStage}
          onSelectStage={setActiveStage}
          pipelineRun={pipelineRun}
          stepRuns={stepRuns}
        />
        <StageConfigPanel
          stage={activeStage}
          pipelineRun={pipelineRun}
          latestRun={latestRun(activeStage.id)}
          onRun={handleRun}
          documents={documents}
          onDocumentUploaded={handleDocumentUploaded}
          onDocumentSelected={handleDocumentSelected}
          onDocumentDeleted={handleDocumentDeleted}
          getLatestRun={latestRun}
        />
        <OutputTracePanel stage={activeStage} runs={stepRuns[activeStage.id] ?? []} />
      </div>
    </div>
  );
}

function Header({
  pipelineRun,
  anyRunning,
  selectedDoc,
  runningStageName,
}: {
  pipelineRun: PipelineRun;
  anyRunning: boolean;
  selectedDoc: DocumentRecord | undefined;
  runningStageName: string | undefined;
}) {
  const status = anyRunning ? "running" : pipelineRun.status;

  const statusLabel: Record<PipelineRunStatus, string> = {
    idle: "待运行", running: "运行中", success: "成功", error: "错误",
  };
  const statusColor: Record<PipelineRunStatus, string> = {
    idle: "bg-zinc-100 text-zinc-500",
    running: "bg-blue-100 text-blue-700",
    success: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };

  return (
    <header className="flex items-center gap-3 px-5 py-3 bg-white border-b border-zinc-200 shrink-0">
      <h1 className="text-sm font-semibold text-zinc-900 tracking-tight">
        Marketing RAG Playground
      </h1>
      <span className="text-zinc-200">|</span>

      {/* Pipeline 整体状态，运行时显示当前 stage 名称 */}
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[status]}`}>
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status === "running" ? "bg-blue-500 animate-pulse" : "bg-current opacity-50"}`} />
        {status === "running" && runningStageName
          ? <>正在运行 <span className="font-semibold">{runningStageName}</span></>
          : <>Pipeline {statusLabel[status]}</>
        }
      </span>

      {/* 当前选中文档（始终展示，无论是否运行中） */}
      <span className="ml-auto flex items-center gap-2 text-xs">
        {selectedDoc ? (
          <>
            <span className="text-zinc-400">当前文档</span>
            <span className="inline-flex items-center gap-1 bg-zinc-100 rounded px-2 py-0.5 text-zinc-700 font-medium max-w-xs truncate">
              📄 {selectedDoc.fileName}
              <span className="text-zinc-400 font-normal">v{selectedDoc.version}</span>
            </span>
          </>
        ) : (
          <span className="text-zinc-400">尚未选择文档 — 请先上传或选择一个文档作为 pipeline 输入</span>
        )}
      </span>
    </header>
  );
}
