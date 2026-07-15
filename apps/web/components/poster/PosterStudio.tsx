/**
 * PosterStudio — feat-400.5 前端
 *
 * 后置视觉资产 + 受限模板海报：上传/批准资产 → 选模板填字 → 出图。
 * 只能用已批准的资产和卖点；出图前硬规则检查（对比度/溢出/资产合法），不通过不出图。
 * 全大白话，不用"门禁"。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon, Upload, CheckCircle2, Loader2, Sparkles, Download, XCircle,
} from "lucide-react";
import {
  assetsApi, postersApi, claimsApi, ApiError,
  type VisualAsset, type PosterTemplate, type RenderResult, type Claim,
} from "@/lib/api";

const RULE_LABEL: Record<string, string> = {
  unknown_template: "模板不存在", missing_title: "标题不能为空",
  title_overflow: "标题太长", subtitle_overflow: "副标题太长", claim_overflow: "主张文字太长",
  unapproved_claim: "引用了没批准的卖点", unapproved_asset: "引用了没批准的资产",
  bad_color: "颜色格式不对", low_contrast: "前景/背景对比度太低，字看不清",
};
const KIND_LABEL: Record<string, string> = {
  logo: "Logo", product_screenshot: "产品截图", reference_poster: "参考海报", font: "字体",
};

export function PosterStudio({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [templates, setTemplates] = useState<PosterTemplate[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // 出图表单
  const [templateId, setTemplateId] = useState("simple-quote");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [claimId, setClaimId] = useState("");
  const [logoAssetId, setLogoAssetId] = useState("");
  const [bgColor, setBgColor] = useState("#4f46e5");
  const [fgColor, setFgColor] = useState("#ffffff");
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState<assetsApi.AssetKind>("logo");

  const flash = useCallback((t: { tone: "ok" | "err"; text: string }) => {
    setToast(t); setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [a, t, c] = await Promise.all([
        assetsApi.listAssets(projectId),
        postersApi.getTemplates(projectId),
        claimsApi.listClaims(projectId),
      ]);
      setAssets(a); setTemplates(t); setClaims(c);
    } catch (err) {
      flash({ tone: "err", text: err instanceof Error ? err.message : "加载失败" });
    } finally { setLoading(false); }
  }, [projectId, flash]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // 组件卸载时释放上一张预览的 object URL
  useEffect(() => () => { if (pngUrl) URL.revokeObjectURL(pngUrl); }, [pngUrl]);

  const approvedClaims = claims.filter((c) => c.status === "approved");
  const approvedLogos = assets.filter((a) => a.status === "approved" && a.kind === "logo");
  const currentTemplate = templates.find((t) => t.id === templateId);

  async function doUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { flash({ tone: "err", text: "先选一个文件" }); return; }
    setBusy("upload");
    try {
      await assetsApi.uploadAsset(projectId, file, uploadKind, file.name);
      if (fileRef.current) fileRef.current.value = "";
      await load();
      flash({ tone: "ok", text: "已上传，记得批准后才能用" });
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "上传失败" });
    } finally { setBusy(null); }
  }

  async function approve(id: string) {
    setBusy(id);
    try { await assetsApi.approveAsset(projectId, id); await load(); flash({ tone: "ok", text: "已批准" }); }
    catch (err) { flash({ tone: "err", text: err instanceof ApiError ? err.message : "失败" }); }
    finally { setBusy(null); }
  }

  async function render() {
    if (!title.trim()) { flash({ tone: "err", text: "先填标题" }); return; }
    setRendering(true); setResult(null);
    if (pngUrl) { URL.revokeObjectURL(pngUrl); setPngUrl(null); }
    try {
      const r = await postersApi.renderPoster(projectId, {
        templateId, title, subtitle: subtitle || undefined,
        claimId: claimId || undefined, logoAssetId: logoAssetId || undefined, bgColor, fgColor,
      });
      setResult(r);
      if (r.passed) setPngUrl(await postersApi.posterPngUrl(projectId, r.posterId));
    } catch (err) {
      flash({ tone: "err", text: err instanceof ApiError ? err.message : "出图失败" });
    } finally { setRendering(false); }
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
        <ImageIcon size={16} className="text-brand" /> 海报工作台
        <span className="text-xs font-normal text-gray-400">只能用已批准的资产和卖点，出图前自动查排版</span>
      </h2>

      {/* 资产上传 + 批准 */}
      <section className="card p-3 space-y-2">
        <div className="text-sm font-medium text-gray-800">视觉资产</div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="text-sm field" value={uploadKind} onChange={(e) => setUploadKind(e.target.value as assetsApi.AssetKind)}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input ref={fileRef} type="file" accept="image/*" className="text-xs" />
          <button className="btn btn-sm inline-flex items-center gap-1.5" disabled={busy === "upload"} onClick={doUpload}>
            {busy === "upload" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 上传
          </button>
        </div>
        {assets.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {assets.map((a) => (
              <div key={a.id} className="text-[11px] field flex items-center gap-1.5">
                <span className="text-gray-400">{KIND_LABEL[a.kind]}</span>
                <span className="text-gray-700">{a.label ?? a.id.slice(0, 6)}</span>
                {a.width && <span className="text-gray-300">{a.width}×{a.height}</span>}
                {a.status === "approved"
                  ? <span className="text-emerald-600 inline-flex items-center gap-0.5"><CheckCircle2 size={11} /> 已批准</span>
                  : <button className="text-brand" disabled={busy === a.id} onClick={() => approve(a.id)}>批准</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 出图表单 */}
      <section className="card p-3 space-y-2">
        <div className="text-sm font-medium text-gray-800">出图</div>
        <div className="flex flex-wrap gap-2">
          <select className="text-sm field" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.id}（{t.width}×{t.height}）</option>)}
          </select>
          <label className="text-xs text-gray-500 inline-flex items-center gap-1">底色 <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} /></label>
          <label className="text-xs text-gray-500 inline-flex items-center gap-1">字色 <input type="color" value={fgColor} onChange={(e) => setFgColor(e.target.value)} /></label>
        </div>
        <input className="w-full text-sm field" placeholder={`标题（≤${currentTemplate?.limits.title ?? 24} 字）`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="w-full text-sm field" placeholder="副标题（可选）" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <select className="text-sm field flex-1 min-w-[140px]" value={claimId} onChange={(e) => setClaimId(e.target.value)}>
            <option value="">不引用卖点</option>
            {approvedClaims.map((c) => <option key={c.id} value={c.id}>{c.text.slice(0, 24)}</option>)}
          </select>
          <select className="text-sm field flex-1 min-w-[140px]" value={logoAssetId} onChange={(e) => setLogoAssetId(e.target.value)}>
            <option value="">不放 Logo</option>
            {approvedLogos.map((a) => <option key={a.id} value={a.id}>{a.label ?? a.id.slice(0, 6)}</option>)}
          </select>
        </div>
        <button className="btn btn-sm btn-primary inline-flex items-center gap-1.5" disabled={rendering} onClick={render}>
          {rendering ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 出图
        </button>
      </section>

      {/* 结果 */}
      {result && (
        <section className="card p-3 space-y-2">
          {result.passed ? (
            <>
              <div className="text-sm text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 size={14} /> 出图成功（{result.width}×{result.height}）</div>
              {pngUrl && (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pngUrl} alt="海报预览" className="max-w-[360px] w-full rounded border" />
                  <a href={pngUrl} download="poster.png" className="btn btn-sm inline-flex items-center gap-1.5 w-fit">
                    <Download size={13} /> 下载 PNG
                  </a>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm text-red-600 inline-flex items-center gap-1.5"><XCircle size={14} /> 没出图 —— 排版检查没过</div>
              <ul className="text-xs text-red-600 list-disc pl-5">
                {result.failures.map((f, i) => <li key={i}>{RULE_LABEL[f.rule] ?? f.rule}：{f.detail}</li>)}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
