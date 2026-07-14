/**
 * 内容包页面 — feat-400.4 前端
 * 路由：/projects/[id]/campaign
 */

"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { CampaignPanel } from "@/components/campaign/CampaignPanel";

export default function CampaignPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { setCurrentProject } = useProjectsStore();

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  if (!projectId) return null;

  return (
    <main className="flex-1 h-full overflow-auto" style={{ background: "var(--bg)" }}>
      <div className="max-w-[1080px] mx-auto px-7 py-6">
        <CampaignPanel projectId={projectId} />
      </div>
    </main>
  );
}
