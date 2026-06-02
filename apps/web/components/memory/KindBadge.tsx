/**
 * KindBadge — feat-300.6 任务 3
 *
 * agent_memory.kind 视觉徽章。与后端 memory-injection.prompt 渲染顺序一致：
 *   taboo（红，最重要）→ audience（紫）→ style（蓝）→ preference（绿，兜底）
 *
 * 用 title 属性而不是浮窗 tooltip：原生鼠标 hover 即可看 ≈ 5 字解释，
 * 零运行时开销，无需 popper 库。
 */

import { ShieldAlert, Users, Sparkles, Heart } from "lucide-react";
import type { MemoryKind } from "@/lib/api/memory";

const KIND_META: Record<
  MemoryKind,
  { label: string; icon: typeof ShieldAlert; color: string; hint: string }
> = {
  taboo: {
    label: "禁忌",
    icon: ShieldAlert,
    color: "text-red-700 bg-red-50 border-red-200",
    hint: "用户绝对不要做的事（注入 system prompt 时优先级最高）",
  },
  audience: {
    label: "受众",
    icon: Users,
    color: "text-purple-700 bg-purple-50 border-purple-200",
    hint: "目标受众画像，决定语气大方向",
  },
  style: {
    label: "风格",
    icon: Sparkles,
    color: "text-blue-700 bg-blue-50 border-blue-200",
    hint: "语气 / 句式 / 格式偏好",
  },
  preference: {
    label: "偏好",
    icon: Heart,
    color: "text-emerald-700 bg-emerald-50 border-emerald-200",
    hint: "通用偏好兜底",
  },
};

interface KindBadgeProps {
  kind: MemoryKind;
  /** 紧凑模式：只显示图标，hover 看 label */
  compact?: boolean;
}

export function KindBadge({ kind, compact }: KindBadgeProps) {
  const m = KIND_META[kind];
  const Icon = m.icon;
  return (
    <span
      title={`${m.label}：${m.hint}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${m.color}`}
    >
      <Icon size={11} />
      {!compact && m.label}
    </span>
  );
}

export const KIND_ORDER: MemoryKind[] = ["taboo", "audience", "style", "preference"];
