/**
 * 海报页面 — feat-400.5 前端
 * 路由：/projects/[id]/poster
 */

"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { PosterStudio } from "@/components/poster/PosterStudio";

export default function PosterPage() {
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
        <PosterStudio projectId={projectId} />
      </div>
    </main>
  );
}
