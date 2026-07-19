/** 视觉资产画廊：平台抓取与用户上传图片共用卡片、标签和卖点关联。 */
"use client";

/* eslint-disable @next/next/no-img-element -- 鉴权图片通过 blob URL 展示 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Image as ImageIcon, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { assetsApi, claimsApi, ApiError, type AssetKind, type Claim, type VisualAsset } from "@/lib/api";
import { ConfirmDialog, ProvenanceBadge, SelectField, StatusBadge } from "@/components/ui/ProductUi";

const EDITABLE_KINDS: Array<{ value: AssetKind; label: string }> = [
  { value: "logo", label: "Logo" }, { value: "hero_image", label: "主图" },
  { value: "atmosphere", label: "氛围素材" }, { value: "feature_screenshot", label: "功能截图" },
];

/** 历史类型只在展示时映射，用户保存后使用新枚举。 */
function editableKind(kind: AssetKind): AssetKind {
  if (kind === "product_screenshot") return "hero_image";
  if (kind === "reference_poster" || kind === "font") return "atmosphere";
  return kind;
}

export function AssetGallery({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<VisualAsset | null>(null);

  /** 缩略图走鉴权请求；替换列表时释放旧 object URL。 */
  const load = useCallback(async () => {
    try {
      const [assetRows, claimRows] = await Promise.all([assetsApi.listAssets(projectId), claimsApi.listClaims(projectId).catch(() => [])]);
      setAssets(assetRows); setClaims(claimRows.filter((claim) => claim.status !== "blocked"));
      const next: Record<string, string> = {};
      await Promise.all(assetRows.map(async (asset) => { try { next[asset.id] = await assetsApi.assetFileUrl(projectId, asset.id); } catch { /* 单图失败不阻塞 */ } }));
      setThumbs((previous) => { Object.values(previous).forEach((url) => URL.revokeObjectURL(url)); return next; });
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : "视觉资产加载失败"); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => {
    // 初次挂载只触发异步读取，状态更新发生在请求完成后。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => () => { Object.values(thumbs).forEach((url) => URL.revokeObjectURL(url)); }, [thumbs]);

  /** 选择后立即批量上传，默认归为功能截图，随后由用户在卡片内改标签。 */
  async function upload(files: FileList | null) {
    const images = Array.from(files ?? []);
    if (images.length === 0) return;
    setBusy("upload"); setUploadProgress({ done: 0, total: images.length }); setError(null);
    const failures: string[] = [];
    for (let index = 0; index < images.length; index++) {
      const file = images[index];
      try { await assetsApi.uploadAsset(projectId, file, "feature_screenshot", file.name); }
      catch (err) { failures.push(`${file.name}：${err instanceof ApiError ? err.message : "上传失败"}`); }
      setUploadProgress({ done: index + 1, total: images.length });
    }
    if (fileRef.current) fileRef.current.value = "";
    await load(); setBusy(null); setUploadProgress(null);
    if (failures.length) setError(failures.join("；"));
  }

  /** 标签即时持久化，失败时重载后端值避免假保存。 */
  async function updateTags(asset: VisualAsset, next: { kind?: AssetKind; claimId?: string | null }) {
    setBusy(`tags-${asset.id}`);
    try {
      const updated = await assetsApi.updateAssetTags(projectId, asset.id, { kind: next.kind ?? editableKind(asset.kind), claimId: next.claimId === undefined ? asset.claim_id : next.claimId });
      setAssets((rows) => rows.map((row) => row.id === updated.id ? updated : row)); setError(null);
    } catch (err) { setError(err instanceof ApiError ? err.message : "标签保存失败"); await load(); }
    finally { setBusy(null); }
  }

  async function approve(assetId: string) {
    setBusy(`approve-${assetId}`);
    try { const updated = await assetsApi.approveAsset(projectId, assetId); setAssets((rows) => rows.map((row) => row.id === updated.id ? updated : row)); }
    catch (err) { setError(err instanceof ApiError ? err.message : "批准失败"); }
    finally { setBusy(null); }
  }

  async function remove() {
    if (!deleting) return;
    const asset = deleting;
    setBusy(`delete-${asset.id}`);
    try { await assetsApi.deleteAsset(projectId, asset.id); setDeleting(null); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "删除图片失败"); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="text-xs inline-flex items-center gap-1.5" style={{ color: "var(--ink-3)" }}><Loader2 size={12} className="animate-spin" /> 加载视觉资产…</div>;

  return (
    <section>
      <ConfirmDialog open={deleting !== null} title="删除这张图片？" description="图片会从视觉资产和存储空间中永久删除，已生成的历史内容不会受到影响。" confirmLabel="删除图片" busy={busy === `delete-${deleting?.id}`} onConfirm={remove} onClose={() => setDeleting(null)} />
      <div className="mb-5">
        <h2 className="section-heading">视觉资产</h2>
        <p className="section-subtitle">平台会从官网或产品文档抓取图片；你也可以批量上传，再为每张图片设置类型和对应卖点。</p>
      </div>
      {error ? <div className="text-xs mb-3" style={{ color: "var(--err)" }}>{error}</div> : null}
      <div className="asset-grid">
        {assets.map((asset) => {
          const saving = busy === `tags-${asset.id}`;
          return (
            <article key={asset.id} className="asset-card">
              <div className="asset-preview">
                {thumbs[asset.id] ? <img src={thumbs[asset.id]} alt={asset.label ?? "产品视觉资产"} className="w-full h-full object-contain" /> : <ImageIcon size={24} style={{ color: "var(--ink-4)" }} />}
                <button className="asset-delete" title="删除图片" disabled={busy === `delete-${asset.id}`} onClick={() => setDeleting(asset)}><Trash2 size={14} /></button>
              </div>
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-xs font-medium truncate" title={asset.label ?? undefined}>{asset.label || "未命名图片"}</div>
                  {asset.status === "approved" ? <StatusBadge tone="success"><CheckCircle2 size={11} />已批准</StatusBadge> : <button className="btn btn-sm" disabled={busy === `approve-${asset.id}`} onClick={() => approve(asset.id)}>批准</button>}
                </div>
                <ProvenanceBadge source={asset.origin ?? (asset.label?.startsWith("官网") ? "website" : "user")} />
                <label className="grid gap-1 text-[11px]" style={{ color: "var(--ink-3)" }}>图片类型
                  <SelectField className="field-sm text-xs" disabled={saving} value={editableKind(asset.kind)} onChange={(e) => updateTags(asset, { kind: e.target.value as AssetKind })}>{EDITABLE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</SelectField>
                </label>
                <label className="grid gap-1 text-[11px]" style={{ color: "var(--ink-3)" }}>对应卖点
                  <SelectField className="field-sm text-xs" disabled={saving} value={asset.claim_id ?? ""} onChange={(e) => updateTags(asset, { claimId: e.target.value || null })}><option value="">未关联卖点</option>{claims.map((claim) => <option key={claim.id} value={claim.id}>{claim.text}</option>)}</SelectField>
                </label>
                <div className="text-[10px]" style={{ color: "var(--ink-4)" }}>{asset.width ?? "-"} × {asset.height ?? "-"}{saving ? " · 正在保存…" : ""}</div>
              </div>
            </article>
          );
        })}
        <button className="asset-upload-card" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>
          <span className="asset-upload-icon">{busy === "upload" ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}</span>
          <span className="text-sm font-semibold">添加图片</span>
          <span className="text-[11px] leading-5" style={{ color: "var(--ink-3)" }}>{uploadProgress ? `正在上传 ${uploadProgress.done}/${uploadProgress.total}` : "支持批量上传 PNG、JPG、WebP 等图片"}</span>
          <span className="btn btn-sm mt-1"><Upload size={12} /> 选择图片</span>
        </button>
      </div>
      <input ref={fileRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => void upload(event.target.files)} />
    </section>
  );
}
