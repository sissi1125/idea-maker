/**
 * AgentCostBar — feat-300.6 任务 5
 *
 * 横向进度条 + 当前 cost vs budget。
 *
 * 颜色阶梯（视觉警告）：
 *   - < 60%  绿
 *   - 60-90% 黄
 *   - >= 90% 红
 *   - > 100%（超 budget 触发 fallback）：红 + 横条满 + 标记 "已超预算"
 *
 * 为什么不用 progress 元素：
 *   原生 <progress> 跨浏览器样式难统一；自建 div 30 行能搞定。
 */

"use client";

import { DollarSign } from "lucide-react";

interface AgentCostBarProps {
  costUsedUsd: number;
  budgetUsd: number;
  percentBudget: number;
}

export function AgentCostBar({ costUsedUsd, budgetUsd, percentBudget }: AgentCostBarProps) {
  const clamped = Math.min(Math.max(percentBudget, 0), 100);
  const over = percentBudget > 100;
  const color =
    percentBudget >= 90 ? "bg-red-500" : percentBudget >= 60 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <DollarSign size={12} className="text-gray-400" />
      <span className="font-mono tabular-nums">
        ${costUsedUsd.toFixed(4)} / ${budgetUsd.toFixed(2)}
      </span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded overflow-hidden min-w-[80px] max-w-[200px]">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${over ? 100 : clamped}%` }}
        />
      </div>
      <span className={`font-mono tabular-nums ${over ? "text-red-600 font-medium" : ""}`}>
        {percentBudget.toFixed(0)}%
      </span>
      {over && <span className="text-red-600 font-medium">已超预算</span>}
    </div>
  );
}
