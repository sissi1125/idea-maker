"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCircle2, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  claimsApi, CLAIM_TYPES, EVIDENCE_REQUIRED_CLAIM_TYPES, ApiError,
  type Claim, type ClaimType,
} from "@/lib/api";
import { ConfirmDialog, EmptyState, ProvenanceBadge, SelectField, StatusBadge } from "@/components/ui/ProductUi";

const TYPE_LABEL: Record<ClaimType, string> = {
  functional: "功能", outcome: "效果", differentiation: "差异化", emotional: "情感",
};

/** 产品卖点直接维护 Claim Map，平台生成与用户增删改共用同一份数据。 */
export function ClaimSuggestions({ projectId }: { projectId: string }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; type: ClaimType } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState<ClaimType>("differentiation");
  const [deleting, setDeleting] = useState<Claim | null>(null);

  /** 已删除或屏蔽的卖点不进入主列表，避免和用户当前可维护内容混在一起。 */
  const load = useCallback(async () => {
    try {
      setClaims((await claimsApi.listClaims(projectId)).filter((claim) => claim.status !== "blocked"));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "产品卖点加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 初次挂载只触发异步读取，状态更新发生在请求完成后。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** 平台从已确认档案中派生默认卖点，事实约束继续由后端 Claim 服务执行。 */
  async function derive() {
    setBusy("derive");
    try { await claimsApi.deriveClaims(projectId); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "生成卖点失败"); }
    finally { setBusy(null); }
  }

  /** 手动新增默认使用非事实型分类，用户仍可显式调整类型。 */
  async function create() {
    if (!draft.trim()) return;
    setBusy("create");
    try {
      await claimsApi.createClaim(projectId, { text: draft.trim(), claimType: draftType });
      setDraft(""); setAdding(false); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : "新增卖点失败"); }
    finally { setBusy(null); }
  }

  /** 编辑后回到待审核状态，避免已批准内容被静默替换。 */
  async function save() {
    if (!editing?.text.trim()) return;
    setBusy(editing.id);
    try {
      await claimsApi.updateClaim(projectId, editing.id, { text: editing.text.trim(), claimType: editing.type });
      setEditing(null); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : "保存卖点失败"); }
    finally { setBusy(null); }
  }

  async function approve(claim: Claim) {
    setBusy(claim.id);
    try { await claimsApi.approveClaim(projectId, claim.id); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "批准卖点失败"); }
    finally { setBusy(null); }
  }

  async function remove() {
    if (!deleting) return;
    const claim = deleting;
    setBusy(claim.id);
    try { await claimsApi.deleteClaim(projectId, claim.id); setDeleting(null); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "删除卖点失败"); }
    finally { setBusy(null); }
  }

  return (
    <section>
      <ConfirmDialog open={deleting !== null} title="删除这条产品卖点？" description="删除后，已关联这条卖点的视觉资产会自动解除关联。此操作无法撤销。" confirmLabel="删除卖点" busy={busy === deleting?.id} onConfirm={remove} onClose={() => setDeleting(null)} />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="section-heading">产品卖点</h2>
          <p className="section-subtitle">平台根据已确认的产品信息生成默认内容，你可以继续新增、编辑或删除。</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" disabled={busy === "derive"} onClick={derive}>
            {busy === "derive" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 重新生成
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Plus size={13} /> 添加卖点</button>
        </div>
      </div>

      {error ? <div className="text-xs mb-3" style={{ color: "var(--err)" }}>{error}</div> : null}
      {adding ? (
        <div className="claim-editor mb-3">
          <textarea className="field text-sm" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="输入一条清晰、可用于营销创作的产品卖点" />
          <SelectField className="field-sm text-xs" value={draftType} onChange={(e) => setDraftType(e.target.value as ClaimType)}>
            {CLAIM_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
          </SelectField>
          <button className="btn btn-sm btn-primary" disabled={!draft.trim() || busy === "create"} onClick={create}><Check size={13} /> 保存</button>
          <button className="btn-ghost btn-sm" onClick={() => setAdding(false)}><X size={13} /> 取消</button>
        </div>
      ) : null}

      {loading ? <div className="text-xs py-4" style={{ color: "var(--ink-3)" }}>正在加载产品卖点…</div> : claims.length === 0 ? (
        <EmptyState>暂无产品卖点。点击「重新生成」让平台从已确认信息中整理，也可以手动添加。</EmptyState>
      ) : (
        <div className="claim-list">
          {claims.map((claim) => {
            const current = editing?.id === claim.id;
            const lacksEvidence = EVIDENCE_REQUIRED_CLAIM_TYPES.includes(claim.claim_type) && claim.evidence_chunk_ids.length === 0;
            return (
              <article key={claim.id} className="claim-row">
                {current ? (
                  <div className="claim-editor w-full">
                    <textarea className="field text-sm" rows={2} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                    <SelectField className="field-sm text-xs" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as ClaimType })}>
                      {CLAIM_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
                    </SelectField>
                    <button className="btn btn-sm btn-primary" disabled={!editing.text.trim() || busy === claim.id} onClick={save}><Check size={13} /> 保存</button>
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}><X size={13} /> 取消</button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <StatusBadge tone={claim.status === "approved" ? "success" : "neutral"}>{claim.status === "approved" ? "已批准" : "待审核"}</StatusBadge>
                        <ProvenanceBadge source={claim.origin ?? (claim.evidence_chunk_ids.length > 0 ? "platform" : "user")} />
                        <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>{TYPE_LABEL[claim.claim_type]} · {claim.evidence_chunk_ids.length} 处依据</span>
                      </div>
                      <p className="text-sm leading-6" style={{ color: "var(--ink-2)" }}>{claim.text}</p>
                      {lacksEvidence ? <p className="text-[11px] mt-1" style={{ color: "var(--warn)" }}>事实型卖点缺少依据，暂不能批准</p> : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {claim.status !== "approved" ? <button className="btn-ghost btn-sm" disabled={busy === claim.id || lacksEvidence} onClick={() => approve(claim)}><CheckCircle2 size={13} /> 批准</button> : null}
                      <button className="icon-btn" title="编辑卖点" onClick={() => setEditing({ id: claim.id, text: claim.text, type: claim.claim_type })}><Pencil size={14} /></button>
                      <button className="icon-btn icon-btn-danger" title="删除卖点" disabled={busy === claim.id} onClick={() => setDeleting(claim)}><Trash2 size={14} /></button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
