"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Activity, Clock, FileStack, Image, Library, Plus, type LucideIcon } from "lucide-react";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { PageHeader } from "@/components/ui/ProductUi";
import { CampaignPanel } from "@/components/campaign/CampaignPanel";
import { PosterStudio } from "@/components/poster/PosterStudio";
import { EvalReport } from "@/components/eval/EvalReport";
import NotesPage from "../notes/page";
import HistoryPage from "../history/page";

type AssetView = "notes" | "campaign" | "poster" | "history" | "eval";
interface AssetTab { id: AssetView; icon: LucideIcon; title: string }

const ASSET_TABS: AssetTab[] = [
  { id: "notes", icon: Library, title: "笔记库" },
  { id: "campaign", icon: FileStack, title: "内容包" },
  { id: "poster", icon: Image, title: "海报" },
  { id: "history", icon: Clock, title: "生成记录" },
  { id: "eval", icon: Activity, title: "评估报告" },
];

/** 内容资产在同一工作区直接挂载各业务视图，Tab 不再充当二次跳转入口。 */
export default function ContentAssetsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { setCurrentProject } = useProjectsStore();
  const [active, setActive] = useState<AssetView>("notes");

  useEffect(() => {
    if (projectId) setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  return (
    <div className="content-assets-shell">
      <div className="content-assets-fixed">
        <PageHeader
          title="内容资产"
          description="集中管理已筛选的笔记、内容包、海报和每次生成记录。"
          actions={<button className="btn btn-primary" onClick={() => router.push(`/projects/${projectId}/campaign`)}><Plus size={15} />新建内容</button>}
        />

        <nav className="asset-tabs" role="tablist" aria-label="内容资产类型">
          {ASSET_TABS.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button key={tab.id} role="tab" aria-selected={active === tab.id} data-active={active === tab.id} className="asset-tab" onClick={() => setActive(tab.id)}>
                <TabIcon size={15} />{tab.title}
              </button>
            );
          })}
        </nav>
      </div>

      <section className="asset-tab-content" role="tabpanel" aria-label={ASSET_TABS.find((tab) => tab.id === active)?.title}>
        {active === "notes" ? <NotesPage /> : null}
        {active === "campaign" ? <CampaignPanel projectId={projectId} /> : null}
        {active === "poster" ? <PosterStudio projectId={projectId} /> : null}
        {active === "history" ? <HistoryPage /> : null}
        {active === "eval" ? <EvalReport projectId={projectId} /> : null}
      </section>
    </div>
  );
}
