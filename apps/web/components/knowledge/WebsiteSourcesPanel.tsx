/**
 * WebsiteSourcesPanel — 验收 3.1 / 产品逻辑修正
 * 知识库里：导入官网（受限爬取）+ 展示来源与页面链接。
 * 官网正文进 RAG，自动抓到的 logo/主图落到「产品档案」的视觉资产。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, ExternalLink, Loader2 } from "lucide-react";
import { sourcesApi, ApiError, type SourceRecord, type SourcePage } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  home: "首页", product: "产品", pricing: "价格", faq: "FAQ", help: "帮助", changelog: "更新日志", about: "关于", other: "其他",
};

export function WebsiteSourcesPanel({ projectId }: { projectId: string }) {
  const [records, setRecords] = useState<SourceRecord[]>([]);
  const [pages, setPages] = useState<SourcePage[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await sourcesApi.listSources(projectId);
      setRecords(r.records);
      setPages(r.pages);
    } catch { /* 静默 */ }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function runImport() {
    if (!url.trim()) { setMsg({ tone: "err", text: "先填官网域名" }); return; }
    setBusy(true); setMsg(null);
    try {
      const { result } = await sourcesApi.importWebsite(projectId, url.trim());
      if (result.pagesFetched === 0) {
        setMsg({ tone: "err", text: "没抓到任何页面（域名不可达 / 全 JS 渲染 / 被 robots 挡）" });
      } else {
        setMsg({ tone: "ok", text: `抓了 ${result.pagesFetched} 页 · ${result.ragChunksEmbedded} 段正文进检索库 · ${result.assetsImported} 张图（去「产品档案」批准）` });
        setUrl("");
        await load();
      }
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "官网导入失败" });
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-3.5 rounded-[11px] border bg-white p-3.5 space-y-2.5" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-1.5">
        <Globe size={15} className="text-brand" />
        <span className="text-[13.5px] font-semibold">官网导入</span>
        <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          受限爬取官方页面：正文喂检索，logo/主图落到产品档案（待批准）
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input className="flex-1 field" placeholder="官网域名，如 https://bear.app/zh/" value={url}
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runImport(); }} />
        <button className="btn btn-sm btn-primary inline-flex items-center gap-1.5" disabled={busy} onClick={runImport}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />} 导入官网
        </button>
      </div>
      {msg && (
        <div className={`text-[11.5px] ${msg.tone === "ok" ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</div>
      )}
      {records.length > 0 && (
        <div>
          <div className="text-[11.5px] mb-1" style={{ color: "var(--ink-3)" }}>
            已导入：{records.map((r) => r.host).join("、")} · {pages.length} 页
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pages.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer"
                className="text-[11.5px] px-2 py-1 rounded border inline-flex items-center gap-1 hover:bg-gray-50"
                style={{ borderColor: "var(--line)", color: "var(--ink-2)" }}>
                <span className="text-gray-400">{TYPE_LABEL[p.page_type] ?? p.page_type}</span>
                {p.title || p.path}
                <ExternalLink size={10} className="text-gray-300" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
