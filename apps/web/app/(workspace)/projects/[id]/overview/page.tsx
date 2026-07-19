"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, FileText, MessageSquare, PenLine, ShieldCheck } from "lucide-react";
import { campaignsApi, claimsApi, documentsApi, productBriefApi } from "@/lib/api";
import type { BriefSnapshot, CampaignListItem, Claim, MvpDocument } from "@/lib/api";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { PageHeader, ProjectGuide } from "@/components/ui/ProductUi";

type OverviewData = {
  documents: MvpDocument[];
  brief: BriefSnapshot | null;
  claims: Claim[];
  campaigns: CampaignListItem[];
};

const EMPTY_DATA: OverviewData = { documents: [], brief: null, claims: [], campaigns: [] };

/**
 * 项目总览只聚合现有接口，并在前端派生下一步；不新建后端工作流状态机，
 * 避免 UI 改造反向侵入 Product Brief 与 Agent 的事实链路。
 */
export default function ProjectOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { setCurrentProject, currentProject } = useProjectsStore();
  const [data, setData] = useState<OverviewData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setCurrentProject(projectId);

    async function load() {
      try {
        const [documents, brief, claims, campaigns] = await Promise.all([
          documentsApi.listDocuments(projectId).then((result) => result.documents),
          productBriefApi.getBrief(projectId).catch(() => null),
          claimsApi.listClaims(projectId).catch(() => []),
          campaignsApi.listCampaigns(projectId).catch(() => []),
        ]);
        setData({ documents, brief, claims, campaigns });
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "项目状态加载失败");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [projectId, setCurrentProject]);

  const next = useMemo(() => {
    if (data.documents.length === 0) {
      return { step: 1 as const, title: "添加第一份产品资料", description: "上传产品手册、更新日志，或导入你的官方网站。", label: "添加产品资料", path: "knowledge" };
    }
    const pendingFields = data.brief?.fields.filter((field) => field.status === "candidate" || field.status === "stale").length ?? 0;
    if (!data.brief || data.brief.brief.status !== "confirmed" || pendingFields > 0) {
      return { step: 2 as const, title: `确认${pendingFields > 0 ? ` ${pendingFields} 条` : ""}产品信息`, description: "确认 AI 从资料中整理出的事实，只有确认的信息才能进入内容创作。", label: "继续确认", path: "brief" };
    }
    const approved = data.claims.filter((claim) => claim.status === "approved").length;
    if (approved === 0) {
      return { step: 2 as const, title: "审核可用于创作的卖点", description: "从已确认的产品信息中整理卖点，并选择哪些表达可以用于营销内容。", label: "审核可用卖点", path: "content" };
    }
    if (data.campaigns.length === 0) {
      return { step: 3 as const, title: "创建第一组营销内容", description: "选择任务、平台、受众和可用卖点，比较三个不同的内容方向。", label: "开始内容创作", path: "campaign" };
    }
    return { step: 4 as const, title: "继续核查和管理内容", description: "查看内容候选的事实依据、平台规则结果和人工决策。", label: "打开内容资产", path: "assets" };
  }, [data]);

  const project = currentProject();
  const confirmedFields = data.brief?.fields.filter((field) => field.status === "confirmed").length ?? 0;
  const totalFields = data.brief?.fields.length ?? 0;
  const approvedClaims = data.claims.filter((claim) => claim.status === "approved").length;

  return (
    <div className="page-shell">
      <PageHeader
        title={project?.name ?? "项目总览"}
        description="从产品资料到可核查营销内容，始终知道下一步做什么。"
        actions={<button className="btn" onClick={() => router.push(`/projects/${projectId}`)}><MessageSquare size={15} />AI 对话</button>}
      />

      {error ? <div className="status-banner mb-5" style={{ borderLeftColor: "var(--err)" }}>{error}</div> : null}

      <ProjectGuide
        current={next.step}
        nextTitle={loading ? "正在整理项目状态..." : next.title}
        nextDescription={next.description}
        action={(
          <button className="btn btn-primary min-w-[160px]" disabled={loading} onClick={() => router.push(`/projects/${projectId}/${next.path}`)}>
            {next.label}<ArrowRight size={15} />
          </button>
        )}
      />

      <section className="section-divider">
        <h2 className="section-title mb-3">项目状态</h2>
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-4 border border-[var(--line)] bg-[var(--line)] rounded-[8px] overflow-hidden">
          {[
            { icon: FileText, value: data.documents.length, label: "产品资料", hint: data.documents.length ? "已添加" : "等待添加" },
            { icon: BadgeCheck, value: `${confirmedFields}/${totalFields}`, label: "已确认信息", hint: totalFields ? "来自产品资料" : "尚未整理" },
            { icon: ShieldCheck, value: approvedClaims, label: "可用卖点", hint: approvedClaims ? "可进入创作" : "等待审核" },
            { icon: PenLine, value: data.campaigns.length, label: "内容任务", hint: data.campaigns.length ? "已创建" : "尚未创建" },
          ].map(({ icon: Icon, value, label, hint }) => (
            <div key={label} className="bg-white p-5 min-h-[128px]">
              <Icon size={17} style={{ color: "var(--ink-3)" }} />
              <div className="text-2xl font-semibold mt-4">{loading ? "-" : value}</div>
              <div className="text-xs font-medium mt-1">{label}</div>
              <div className="text-[11px] mt-1" style={{ color: "var(--ink-4)" }}>{hint}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-divider">
        <div className="flex items-center justify-between mb-3"><h2 className="section-title">快速入口</h2></div>
        <div className="grid gap-3 md:grid-cols-3">
          <button className="card text-left p-4" onClick={() => router.push(`/projects/${projectId}/knowledge`)}>
            <FileText size={17} /><div className="text-sm font-semibold mt-4">管理资料库</div><p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>上传文件、导入官网并查看处理状态</p>
          </button>
          <button className="card text-left p-4" onClick={() => router.push(`/projects/${projectId}/campaign`)}>
            <PenLine size={17} /><div className="text-sm font-semibold mt-4">创建营销内容</div><p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>使用已确认信息生成多平台内容候选</p>
          </button>
          <button className="card text-left p-4" onClick={() => router.push(`/projects/${projectId}`)}>
            <MessageSquare size={17} /><div className="text-sm font-semibold mt-4">打开 AI 对话</div><p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>自由探索、追问资料或继续修改内容</p>
          </button>
        </div>
      </section>
    </div>
  );
}
