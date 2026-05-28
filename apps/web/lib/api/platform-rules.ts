/**
 * Platform Rules API client — feat-200.8 Week 8
 *
 * 对接后端 PlatformRulesController：
 *   POST   /projects/:pid/platform-rules
 *   GET    /projects/:pid/platform-rules
 *   GET    /projects/:pid/platform-rules/:ruleId
 *   PATCH  /projects/:pid/platform-rules/:ruleId
 *   DELETE /projects/:pid/platform-rules/:ruleId
 *
 * 类型镜像后端 platform-rules.types.ts，避免共享包循环依赖。
 */

import { apiFetch } from "./client";

export interface PlatformRuleConfig {
  maxLength?: number;
  bannedKeywords?: string[];
  mandatoryTagPattern?: string;
  mandatoryTagMin?: number;
  styleHint?: string;
}

export interface PlatformRule {
  id: string;
  projectId: string;
  name: string;
  config: PlatformRuleConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformRuleInput {
  name: string;
  config?: PlatformRuleConfig;
  enabled?: boolean;
}

export interface UpdatePlatformRuleInput {
  name?: string;
  config?: PlatformRuleConfig;
  enabled?: boolean;
}

export type ViolationType = "max_length" | "banned_keyword" | "missing_tag";

export interface RuleViolation {
  type: ViolationType;
  ruleId: string;
  ruleName: string;
  message: string;
  detail?: Record<string, unknown>;
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function listRules(
  projectId: string,
): Promise<{ rules: PlatformRule[] }> {
  return apiFetch<{ rules: PlatformRule[] }>(
    `/projects/${projectId}/platform-rules`,
  );
}

export async function getRule(
  projectId: string,
  ruleId: string,
): Promise<{ rule: PlatformRule }> {
  return apiFetch<{ rule: PlatformRule }>(
    `/projects/${projectId}/platform-rules/${ruleId}`,
  );
}

export async function createRule(
  projectId: string,
  input: CreatePlatformRuleInput,
): Promise<{ rule: PlatformRule }> {
  return apiFetch<{ rule: PlatformRule }>(
    `/projects/${projectId}/platform-rules`,
    { method: "POST", body: input },
  );
}

export async function updateRule(
  projectId: string,
  ruleId: string,
  input: UpdatePlatformRuleInput,
): Promise<{ rule: PlatformRule }> {
  return apiFetch<{ rule: PlatformRule }>(
    `/projects/${projectId}/platform-rules/${ruleId}`,
    { method: "PATCH", body: input },
  );
}

export async function deleteRule(
  projectId: string,
  ruleId: string,
): Promise<void> {
  return apiFetch<void>(
    `/projects/${projectId}/platform-rules/${ruleId}`,
    { method: "DELETE" },
  );
}

// ── 预设：4 大主流平台开箱即用 ────────────────────────────────────────────
//
// 用户在 Settings 里点"使用预设"批量克隆进自己的项目，可后续修改 / 禁用。

export interface PlatformPreset {
  key: string;
  name: string;
  config: PlatformRuleConfig;
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    key: "xiaohongshu",
    name: "小红书",
    config: {
      maxLength: 1000,
      mandatoryTagPattern: "#\\S+",
      mandatoryTagMin: 3,
      bannedKeywords: ["最", "第一", "最佳", "最便宜", "顶级"],
      styleHint: "口语化、亲切、首行抓眼球，多用 emoji；末尾带 3-8 个 #话题标签",
    },
  },
  {
    key: "weibo",
    name: "微博",
    config: {
      maxLength: 140,
      mandatoryTagPattern: "#[^#]+#",
      mandatoryTagMin: 1,
      bannedKeywords: ["国家级", "顶级", "最佳"],
      styleHint: "140 字以内核心信息 + 1 个话题标签 + 引导互动",
    },
  },
  {
    key: "douyin",
    name: "抖音/短视频脚本",
    config: {
      maxLength: 500,
      styleHint:
        "脚本格式：场景描述 + 旁白 + 字幕提示；节奏紧凑，前 3 秒必抓人",
    },
  },
  {
    key: "wechat",
    name: "公众号",
    config: {
      maxLength: 3000,
      styleHint:
        "长文结构：开篇钩子 → 主体分点（带二级标题）→ 行动号召；段落清晰、阅读友好",
    },
  },
];
