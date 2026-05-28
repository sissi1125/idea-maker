/**
 * RuleSelector — feat-200.8 Week 8
 *
 * Chat 主界面 ChatInput 上方的"启用平台规则" chip 多选。
 *
 * 行为：
 *   - 列出项目所有 enabled=true 规则，禁用的不显示（用户在 Settings 里编辑禁用 = 临时撤掉）
 *   - 多选：点 chip 加入；再点撤销
 *   - 空状态：链接去 Settings 添加规则
 *
 * 不在范围：拖拽排序 / 持久化选中（每次进入页面默认为空，避免用户记忆负担）
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ShieldCheck, Settings as SettingsIcon } from "lucide-react";
import { platformRulesApi } from "@/lib/api";
import type { PlatformRule } from "@/lib/api";

interface Props {
  projectId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** 触发重新拉取（外部点了"已保存到 Settings"后可能要刷新本组件） */
  reloadTick?: number;
}

export function RuleSelector({ projectId, selectedIds, onChange, reloadTick }: Props) {
  const [rules, setRules] = useState<PlatformRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const { rules } = await platformRulesApi.listRules(projectId);
        if (cancelled) return;
        // 只显示启用的
        setRules(rules.filter((r) => r.enabled));
      } catch {
        // 静默：没规则就空数组
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, reloadTick]);

  if (loading) return null;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (rules.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[11.5px] mb-2"
           style={{ color: "var(--ink-4)" }}>
        <ShieldCheck size={11} strokeWidth={1.8} />
        <span>未配置平台规则。</span>
        <Link href={`/projects/${projectId}/settings`}
              className="inline-flex items-center gap-0.5"
              style={{ color: "var(--brand)" }}>
          <SettingsIcon size={10} strokeWidth={1.8} />
          去设置添加 →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium"
            style={{ color: "var(--ink-3)" }}>
        <ShieldCheck size={11} strokeWidth={1.8} />
        启用规则：
      </span>
      {rules.map((r) => {
        const active = selectedIds.includes(r.id);
        return (
          <button
            key={r.id} type="button"
            onClick={() => toggle(r.id)}
            className="rounded-full text-[11.5px] font-medium px-2.5 py-0.5"
            style={{
              border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
              background: active ? "var(--brand-soft)" : "#fff",
              color: active ? "var(--brand)" : "var(--ink-3)",
              transition: ".15s",
            }}
            title={r.name}
          >
            {active ? "✓ " : ""}{r.name}
          </button>
        );
      })}
    </div>
  );
}
