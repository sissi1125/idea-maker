/**
 * CampaignPanel — feat-400.4 前端
 *
 * 一次传播任务 → 3 个可比较角度并排看，每个带硬规则检查结果与去向，可单独重生成。
 * 全大白话，不用"门禁"。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Megaphone, Sparkles, Loader2, RotateCcw, PlusCircle, CheckCircle2, XCircle,
  ThumbsUp, Image as ImageIcon,
} from "lucide-react";
import {
  campaignsApi, claimsApi, postersApi, ApiError,
  type CampaignListItem, type CampaignDetail, type CampaignGoal, type Claim, type Decision,
} from "@/lib/api";

const GOAL_LABEL: Record<CampaignGoal, string> = {
  launch: "产品发布", feature_update: "功能更新", acquisition: "获客测试", messaging: "官网表达梳理",
};
const DECISION_LABEL: Record<Decision, { label: string; cls: string }> = {
  publish_candidate: { label: "可发布", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  human_review: { label: "要人工看", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  revise: { label: "要改", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  blocked: { label: "已拦下", cls: "bg-red-50 text-red-600 border-red-200" },
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
  const [platform, setPlatform] = useState("");
  const [cta, setCta] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

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
        goal, platform: platform || undefined, cta: cta || undefined,
        allowedClaimIds: [...picked],
      });
      await loadLists();
      setSelectedId(id);
      flash({ tone: "ok", text: "已创建，去生成角度吧" });
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "创建失败" });
    } finally { setBusy(null); }
  }

  if (loading) {
    return <div className="text-sm text-gray-500 inline-flex items-center gap-2 p-4"><Loader2 size={14} className="animate-spin" /> 加载中…</div>;
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`text-xs px-3 py-2 rounded border ${toast.tone === "ok" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"}`}>{toast.text}</div>
      )}

      <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
        <Megaphone size={16} className="text-brand" /> 内容包
        <span className="text-xs font-normal text-gray-400">一次任务生成 3 个可比较角度，并排看去向</span>
      </h2>

      {/* 创建 Campaign */}
      <div className="card p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select className="text-sm field" value={goal} onChange={(e) => setGoal(e.target.value as CampaignGoal)}>
            {(Object.keys(GOAL_LABEL) as CampaignGoal[]).map((g) => <option key={g} value={g}>{GOAL_LABEL[g]}</option>)}
          </select>
          <input className="text-sm field flex-1 min-w-[120px]" placeholder="平台（如 小红书）" value={platform} onChange={(e) => setPlatform(e.target.value)} />
          <input className="text-sm field flex-1 min-w-[120px]" placeholder="CTA（可选）" value={cta} onChange={(e) => setCta(e.target.value)} />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">可用卖点（只列已批准）：</div>
          {approvedClaims.length === 0 ? (
            <div className="text-[11px] text-gray-400">还没有已批准卖点，先去「内容与卖点」批准</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {approvedClaims.map((c) => {
                const on = picked.has(c.id);
                return (
                  <button key={c.id}
                    className={`text-[11px] px-2 py-1 rounded border ${on ? "bg-brand-soft text-brand-ink border-brand" : "bg-white text-gray-600 border-gray-200"}`}
                    onClick={() => { const n = new Set(picked); if (on) n.delete(c.id); else n.add(c.id); setPicked(n); }}>
                    {c.text.slice(0, 18)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button className="btn btn-sm btn-primary inline-flex items-center gap-1.5" disabled={busy === "create"} onClick={createCampaign}>
          {busy === "create" ? <Loader2 size={13} className="animate-spin" /> : <PlusCircle size={13} />} 新建内容包
        </button>
      </div>

      {/* 已有 Campaign 列表 */}
      {campaigns.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {campaigns.map((c) => (
            <button key={c.id}
              className={`text-xs px-2.5 py-1.5 rounded border ${selectedId === c.id ? "bg-brand-soft text-brand-ink border-brand" : "bg-white text-gray-600 border-gray-200"}`}
              onClick={() => setSelectedId(c.id)}>
              {GOAL_LABEL[c.goal]}{c.platform ? ` · ${c.platform}` : ""}
            </button>
          ))}
        </div>
      )}

      {/* 选中 Campaign 的角度并排比较 */}
      {detail && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">
              {GOAL_LABEL[detail.campaign.goal]} · {detail.variants.length} 个角度
            </h3>
            <button className="btn btn-sm inline-flex items-center gap-1.5" disabled={busy === "gen"}
              onClick={() => act("gen", () => campaignsApi.generateVariants(projectId, detail.campaign.id), "已生成 3 个角度")}>
              {busy === "gen" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 生成 3 个角度
            </button>
          </div>
          {detail.variants.length === 0 ? (
            <div className="text-xs text-gray-400 italic border border-dashed rounded px-3 py-3">还没有角度，点「生成 3 个角度」。</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {detail.variants.map((v) => (
                <div key={v.id} className="card p-3 space-y-2 flex flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-800">{v.angle}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${DECISION_LABEL[v.decision].cls}`}>{DECISION_LABEL[v.decision].label}</span>
                  </div>
                  {v.hook && <p className="text-[11px] text-gray-400">{v.hook}</p>}
                  <p className="text-sm text-gray-700 break-words flex-1">{v.body}</p>
                  {v.cta && <p className="text-[11px] text-brand">CTA：{v.cta}</p>}
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {v.gatePassed
                      ? <span className="inline-flex items-center gap-0.5 text-emerald-600"><CheckCircle2 size={11} /> 硬规则检查通过</span>
                      : <span className="inline-flex items-center gap-0.5 text-red-500"><XCircle size={11} /> 硬规则检查没过</span>}
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">{v.source === "manual" ? "手写" : "生成"}</span>
                  </div>
                  {v.gateFailures.length > 0 && (
                    <ul className="text-[11px] text-red-600 list-disc pl-4">
                      {v.gateFailures.map((f, i) => <li key={i}>{RULE_LABEL[f.rule] ?? f.rule}</li>)}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {v.adopted ? (
                      <span className="text-[11px] text-emerald-700 inline-flex items-center gap-0.5"><CheckCircle2 size={11} /> 已采纳</span>
                    ) : (
                      <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-emerald-700" disabled={busy === `adopt-${v.id}`}
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
