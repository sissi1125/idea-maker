/**
 * 内容与卖点页面 — feat-400.2 前端
 * 路由：/projects/[id]/content
 */

"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { ContentWorkbench } from "@/components/content/ContentWorkbench";

export default function ContentPage() {
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
        <ContentWorkbench projectId={projectId} />
      </div>
    </main>
  );
}
