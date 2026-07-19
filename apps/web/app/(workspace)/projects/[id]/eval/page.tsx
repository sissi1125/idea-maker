/**
 * Eval 页面 — feat-300.6 任务 9
 *
 * 路由：/projects/[id]/eval（顶级独立路由，不挂在 Settings 下）
 *
 * 信息架构决策（plan §决策表）：
 *   - eval 是"质量监控"不是"项目设置"
 *   - 与 Settings Tab 化分离避免后者越塞越胖
 *   - 新增 sidebar 入口（layout 层）
 */

"use client";

import { useParams } from "next/navigation";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { useEffect } from "react";
import { EvalReport } from "@/components/eval/EvalReport";

export default function EvalPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { setCurrentProject } = useProjectsStore();

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  if (!projectId) return null;

  return (
    <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
      <div className="page-shell">
        <EvalReport projectId={projectId} />
      </div>
    </main>
  );
}
