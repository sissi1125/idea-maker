/**
 * Product Brief 审核工作台页面 — feat-400.1 slice 3
 *
 * 路由：/projects/[id]/brief（顶级独立路由）
 * 与 eval 页同款：客户端组件 + setCurrentProject + 居中容器。
 */

"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { ProductBriefWorkbench } from "@/components/product-brief/ProductBriefWorkbench";
import { PageHeader } from "@/components/ui/ProductUi";

export default function BriefPage() {
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
        <PageHeader
          title="产品档案"
          description="集中管理产品信息、可用于创作的产品卖点与视觉资产。"
        />
        <ProductBriefWorkbench projectId={projectId} />
      </div>
    </main>
  );
}
