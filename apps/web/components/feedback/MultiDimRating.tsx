/**
 * MultiDimRating — feat-200.7 Week 7
 *
 * 4 维评分输入控件：relevance / accuracy / creativity / overall（各 1-5 整数 + null）
 *
 * 设计取舍：
 *   - 受控组件——父组件持有完整 4 维 state，本组件只负责渲染 + onChange
 *   - 部分提交：任一维度可为 null（用户没评 == 不强迫评）。点击已选中的星会回到 null（取消评分）
 *   - 用 SVG 星而不是 lucide Star——更精细控制半填充（Phase 4 可加半星）
 *
 * a11y：star button 有 aria-label "为<维度>评<X>星"，键盘可达；
 *      整组 role=radiogroup（但 1-5 + null 本质是 6 态，所以仍用 button 阵列）。
 */

"use client";

import { Star } from "lucide-react";

export const RATING_DIMENSIONS = [
  { key: "relevance",  label: "相关性",   hint: "回答是否切题、抓住了核心问题" },
  { key: "accuracy",   label: "准确性",   hint: "事实/数据/引用是否正确无误" },
  { key: "creativity", label: "创意度",   hint: "是否提供了新颖视角或差异化" },
  { key: "overall",    label: "总体评分", hint: "综合主观满意度" },
] as const;

export type RatingDimensionKey = (typeof RATING_DIMENSIONS)[number]["key"];

export interface MultiDimRatingValue {
  relevance: number | null;
  accuracy: number | null;
  creativity: number | null;
  overall: number | null;
}

export const EMPTY_RATING: MultiDimRatingValue = {
  relevance: null,
  accuracy: null,
  creativity: null,
  overall: null,
};

interface Props {
  value: MultiDimRatingValue;
  onChange: (next: MultiDimRatingValue) => void;
  disabled?: boolean;
}

export function MultiDimRating({ value, onChange, disabled }: Props) {
  /** 设置某维度评分：再次点击当前值会清空（toggle 行为） */
  const setDim = (key: RatingDimensionKey, score: number) => {
    if (disabled) return;
    onChange({
      ...value,
      [key]: value[key] === score ? null : score,
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {RATING_DIMENSIONS.map((dim) => {
        const current = value[dim.key];
        return (
          <div key={dim.key} className="flex items-center gap-3">
            <div className="w-[64px] flex-none">
              <div className="text-[12.5px] font-medium" style={{ color: "var(--ink)" }}>
                {dim.label}
              </div>
              <div className="text-[10.5px]" style={{ color: "var(--ink-4)" }}>
                {dim.hint}
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => {
                const active = current != null && n <= current;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={disabled}
                    aria-label={`为${dim.label}评 ${n} 星`}
                    onClick={() => setDim(dim.key, n)}
                    className="p-0.5 rounded transition-transform"
                    style={{
                      transform: active ? "scale(1.05)" : "scale(1)",
                      cursor: disabled ? "default" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                    }}
                  >
                    <Star
                      size={16}
                      strokeWidth={active ? 0 : 1.6}
                      fill={active ? "var(--gen)" : "none"}
                      style={{ color: active ? "var(--gen)" : "var(--ink-4)" }}
                    />
                  </button>
                );
              })}
              <span className="ml-1.5 text-[11px] mono w-[18px]"
                    style={{ color: current != null ? "var(--ink-3)" : "var(--ink-4)" }}>
                {current ?? "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
