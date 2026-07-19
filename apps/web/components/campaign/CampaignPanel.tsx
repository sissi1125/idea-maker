/**
 * CampaignPanel — feat-400.4 前端
 *
 * 一次传播任务 → 3 个可比较角度并排看，每个带硬规则检查结果与去向，可单独重生成。
 * 全大白话，不用"门禁"。
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles, Loader2, RotateCcw, PlusCircle, CheckCircle2, XCircle,
  ThumbsUp, Image as ImageIcon,
  Trash2,
} from "lucide-react";
import {
  campaignsApi, claimsApi, postersApi, ApiError,
  type CampaignListItem, type CampaignDetail, type CampaignGoal, type Claim, type Decision,
} from "@/lib/api";
import { ConfirmDialog, EmptyState, PageHeader, SelectField, StatusBadge, WorkflowTrack } from "@/components/ui/ProductUi";
import { deriveContentWorkflow, workflowStepIndex } from "@/lib/content-workflow";

const GOAL_LABEL: Record<CampaignGoal, string> = {
  launch: "产品发布", feature_update: "功能更新", acquisition: "获客测试", messaging: "官网表达梳理",
};
const DECISION_LABEL: Record<Decision, { label: string; tone: "success" | "warning" | "danger" }> = {
  publish_candidate: { label: "可发布", tone: "success" },
  human_review: { label: "要人工看", tone: "warning" },
  revise: { label: "要修改", tone: "warning" },
  blocked: { label: "已拦截", tone: "danger" },
};
const RULE_LABEL: Record<string, string> = {
  unknown_claim: "引用了不存在的卖点", unapproved_claim: "引用了没批准的卖点",
  missing_evidence: "卖点缺证据", unsupported_number: "出现了没依据的数字/价格",
  banned_word: "命中敏感词", too_long: "超字数", duplicate_claim: "重复引用卖点",
};

export function CampaignPanel({ projectId }: { projectId: string }) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // 创建表单
  const [goal, setGoal] = useState<CampaignGoal>("launch");
  const [platform, setPlatform] = useState("小红书");
  const [targetAudience, setTargetAudience] = useState("");
  const [scenario, setScenario] = useState("");
  const [cta, setCta] = useState("");
  const [avoidNotes, setAvoidNotes] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deletingCampaign, setDeletingCampaign] = useState<CampaignListItem | null>(null);

  const flash = useCallback((t: { tone: "ok" | "err"; text: string }) => {
    setToast(t); setTimeout(() => setToast(null), 4000);
  }, []);

  const loadLists = useCallback(async () => {
    try {
      const [cs, cl] = await Promise.all([
        campaignsApi.listCampaigns(projectId),
        claimsApi.listClaims(projectId),
      ]);
      setCampaigns(cs);
      setClaims(cl);
    } catch (err) {
      flash({ tone: "err", text: err instanceof Error ? err.message : "加载失败" });
    } finally {
      setLoading(false);
    }
  }, [projectId, flash]);

  const loadDetail = useCallback(async (id: string) => {
    try { setDetail(await campaignsApi.getCampaign(projectId, id)); }
    catch (err) { flash({ tone: "err", text: err instanceof ApiError ? err.message : "加载失败" }); }
  }, [projectId, flash]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const approvedClaims = claims.filter((c) => c.status === "approved");
  const workflowState = useMemo(
    () => deriveContentWorkflow({ detail, busy, hasError: toast?.tone === "err" }),
    [detail, busy, toast?.tone],
  );

  async function act(key: string, fn: () => Promise<unknown>, ok: string, reloadDetail = true) {
    setBusy(key);
    try {
      await fn();
      await loadLists();
      if (reloadDetail && selectedId) await loadDetail(selectedId);
      flash({ tone: "ok", text: ok });
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "操作失败" });
    } finally { setBusy(null); }
  }

  // 3.7 一键出海报：用该角度引用的卖点自动出图（产品名+卖点+官网图）
  async function runAutoPoster(claimId: string, key: string) {
    setBusy(key);
    if (posterUrl) { URL.revokeObjectURL(posterUrl); setPosterUrl(null); }
    try {
      const r = await postersApi.autoPoster(projectId, claimId);
      if (!r.passed) {
        flash({ tone: "err", text: `没出图：${r.failures.map((f) => f.detail).join("；")}` });
      } else {
        setPosterUrl(await postersApi.posterPngUrl(projectId, r.posterId));
        flash({ tone: "ok", text: "海报已生成" });
      }
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "出图失败" });
    } finally { setBusy(null); }
  }

  async function createCampaign() {
    setBusy("create");
    try {
      const { id } = await campaignsApi.createCampaign(projectId, {
        goal,
        platform: platform || undefined,
        targetAudience: targetAudience || undefined,
        scenario: scenario || undefined,
        cta: cta || undefined,
        avoidNotes: avoidNotes || undefined,
        allowedClaimIds: [...picked],
      });
      await loadLists();
      setSelectedId(id);
      flash({ tone: "ok", text: "已创建，去生成角度吧" });
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "创建失败" });
    } finally { setBusy(null); }
  }

  /** 删除任务后同步清理当前详情，防止已删除内容继续留在界面。 */
  async function removeCampaign() {
    if (!deletingCampaign) return;
    const id = deletingCampaign.id;
    setBusy(`delete-${id}`);
    try {
      await campaignsApi.deleteCampaign(projectId, id);
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      setDeletingCampaign(null);
      await loadLists();
      flash({ tone: "ok", text: "内容任务已删除" });
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "删除失败" });
    } finally { setBusy(null); }
  }

  if (loading) {
    return <div className="text-sm text-gray-500 inline-flex items-center gap-2 p-4"><Loader2 size={14} className="animate-spin" /> 加载中…</div>;
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog open={deletingCampaign !== null} title="删除这个内容任务？" description="任务下生成的所有内容方向和评估记录会一并删除，此操作无法撤销。" confirmLabel="删除任务" busy={busy === `delete-${deletingCampaign?.id}`} onConfirm={removeCampaign} onClose={() => setDeletingCampaign(null)} />
      {toast && (
        <div className="text-xs px-3 py-2 border" style={toast.tone === "ok" ? { background: "#e9eeec", color: "var(--ok)", borderColor: "#d3ded9" } : { background: "#f4eae9", color: "var(--err)", borderColor: "#e5cfcd" }}>{toast.text}</div>
      )}

      <PageHeader title="内容创作" description="设置营销任务，选择可用卖点，生成并比较三个内容方向。" />
      <WorkflowTrack
        steps={["设置任务", "生成内容", "审核选择", "采纳保存"]}
        activeIndex={workflowStepIndex(workflowState)}
      />

      {/* 创建 Campaign */}
      <section className="bg-white border border-[var(--line)] rounded-[8px] p-5 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium">这次要做什么
          <SelectField className="text-sm" value={goal} onChange={(e) => setGoal(e.target.value as CampaignGoal)}>
            {(Object.keys(GOAL_LABEL) as CampaignGoal[]).map((g) => <option key={g} value={g}>{GOAL_LABEL[g]}</option>)}
          </SelectField>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">内容平台
            <SelectField className="text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="小红书">小红书（当前重点适配）</option>
              <option value="微博">微博</option>
              <option value="微信公众号">微信公众号</option>
              <option value="抖音">抖音</option>
              <option value="通用内容">通用内容</option>
            </SelectField>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">面向谁
            <input className="text-sm field" placeholder="例如：需要整理灵感的独立创作者" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">使用场景
            <input className="text-sm field" placeholder="例如：找不到以前记录的创作灵感" value={scenario} onChange={(e) => setScenario(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">行动引导
            <input className="text-sm field" placeholder="CTA（可选）" value={cta} onChange={(e) => setCta(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">需要避免
            <input className="text-sm field" placeholder="例如：不要夸大，不与竞品作无依据比较" value={avoidNotes} onChange={(e) => setAvoidNotes(e.target.value)} />
          </label>
        </div>
        <div>
          <div className="text-xs font-medium mb-2">希望使用的卖点</div>
          {approvedClaims.length === 0 ? (
            <EmptyState>还没有可用卖点，请先在「产品档案」中确认信息并审核卖点。</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {approvedClaims.map((c) => {
                const on = picked.has(c.id);
                return (
                  <button key={c.id}
                    className={`text-[12px] px-3 py-2 rounded-[5px] border transition-colors ${on ? "bg-brand-soft text-brand-ink border-brand" : "bg-white border-[var(--line)]"}`}
                    onClick={() => { const n = new Set(picked); if (on) n.delete(c.id); else n.add(c.id); setPicked(n); }}>
                    {c.text.slice(0, 18)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button className="btn btn-primary inline-flex items-center gap-1.5" disabled={busy === "create" || approvedClaims.length === 0} onClick={createCampaign}>
            {busy === "create" ? <Loader2 size={13} className="animate-spin" /> : <PlusCircle size={13} />} 创建内容任务
          </button>
        </div>
      </section>

      {/* 已有 Campaign 列表 */}
      {campaigns.length > 0 && (
        <div className="campaign-task-list">
          {campaigns.map((campaign) => {
            const campaignClaims = campaign.allowedClaimIds.map((id) => claims.find((claim) => claim.id === id)).filter((claim): claim is Claim => claim != null);
            return (
              <div key={campaign.id} className="campaign-task" data-active={selectedId === campaign.id}>
                <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(campaign.id)}>
                  <span className="block text-xs font-semibold">{GOAL_LABEL[campaign.goal]}{campaign.platform ? ` · ${campaign.platform}` : ""}</span>
                  <span className="flex flex-wrap gap-1 mt-1.5">
                    {campaignClaims.length > 0 ? campaignClaims.map((claim) => <span key={claim.id} className="campaign-claim-tag">{claim.text}</span>) : <span className="text-[10.5px]" style={{ color: "var(--ink-4)" }}>未指定卖点</span>}
                  </span>
                </button>
                <button className="icon-btn icon-btn-danger" title="删除内容任务" onClick={() => setDeletingCampaign(campaign)}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {/* 选中 Campaign 的角度并排比较 */}
      {detail && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {GOAL_LABEL[detail.campaign.goal]} · {detail.variants.length} 个角度
            </h3>
            <button className="btn btn-sm inline-flex items-center gap-1.5" disabled={busy === "gen"}
              onClick={() => act("gen", () => campaignsApi.generateVariants(projectId, detail.campaign.id), "已生成 3 个角度")}>
              {busy === "gen" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 生成 3 个角度
            </button>
          </div>
          {detail.variants.length === 0 ? (
            <EmptyState>任务已就绪，点击「生成 3 个角度」进入生成阶段。</EmptyState>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {detail.variants.map((v) => (
                <div key={v.id} className="card p-3 space-y-2 flex flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{v.angle}</span>
                    <StatusBadge tone={DECISION_LABEL[v.decision].tone}>{DECISION_LABEL[v.decision].label}</StatusBadge>
                  </div>
                  {v.hook && <p className="text-[11px] text-gray-400">{v.hook}</p>}
                  <p className="text-sm break-words flex-1" style={{ color: "var(--ink-2)" }}>{v.body}</p>
                  {v.cta && <p className="text-[11px] text-brand">CTA：{v.cta}</p>}
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {v.gatePassed
                      ? <span className="inline-flex items-center gap-0.5" style={{ color: "var(--ok)" }}><CheckCircle2 size={11} /> 内容检查通过</span>
                      : <span className="inline-flex items-center gap-0.5" style={{ color: "var(--err)" }}><XCircle size={11} /> 内容检查未通过</span>}
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">{v.source === "manual" ? "手写" : "生成"}</span>
                  </div>
                  {v.gateFailures.length > 0 && (
                    <ul className="text-[11px] list-disc pl-4" style={{ color: "var(--err)" }}>
                      {v.gateFailures.map((f, i) => <li key={i}>{RULE_LABEL[f.rule] ?? f.rule}</li>)}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {v.adopted ? (
                      <span className="text-[11px] inline-flex items-center gap-0.5" style={{ color: "var(--ok)" }}><CheckCircle2 size={11} /> 已采纳</span>
                    ) : (
                      <button className="btn-ghost btn-sm inline-flex items-center gap-1" disabled={busy === `adopt-${v.id}`}
                        onClick={() => act(`adopt-${v.id}`, () => campaignsApi.adoptVariant(projectId, detail.campaign.id, v.id), "已采纳该角度")}>
                        <ThumbsUp size={12} /> 采纳
                      </button>
                    )}
                    {v.claimIds.length > 0 && (
                      <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-brand" disabled={busy === `poster-${v.id}`}
                        onClick={() => runAutoPoster(v.claimIds[0], `poster-${v.id}`)}>
                        {busy === `poster-${v.id}` ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} 一键出海报
                      </button>
                    )}
                    {v.source === "generated" && (
                      <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-gray-500" disabled={busy === v.id}
                        onClick={() => act(v.id, () => campaignsApi.regenerateVariant(projectId, detail.campaign.id, v.id), "已重新生成该角度")}>
                        {busy === v.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} 重新生成
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {posterUrl && (
            <div className="border-t pt-3 space-y-1.5">
              <div className="text-sm text-gray-700 inline-flex items-center gap-1.5"><ImageIcon size={14} className="text-brand" /> 自动生成的海报</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={posterUrl} alt="海报" className="max-w-[300px] w-full rounded border" />
              <a href={posterUrl} download="poster.png" className="text-xs text-brand underline">下载 PNG</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
