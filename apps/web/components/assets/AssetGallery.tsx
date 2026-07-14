/**
 * AssetGallery — 验收 3.3
 * 视觉资产画廊：官网导入自动抓的图 + 用户上传，缩略图展示 + 批准。
 */

"use client";

/* eslint-disable @next/next/no-img-element -- 缩略图用 blob object URL，next/image 不适用 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2, Loader2, Image as ImageIcon } from "lucide-react";
import { assetsApi, ApiError, type VisualAsset } from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  logo: "Logo", product_screenshot: "主图/截图", reference_poster: "参考海报", font: "字体",
};

export function AssetGallery({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<assetsApi.AssetKind>("logo");
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await assetsApi.listAssets(projectId);
      setAssets(list);
      // 拉缩略图（图片类）
      const next: Record<string, string> = {};
      await Promise.all(
        list.filter((a) => a.kind !== "font").map(async (a) => {
          try { next[a.id] = await assetsApi.assetFileUrl(projectId, a.id); } catch { /* skip */ }
        }),
      );
      setThumbs((prev) => {
        Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => () => { Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u)); }, [thumbs]);

  async function doUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("先选一个文件"); return; }
    setBusy("upload"); setErr(null);
    try {
      await assetsApi.uploadAsset(projectId, file, uploadKind, file.name);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "上传失败"); }
    finally { setBusy(null); }
  }
  async function approve(id: string) {
    setBusy(id);
    try { await assetsApi.approveAsset(projectId, id); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "失败"); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="text-xs text-gray-400 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 加载资产…</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">官网导入会自动抓 logo/主图（待批准）；也可自己上传</span>
        <div className="flex items-center gap-1.5">
          <select className="text-xs field field-sm" value={uploadKind} onChange={(e) => setUploadKind(e.target.value as assetsApi.AssetKind)}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input ref={fileRef} type="file" accept="image/*" className="text-[11px] w-40" />
          <button className="btn-ghost btn-sm inline-flex items-center gap-1 text-brand" disabled={busy === "upload"} onClick={doUpload}>
            {busy === "upload" ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} 上传
          </button>
        </div>
      </div>
      {err && <div className="text-[11px] text-red-500">{err}</div>}
      {assets.length === 0 ? (
        <div className="text-[11px] text-gray-400 italic border border-dashed rounded px-3 py-3 inline-flex items-center gap-1.5">
          <ImageIcon size={12} /> 还没有图片。去「产品档案」上方导入官网，或直接上传。
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {assets.map((a) => (
            <div key={a.id} className="w-28 border rounded overflow-hidden">
              <div className="h-20 bg-gray-50 flex items-center justify-center overflow-hidden">
                {thumbs[a.id]
                  ? <img src={thumbs[a.id]} alt={a.label ?? ""} className="max-h-20 max-w-full object-contain" />
                  : <ImageIcon size={20} className="text-gray-300" />}
              </div>
              <div className="p-1.5 space-y-0.5">
                <div className="text-[10px] text-gray-500 truncate">{KIND_LABEL[a.kind]} · {a.width}×{a.height}</div>
                {a.status === "approved"
                  ? <span className="text-[10px] text-emerald-600 inline-flex items-center gap-0.5"><CheckCircle2 size={10} /> 已批准</span>
                  : <button className="text-[10px] text-brand" disabled={busy === a.id} onClick={() => approve(a.id)}>{busy === a.id ? "…" : "批准"}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
