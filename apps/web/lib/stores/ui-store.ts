/**
 * UI Store — feat-300.6
 *
 * 跨页面 UI 偏好。第一个字段：Agent 模式 toggle。
 *
 * 为什么 zustand persist + localStorage（plan §决策表）：
 *   - 用户级偏好不属于项目维度（同一用户在所有项目通用）
 *   - 跨刷新保留（localStorage）
 *   - 不写到 project_settings → 不污染项目数据
 *
 * 默认 agentModeEnabled = true（plan §决策表，用户场景 B）：
 *   项目核心卖点就是 Agent，默认走新路径；老 /generate 留作 fallback。
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UiState {
  /** Chat 页 Generate 按钮是否走 Agent 模式 */
  agentModeEnabled: boolean;
  setAgentModeEnabled: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      agentModeEnabled: true, // 默认开
      setAgentModeEnabled: (v) => set({ agentModeEnabled: v }),
    }),
    {
      name: "harness-ui-prefs",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
