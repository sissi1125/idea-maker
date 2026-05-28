/**
 * ViolationsBanner — feat-200.8 Week 8
 *
 * 在 GeneratedResult / History 的生成结果上方显示平台合规违规。
 * 每条违规一行：图标 + 规则名 + 中文消息。violations.length === 0 不渲染。
 *
 * 颜色策略：所有违规统一为橙黄色 warn 调，不阻塞用户保存到笔记库；
 * 由用户自己决定要不要按提示修改。
 */

"use client";

import { AlertTriangle } from "lucide-react";
import type { ViolationItem } from "@/lib/api";

interface Props {
  violations: ViolationItem[];
}

const TYPE_LABEL: Record<ViolationItem["type"], string> = {
  max_length: "字数超限",
  banned_keyword: "违禁词",
  missing_tag: "标签不足",
};

export function ViolationsBanner({ violations }: Props) {
  if (!violations || violations.length === 0) return null;

  return (
    <div className="rounded-lg p-3 mb-3.5"
         style={{
           background: "rgba(214,140,40,.07)",
           border: "1px solid rgba(214,140,40,.3)",
         }}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold mb-2"
           style={{ color: "var(--tool)" }}>
        <AlertTriangle size={12} strokeWidth={2} />
        平台合规检查发现 {violations.length} 处问题
      </div>
      <div className="flex flex-col gap-1.5">
        {violations.map((v, i) => (
          <div key={i} className="text-[12px] leading-[1.55] flex items-start gap-2"
               style={{ color: "var(--ink-2)" }}>
            <span className="chip mono text-[10px] flex-none"
                  style={{ background: "rgba(214,140,40,.15)", color: "var(--tool)" }}>
              {TYPE_LABEL[v.type] ?? v.type}
            </span>
            <span>
              <b style={{ color: "var(--ink)" }}>{v.ruleName}</b>：{v.message}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[11px] mt-2" style={{ color: "var(--ink-4)" }}>
        提示：违规不影响保存到笔记库；你可以手动修改后再发布，或在 Settings 调整规则。
      </div>
    </div>
  );
}
