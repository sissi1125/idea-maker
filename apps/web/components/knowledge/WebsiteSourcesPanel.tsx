/** 资料库官网来源：首次导入表单；已有官网时显示当前值，编辑时才展开输入。 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Globe, Loader2, Pencil, X } from "lucide-react";
import { sourcesApi, ApiError, type SourceRecord, type SourcePage } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  home: "首页", product: "产品", pricing: "价格", faq: "FAQ", help: "帮助", changelog: "更新日志", about: "关于", other: "其他",
};

export function WebsiteSourcesPanel({ projectId }: { projectId: string }) {
  const [records, setRecords] = useState<SourceRecord[]>([]);
  const [pages, setPages] = useState<SourcePage[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const current = records.find((record) => record.kind === "website") ?? null;
  const currentPages = useMemo(
    () => current ? pages.filter((page) => page.source_record_id === current.id) : [],
    [current, pages],
  );

  /** 加载完成前保持固定骨架，不先闪现首次导入表单。 */
  const load = useCallback(async () => {
    try {
      const result = await sourcesApi.listSources(projectId);
      setRecords(result.records);
      setPages(result.pages);
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof Error ? err.message : "官网来源加载失败" });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function startEdit() {
    setUrl(current?.root_url ?? "");
    setEditing(true);
    setMsg(null);
  }

  async function runImport() {
    if (!url.trim()) { setMsg({ tone: "err", text: "先填写官网域名" }); return; }
    setBusy(true); setMsg(null);
    try {
      const { result } = await sourcesApi.importWebsite(projectId, url.trim(), { replaceExisting: current != null });
      if (result.pagesFetched === 0) {
        setMsg({ tone: "err", text: "没抓到任何页面（域名不可达、全 JS 渲染或被 robots 阻止）" });
      } else {
        setMsg({ tone: "ok", text: `已更新 ${result.pagesFetched} 页，${result.ragChunksEmbedded} 段正文进入检索库` });
        setUrl("");
        setEditing(false);
        await load();
      }
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof ApiError ? err.message : "官网导入失败" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="website-source-panel">
      <div className="flex items-center gap-2 min-w-0">
        <span className="website-source-icon"><Globe size={16} /></span>
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold">官网来源</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: "var(--ink-3)" }}>官网正文用于事实检索，抓取图片进入产品档案</p>
        </div>
      </div>

      {loading ? (
        <div className="website-source-loading"><Loader2 size={14} className="animate-spin" /> 正在读取官网来源…</div>
      ) : current && !editing ? (
        <div className="website-source-current">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} style={{ color: "var(--ok)" }} />
              <a href={current.root_url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:text-[var(--brand)]">{current.root_url}</a>
            </div>
            <div className="text-[11px] mt-1" style={{ color: "var(--ink-4)" }}>{current.host} · 已抓取 {currentPages.length} 页</div>
          </div>
          <button className="btn btn-sm" onClick={startEdit}><Pencil size={12} /> 编辑</button>
        </div>
      ) : (
        <div className="website-source-editor">
          <input className="field flex-1" autoFocus={editing} placeholder="官网域名，如 https://bear.app/zh/" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runImport(); }} />
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={runImport}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}{current ? "保存并重新导入" : "导入官网"}
          </button>
          {current ? <button className="icon-btn" title="取消编辑" disabled={busy} onClick={() => { setEditing(false); setUrl(""); setMsg(null); }}><X size={14} /></button> : null}
        </div>
      )}

      {msg ? <div className="text-[11.5px]" style={{ color: msg.tone === "ok" ? "var(--ok)" : "var(--err)" }}>{msg.text}</div> : null}
      {!loading && current && !editing && currentPages.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {currentPages.slice(0, 8).map((page) => (
            <a key={page.id} href={page.url} target="_blank" rel="noreferrer" className="source-page-chip">
              <span>{TYPE_LABEL[page.page_type] ?? page.page_type}</span>{page.title || page.path}<ExternalLink size={10} />
            </a>
          ))}
          {currentPages.length > 8 ? <span className="source-page-more">另有 {currentPages.length - 8} 页</span> : null}
        </div>
      ) : null}
    </section>
  );
}
