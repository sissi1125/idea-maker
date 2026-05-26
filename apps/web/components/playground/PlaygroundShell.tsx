"use client";

import { useCallback, useEffect, useState } from "react";
import PipelineStepList from "./PipelineStepList";
import { PIPELINE_STAGES } from "@/lib/pipelineStages";
import type { PipelineStage } from "@/lib/pipelineStages";
import StageConfigPanel from "./StageConfigPanel";
import OutputTracePanel from "./OutputTracePanel";
import GenerationOutputPanel from "./GenerationOutputPanel";
import EvaluationOutputPanel from "./EvaluationOutputPanel";
import { StepRun, StepRunMap, PipelineRun, PipelineRunStatus, createPipelineRun } from "@/lib/types";
import type { StageSnapshot, PipelineRunRecord, PipelineRunStageEntry } from "@/lib/types";
import { DocumentRecord } from "@/lib/docStore";
import { resolveEffectiveUpstream } from "@/lib/pipelineDeps";
import PipelineTraceDrawer from "./PipelineTraceDrawer";
import { pipelineUrl, documentsUrl } from "@/lib/api-base";

export default function PlaygroundShell() {
  const [activeStage, setActiveStage] = useState<PipelineStage>(PIPELINE_STAGES[0]);
  const [pipelineRun, setPipelineRun] = useState<PipelineRun>(createPipelineRun());
  const [stepRuns, setStepRuns] = useState<StepRunMap>({});
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  /**
   * 每个 stage 的 (methodId, params) 持久化存储。
   * StageConfigPanel 在 key 变化时重新挂载，但从此处读取初始值，
   * 使得切换 stage 后再切回时参数不会被重置。
   */
  const [stageParamsMap, setStageParamsMap] = useState<
    Record<string, { methodId: string; params: Record<string, unknown> }>
  >({});

  // 用户手动加载的快照上游（stageId → upstreamOutput）
  const [snapshotUpstreamMap, setSnapshotUpstreamMap] = useState<Record<string, unknown>>({});
  // 当前 activeStage 的快照（从 DB 拉取）
  const [activeStageSnapshot, setActiveStageSnapshot] = useState<StageSnapshot | null>(null);
  // 全链路抽屉开关
  const [traceDrawerOpen, setTraceDrawerOpen] = useState(false);
  // 历史 pipeline run 列表（抽屉 Tab2 用）
  const [pipelineRunHistory, setPipelineRunHistory] = useState<PipelineRunRecord[]>([]);

  // 页面加载时拉取已上传文档，并恢复上次选中的文档
  useEffect(() => {
    fetch(documentsUrl())
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data.documents)) return;
        setDocuments(data.documents);
        const savedId = localStorage.getItem("pipeline:selectedDocumentId");
        if (savedId) {
          const doc = data.documents.find((d: DocumentRecord) => d.id === savedId);
          if (doc) {
            setPipelineRun((p) => ({
              ...p,
              selectedDocumentId: doc.id,
              selectedDocumentVersionId: `${doc.id}-v${doc.version}`,
            }));
          }
        }
      })
      .catch(() => {});
  }, []);

  // 页面加载时从快照恢复 pipeline 状态（DB 可用时）
  useEffect(() => {
    fetch("/api/snapshots")
      .then((r) => r.json())
      .then((data: { snapshots?: StageSnapshot[] }) => {
        const snapshots = data.snapshots ?? [];
        if (snapshots.length === 0) return;
        // 将每条快照转成 StepRun 并填入 stepRuns（仅在 stepRuns 为空时恢复，避免覆盖本次会话的结果）
        setStepRuns((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const restored: StepRunMap = {};
          for (const snap of snapshots) {
            const run: StepRun = {
              id: `${snap.stageId}-snapshot`,
              stageId: snap.stageId,
              methodId: snap.methodId,
              params: snap.params,
              status: "success",
              startedAt: new Date(snap.createdAt).getTime(),
              durationMs: snap.durationMs,
              output: snap.output,
            };
            restored[snap.stageId] = [run];
          }
          return restored;
        });
      })
      .catch(() => {});
  }, []);

  // activeStage 变化时拉取快照
  useEffect(() => {
    const stageId = activeStage?.id;
    // 用 Promise 链统一 setState，避免在 effect 体内同步调用 setState
    const p = stageId
      ? fetch(`/api/snapshots/${stageId}`)
          .then((r) => r.json())
          .then((data: { snapshot: StageSnapshot | null }) => data.snapshot ?? null)
          .catch(() => null as StageSnapshot | null)
      : Promise.resolve(null as StageSnapshot | null);
    p.then((snap) => setActiveStageSnapshot(snap));
  }, [activeStage?.id]);

  // 抽屉打开时拉取历史
  useEffect(() => {
    if (!traceDrawerOpen) return;
    fetch("/api/pipeline-runs")
      .then((r) => r.json())
      .then((d: { runs: PipelineRunRecord[] }) => setPipelineRunHistory(d.runs ?? []))
      .catch(() => {});
  }, [traceDrawerOpen]);

  // ─── 文档操作 ─────────────────────────────────────────────────────────────

  const handleDocumentUploaded = useCallback((doc: DocumentRecord) => {
    setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
  }, []);

  const handleDocumentDeleted = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    setPipelineRun((p) => {
      if (p.selectedDocumentId === id) {
        localStorage.removeItem("pipeline:selectedDocumentId");
        return createPipelineRun();
      }
      return p;
    });
  }, []);

  const handleDocumentSelected = useCallback((doc: DocumentRecord) => {
    localStorage.setItem("pipeline:selectedDocumentId", doc.id);
    setPipelineRun((p) => ({
      ...p,
      status: "idle",
      selectedDocumentId: doc.id,
      selectedDocumentVersionId: `${doc.id}-v${doc.version}`,
    }));
    setStepRuns({});
  }, []);

  // ─── Stage params 持久化 ──────────────────────────────────────────────────

  const handleParamsChange = useCallback(
    (stageId: string, methodId: string, params: Record<string, unknown>) => {
      setStageParamsMap((prev) => ({ ...prev, [stageId]: { methodId, params } }));
    },
    []
  );

  // ─── 步骤开关 ─────────────────────────────────────────────────────────────

  /**
   * 用户切换 optional/conditional 步骤的启用状态。
   * 切换后清空该步骤及其所有下游步骤的运行结果，避免数据不一致。
   */
  const handleToggleStep = useCallback((stageId: string, enabled: boolean) => {
    setPipelineRun((p) => ({
      ...p,
      enabledSteps: { ...p.enabledSteps, [stageId]: enabled },
    }));
    // 清空被切换步骤本身及其下游的运行结果
    setStepRuns((prev) => {
      const next = { ...prev };
      let clearing = false;
      for (const stage of PIPELINE_STAGES) {
        if (stage.id === stageId) clearing = true;
        if (clearing) delete next[stage.id];
      }
      return next;
    });
  }, []);

  // ─── StepRun 管理 ─────────────────────────────────────────────────────────

  const addStepRun = useCallback((run: StepRun) => {
    setStepRuns((prev) => ({
      ...prev,
      [run.stageId]: [run, ...(prev[run.stageId] ?? [])],
    }));
  }, []);

  const updateStepRun = useCallback((stageId: string, runId: string, patch: Partial<StepRun>) => {
    setStepRuns((prev) => ({
      ...prev,
      [stageId]: (prev[stageId] ?? []).map((r) => r.id === runId ? { ...r, ...patch } : r),
    }));
  }, []);

  const latestRun = useCallback(
    (stageId: string): StepRun | undefined => stepRuns[stageId]?.[0],
    [stepRuns]
  );

  // ─── 运行 ─────────────────────────────────────────────────────────────────

  const anyRunning = Object.values(stepRuns).flat().some((r) => r.status === "running");

  const handleRun = useCallback(
    async (stageId: string, methodId: string, params: Record<string, unknown>) => {
      const runId = `${stageId}-${Date.now()}`;
      const newRun: StepRun = {
        id: runId, stageId, methodId, params,
        status: "running", startedAt: Date.now(),
      };

      addStepRun(newRun);
      setPipelineRun((p) => ({ ...p, status: "running" }));

      try {
        // 若用户已加载快照上游，优先使用它；否则走原有依赖图逻辑
        const injectedUpstream = snapshotUpstreamMap[stageId];
        let upstreamOutput: unknown | null;
        if (injectedUpstream !== undefined) {
          upstreamOutput = injectedUpstream;
        } else {
          const upstreamStageId = resolveEffectiveUpstream(
            stageId,
            pipelineRun.enabledSteps,
            pipelineRun.runtimeContext
          );
          upstreamOutput = upstreamStageId ? latestRun(upstreamStageId)?.output ?? null : null;
        }

        const res = await fetch(pipelineUrl(stageId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ methodId, params, pipelineRun, upstreamOutput }),
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

          // 异步保存快照（失败不阻断主流程）
          fetch("/api/snapshots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stageId, methodId, params, upstreamOutput,
              output: data.output, durationMs,
            }),
          }).catch(() => {});
          // 更新当前 stage 快照（无需等待 DB）
          setActiveStageSnapshot({
            id: `${stageId}-${Date.now()}`,
            stageId, methodId, params,
            upstreamOutput: upstreamOutput ?? null,
            output: data.output,
            durationMs,
            createdAt: new Date().toISOString(),
          });
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
    [addStepRun, updateStepRun, pipelineRun, latestRun, snapshotUpstreamMap]
  );

  const handleLoadSnapshotUpstream = useCallback((stageId: string, upstream: unknown) => {
    setSnapshotUpstreamMap((prev) => ({ ...prev, [stageId]: upstream }));
  }, []);

  const handleClearSnapshotUpstream = useCallback((stageId: string) => {
    setSnapshotUpstreamMap((prev) => {
      const next = { ...prev };
      delete next[stageId];
      return next;
    });
  }, []);

  const handleSavePipelineRun = useCallback(async () => {
    const stages: Record<string, PipelineRunStageEntry> = {};
    for (const [sid, runs] of Object.entries(stepRuns)) {
      const latest = runs[0];
      if (latest) {
        stages[sid] = {
          methodId: latest.methodId,
          params: latest.params,
          output: latest.output,
          trace: latest.trace,
          durationMs: latest.durationMs ?? 0,
          status: latest.status,
          warnings: latest.warnings,
        };
      }
    }
    const name = window.prompt("为本次 Pipeline Run 命名（留空自动命名）：") ?? "";
    const res = await fetch("/api/pipeline-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        documentId: pipelineRun.selectedDocumentId ?? undefined,
        stages,
      }),
    });
    const responseData = await res.json();
    if (responseData.ok) {
      fetch("/api/pipeline-runs")
        .then((r) => r.json())
        .then((d: { runs: PipelineRunRecord[] }) => setPipelineRunHistory(d.runs ?? []))
        .catch(() => {});
    }
  }, [stepRuns, pipelineRun.selectedDocumentId]);

  // ─── 渲染 ─────────────────────────────────────────────────────────────────

  const selectedDoc = documents.find((d) => d.id === pipelineRun.selectedDocumentId);
  const runningStageId = Object.entries(stepRuns)
    .find(([, runs]) => runs[0]?.status === "running")?.[0];
  const runningStageName = runningStageId
    ? PIPELINE_STAGES.find((s) => s.id === runningStageId)?.name
    : undefined;

  return (
    <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden">
      <Header
        pipelineRun={pipelineRun}
        anyRunning={anyRunning}
        selectedDoc={selectedDoc}
        runningStageName={runningStageName}
        onSavePipelineRun={handleSavePipelineRun}
        onToggleDrawer={() => setTraceDrawerOpen((v) => !v)}
        hasSuccessfulRuns={Object.values(stepRuns).some((runs) => runs.some((r) => r.status === "success"))}
      />
      <div className="flex flex-1 overflow-hidden">
        <PipelineStepList
          activeStage={activeStage}
          onSelectStage={setActiveStage}
          pipelineRun={pipelineRun}
          stepRuns={stepRuns}
          onToggleStep={handleToggleStep}
        />
        <StageConfigPanel
          key={activeStage.id}
          stage={activeStage}
          pipelineRun={pipelineRun}
          latestRun={latestRun(activeStage.id)}
          onRun={handleRun}
          documents={documents}
          onDocumentUploaded={handleDocumentUploaded}
          onDocumentSelected={handleDocumentSelected}
          onDocumentDeleted={handleDocumentDeleted}
          getLatestRun={latestRun}
          initialMethodId={stageParamsMap[activeStage.id]?.methodId}
          initialParams={stageParamsMap[activeStage.id]?.params}
          onParamsChange={handleParamsChange}
          snapshot={activeStageSnapshot}
          snapshotUpstreamLoaded={snapshotUpstreamMap[activeStage.id] !== undefined}
          onLoadSnapshotUpstream={handleLoadSnapshotUpstream}
          onClearSnapshotUpstream={handleClearSnapshotUpstream}
        />
        {activeStage.id === "generation" ? (
          <GenerationOutputPanel runs={stepRuns["generation"] ?? []} />
        ) : activeStage.id === "evaluation" ? (
          <EvaluationOutputPanel runs={stepRuns["evaluation"] ?? []} />
        ) : (
          <OutputTracePanel stage={activeStage} runs={stepRuns[activeStage.id] ?? []} />
        )}
      </div>
      <PipelineTraceDrawer
        open={traceDrawerOpen}
        onClose={() => setTraceDrawerOpen(false)}
        stepRuns={stepRuns}
        stages={PIPELINE_STAGES}
        enabledSteps={pipelineRun.enabledSteps}
        pipelineRunHistory={pipelineRunHistory}
      />
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({
  pipelineRun,
  anyRunning,
  selectedDoc,
  runningStageName,
  onSavePipelineRun,
  onToggleDrawer,
  hasSuccessfulRuns,
}: {
  pipelineRun: PipelineRun;
  anyRunning: boolean;
  selectedDoc: DocumentRecord | undefined;
  runningStageName: string | undefined;
  onSavePipelineRun: () => void;
  onToggleDrawer: () => void;
  hasSuccessfulRuns: boolean;
}) {
  const status: PipelineRunStatus = anyRunning ? "running" : pipelineRun.status;

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

      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[status]}`}>
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status === "running" ? "bg-blue-500 animate-pulse" : "bg-current opacity-50"}`} />
        {status === "running" && runningStageName
          ? <>正在运行 <span className="font-semibold">{runningStageName}</span></>
          : <>Pipeline {statusLabel[status]}</>
        }
      </span>

      <button
        onClick={onToggleDrawer}
        className="text-[10px] px-2 py-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
      >
        🔗 全链路
      </button>
      <button
        onClick={onSavePipelineRun}
        disabled={!hasSuccessfulRuns}
        className="text-[10px] px-2 py-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        💾 保存 Run
      </button>

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
