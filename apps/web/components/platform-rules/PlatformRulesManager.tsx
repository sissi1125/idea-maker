/**
 * PlatformRulesManager — feat-200.8 Week 8
 *
 * Settings 页里的"平台规则"管理面板。
 *
 * 三块：
 *   1. 已有规则列表：每条可编辑名称 / config / enabled 开关 / 删除
 *   2. 预设快捷添加：点 "+ 小红书" 等 chip 直接克隆出一条
 *   3. 新建空规则：自定义平台 / 自定义约束
 *
 * 设计取舍：
 *   - 行内展开编辑（非弹 Modal）——和 Notes 页一致的交互节奏
 *   - 删除走"二次确认行"——避免误删，但不打断浏览
 *   - config 用一个简单的 ConfigEditor（5 个字段都是可选）；不引入 react-hook-form
 *   - 预设按钮"添加预设"——已经存在同名规则时不阻塞（用户可能想要多个变种）
 */

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Plus, Trash2, Edit3, Check, X, AlertCircle, Power, ShieldCheck,
} from "lucide-react";
import { platformRulesApi, PLATFORM_PRESETS } from "@/lib/api";
import type {
  PlatformRule, PlatformRuleConfig, UpdatePlatformRuleInput,
} from "@/lib/api";

// ── ConfigEditor：5 个字段的简单表单 ────────────────────────────────────────

function ConfigEditor({
  value,
  onChange,
  disabled,
}: {
  value: PlatformRuleConfig;
  onChange: (next: PlatformRuleConfig) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof PlatformRuleConfig>(k: K, v: PlatformRuleConfig[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="grid grid-cols-2 gap-2.5 text-[12px]">
      <label className="flex flex-col gap-1">
        <span style={{ color: "var(--ink-2)" }}>整体字符上限（maxLength）</span>
        <input
          type="number" min={1}
          value={value.maxLength ?? ""}
          onChange={(e) => set("maxLength", e.target.value ? Number(e.target.value) : undefined)}
          disabled={disabled}
          className="rounded-md px-2 py-1"
          style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
          placeholder="留空 = 不限制"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span style={{ color: "var(--ink-2)" }}>话题标签 regex（mandatoryTagPattern）</span>
        <input
          type="text"
          value={value.mandatoryTagPattern ?? ""}
          onChange={(e) => set("mandatoryTagPattern", e.target.value || undefined)}
          disabled={disabled}
          className="rounded-md px-2 py-1 mono"
          style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
          placeholder="如 #\\S+"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span style={{ color: "var(--ink-2)" }}>标签最少出现次数</span>
        <input
          type="number" min={1}
          value={value.mandatoryTagMin ?? ""}
          onChange={(e) => set("mandatoryTagMin", e.target.value ? Number(e.target.value) : undefined)}
          disabled={disabled || !value.mandatoryTagPattern}
          className="rounded-md px-2 py-1"
          style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
          placeholder="默认 1"
        />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        <span style={{ color: "var(--ink-2)" }}>违禁词（逗号分隔）</span>
        <input
          type="text"
          value={(value.bannedKeywords ?? []).join(", ")}
          onChange={(e) =>
            set(
              "bannedKeywords",
              e.target.value
                ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                : undefined,
            )
          }
          disabled={disabled}
          className="rounded-md px-2 py-1"
          style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
          placeholder="如：最、第一、最佳"
        />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        <span style={{ color: "var(--ink-2)" }}>风格提示（styleHint，注入 prompt）</span>
        <textarea
          value={value.styleHint ?? ""}
          onChange={(e) => set("styleHint", e.target.value || undefined)}
          disabled={disabled} rows={2}
          className="rounded-md px-2 py-1.5 leading-[1.55] resize-y"
          style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)",
                   fontFamily: "inherit", minHeight: "60px" }}
          placeholder="LLM 写稿时遵循的风格指导，如：口语化、emoji 多、首行抓眼球"
        />
      </label>
    </div>
  );
}

// ── RuleCard：单条规则展示/编辑 ───────────────────────────────────────────

function RuleCard({
  rule,
  onUpdate,
  onDelete,
}: {
  rule: PlatformRule;
  onUpdate: (id: string, input: UpdatePlatformRuleInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rule.name);
  const [config, setConfig] = useState<PlatformRuleConfig>(rule.config);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setEditing(false);
    setName(rule.name);
    setConfig(rule.config);
    setError(null);
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const patch: UpdatePlatformRuleInput = {};
      if (name !== rule.name) patch.name = name;
      if (JSON.stringify(config) !== JSON.stringify(rule.config)) patch.config = config;
      if (Object.keys(patch).length === 0) {
        setEditing(false);
        return;
      }
      await onUpdate(rule.id, patch);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async () => {
    try {
      await onUpdate(rule.id, { enabled: !rule.enabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换启用状态失败");
    }
  };

  // 摘要 chips：把 config 压成 3-4 个 chip 让用户一眼看到
  const summaryChips: string[] = [];
  if (rule.config.maxLength) summaryChips.push(`≤ ${rule.config.maxLength} 字`);
  if (rule.config.bannedKeywords?.length) summaryChips.push(`违禁词 ${rule.config.bannedKeywords.length}`);
  if (rule.config.mandatoryTagPattern) summaryChips.push(`必含 /${rule.config.mandatoryTagPattern}/`);
  if (rule.config.styleHint) summaryChips.push("含风格提示");

  return (
    <div className="rounded-lg p-3 mb-2.5"
         style={{
           background: rule.enabled ? "#fff" : "rgba(11,17,32,.02)",
           border: `1px solid ${rule.enabled ? "var(--line)" : "var(--line-2)"}`,
           opacity: rule.enabled ? 1 : 0.65,
         }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              disabled={saving} maxLength={100}
              className="text-[13.5px] font-semibold rounded-md px-2 py-1 w-full"
              style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
            />
          ) : (
            <div className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
              {rule.name} {!rule.enabled && <span className="text-[11px] font-normal"
                                                  style={{ color: "var(--ink-4)" }}>（已禁用）</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!editing && (
            <button type="button" onClick={toggleEnabled}
                    className="btn btn-sm btn-ghost"
                    title={rule.enabled ? "禁用" : "启用"}
                    style={{ color: rule.enabled ? "var(--ok)" : "var(--ink-4)" }}>
              <Power size={12} strokeWidth={1.8} />
            </button>
          )}
          {!editing && (
            <button type="button" onClick={() => setEditing(true)}
                    className="btn btn-sm btn-ghost" title="编辑"
                    style={{ color: "var(--ink-3)" }}>
              <Edit3 size={12} strokeWidth={1.8} />
            </button>
          )}
          {!editing && (
            <button type="button" onClick={() => setConfirmDel(true)}
                    className="btn btn-sm btn-ghost" title="删除"
                    style={{ color: "var(--err)", opacity: 0.7 }}>
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2">
          <ConfigEditor value={config} onChange={setConfig} disabled={saving} />
          {error && (
            <div className="flex items-center gap-1 text-[11.5px] mt-2"
                 style={{ color: "var(--err)" }}>
              <AlertCircle size={11} /> {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-2.5">
            <button type="button" onClick={cancel} className="btn btn-sm btn-ghost"
                    style={{ color: "var(--ink-3)" }}>
              <X size={12} /> 取消
            </button>
            <button type="button" onClick={save} disabled={saving || !name.trim()}
                    className="btn btn-sm btn-primary"
                    style={{ opacity: !name.trim() || saving ? 0.5 : 1 }}>
              <Check size={12} /> {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {summaryChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {summaryChips.map((c) => (
                <span key={c} className="chip text-[10.5px] mono"
                      style={{ background: "rgba(11,17,32,.04)", color: "var(--ink-3)" }}>
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11.5px]" style={{ color: "var(--ink-4)" }}>
              （未配置任何约束）
            </div>
          )}
        </>
      )}

      {confirmDel && (
        <div className="mt-2.5 rounded-md px-3 py-2 flex items-center justify-between"
             style={{ background: "rgba(179,38,30,.05)",
                      border: "1px solid rgba(179,38,30,.18)" }}>
          <span className="text-[12px]" style={{ color: "var(--err)" }}>
            确认删除规则 &ldquo;{rule.name}&rdquo; ？
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setConfirmDel(false)}
                    className="btn btn-sm btn-ghost" style={{ color: "var(--ink-3)" }}>
              取消
            </button>
            <button type="button"
                    onClick={async () => { await onDelete(rule.id); setConfirmDel(false); }}
                    className="btn btn-sm"
                    style={{ background: "var(--err)", color: "#fff",
                             border: "1px solid var(--err)" }}>
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────────────

export function PlatformRulesManager() {
  const { id: projectId } = useParams<{ id: string }>();
  const [rules, setRules] = useState<PlatformRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingName, setCreatingName] = useState("");
  const [adding, setAdding] = useState(false);

  // 初次加载
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const { rules } = await platformRulesApi.listRules(projectId);
        if (cancelled) return;
        setRules(rules);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const handleUpdate = async (id: string, input: UpdatePlatformRuleInput) => {
    if (!projectId) return;
    const { rule } = await platformRulesApi.updateRule(projectId, id, input);
    setRules((prev) => prev.map((r) => (r.id === id ? rule : r)));
  };

  const handleDelete = async (id: string) => {
    if (!projectId) return;
    await platformRulesApi.deleteRule(projectId, id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleAddPreset = async (presetKey: string) => {
    if (!projectId || adding) return;
    const preset = PLATFORM_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    setAdding(true); setError(null);
    try {
      const { rule } = await platformRulesApi.createRule(projectId, {
        name: preset.name,
        config: preset.config,
      });
      setRules((prev) => [...prev, rule]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加预设失败");
    } finally {
      setAdding(false);
    }
  };

  const handleCreateCustom = async () => {
    if (!projectId || !creatingName.trim() || adding) return;
    setAdding(true); setError(null);
    try {
      const { rule } = await platformRulesApi.createRule(projectId, {
        name: creatingName.trim(),
        config: {},
      });
      setRules((prev) => [...prev, rule]);
      setCreatingName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建失败");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 预设快捷添加 */}
      <div>
        <div className="text-[11.5px] font-semibold mb-2 tracking-wider uppercase"
             style={{ color: "var(--ink-3)" }}>
          快速添加预设
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORM_PRESETS.map((p) => (
            <button
              key={p.key} type="button"
              onClick={() => handleAddPreset(p.key)}
              disabled={adding}
              className="rounded-full text-[12px] font-medium px-3 py-1 inline-flex items-center gap-1"
              style={{
                border: "1px solid var(--line)",
                background: "#fff", color: "var(--ink-2)",
                opacity: adding ? 0.5 : 1,
                transition: ".15s",
              }}>
              <Plus size={11} strokeWidth={2} />
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* 现有规则列表 */}
      <div>
        <div className="text-[11.5px] font-semibold mb-2 tracking-wider uppercase flex items-center gap-1.5"
             style={{ color: "var(--ink-3)" }}>
          <ShieldCheck size={11} strokeWidth={1.8} />
          已有规则 {rules.length > 0 && `(${rules.length})`}
        </div>
        {error && (
          <div className="rounded-md p-2.5 mb-2 text-[12px] flex items-center gap-1.5"
               style={{ background: "rgba(179,38,30,.06)", color: "var(--err)" }}>
            <AlertCircle size={11} /> {error}
          </div>
        )}
        {loading ? (
          <div className="text-[12px]" style={{ color: "var(--ink-4)" }}>加载中…</div>
        ) : rules.length === 0 ? (
          <div className="text-[12.5px] rounded-md p-3"
               style={{ background: "rgba(11,17,32,.02)",
                        border: "1px dashed var(--line-strong)",
                        color: "var(--ink-3)" }}>
            还没有平台规则。点上方预设快速添加，或在下面新建一个自定义规则。
          </div>
        ) : (
          rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* 自定义新建 */}
      <div>
        <div className="text-[11.5px] font-semibold mb-2 tracking-wider uppercase"
             style={{ color: "var(--ink-3)" }}>
          新建自定义规则
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text" value={creatingName}
            onChange={(e) => setCreatingName(e.target.value)}
            disabled={adding} maxLength={100}
            placeholder="规则名称（如：知乎专业回答）"
            className="rounded-md px-2.5 py-1.5 text-[12.5px] flex-1"
            style={{ border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreateCustom(); }}
          />
          <button
            type="button" onClick={handleCreateCustom}
            disabled={adding || !creatingName.trim()}
            className="btn btn-sm btn-primary"
            style={{ opacity: !creatingName.trim() || adding ? 0.5 : 1 }}>
            <Plus size={12} strokeWidth={2} /> 新建
          </button>
        </div>
      </div>
    </div>
  );
}
