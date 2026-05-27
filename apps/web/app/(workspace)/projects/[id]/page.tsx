/**
 * Project Detail — feat-200.5 Week 5 (placeholder)
 *
 * Week 6 会填充对话主界面。当前只展示项目名 + 占位提示。
 */

"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useProjectsStore } from "@/lib/stores/projects-store";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { setCurrentProject, currentProject: getCurrent } = useProjectsStore();
  const project = getCurrent();

  useEffect(() => {
    if (id) setCurrentProject(id);
  }, [id, setCurrentProject]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: "var(--ink-3)" }}>
      <div className="text-5xl">{project?.emoji ?? "📂"}</div>
      <h2 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>
        {project?.name ?? "项目"}
      </h2>
      <p className="text-sm">对话界面将在 Week 6 实现</p>
      <div className="text-xs mt-4 px-4 py-2 rounded-lg" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
        项目 ID: {id}
      </div>
    </div>
  );
}
