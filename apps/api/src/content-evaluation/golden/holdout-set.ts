/**
 * 内容评测离线回归 · 保留集（冻结）— feat-400.2
 *
 * ⚠️ 这套用例不参与日常调规则，只做回归验证。改了硬规则/决策后，保留集若挂了，
 * 说明改动影响了"没在开发时盯着的分布" —— 这正是保留集要抓的过拟合。
 * 非必要不要改这个文件。
 */

import type { GoldenCase } from "./types";
import type { GateClaim } from "../deterministic-gate";
import type { ContentScores } from "../decision";

const price: GateClaim = {
  id: "hp", text: "价格：基础版每月 29 元", status: "approved", claimType: "functional", evidenceChunkIds: ["h1"],
};
const feature: GateClaim = {
  id: "hf", text: "功能：支持 Windows 与 macOS", status: "approved", claimType: "functional", evidenceChunkIds: ["h2"],
};
const noEvidenceFunc: GateClaim = {
  id: "hn", text: "功能：号称最快", status: "approved", claimType: "functional", evidenceChunkIds: [],
};
const diff: GateClaim = {
  id: "hd", text: "差异化：越用越懂你", status: "approved", claimType: "differentiation", evidenceChunkIds: [],
};

const lowScores: ContentScores = {
  factualFaithfulness: 4, audienceFit: 2, platformFit: 4, clarity: 4, differentiation: 3, styleFit: 3, issues: [],
};

export const HOLDOUT_SET: GoldenCase[] = [
  {
    id: "hold-01-duplicate-claim",
    description: "重复引用同一卖点 → 拦下",
    claims: [feature],
    variant: { body: "支持 Windows 与 macOS。", claimIds: ["hf", "hf"] },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["duplicate_claim"] },
  },
  {
    id: "hold-02-too-long",
    description: "超平台字数 → 拦下",
    claims: [feature],
    variant: { body: "支持双端。".repeat(60), claimIds: ["hf"] },
    platform: { maxLength: 50 },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["too_long"] },
  },
  {
    id: "hold-03-approved-func-no-evidence",
    description: "引用的事实型卖点竟无证据（数据不一致）→ 拦下",
    claims: [noEvidenceFunc],
    variant: { body: "号称最快，快人一步。", claimIds: ["hn"] },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["missing_evidence"] },
  },
  {
    id: "hold-04-diff-clean",
    description: "差异化卖点（无需证据）+ 干净 → 通过转人工",
    claims: [diff],
    variant: { body: "越用越懂你，省心。", claimIds: ["hd"] },
    expect: { gatePassed: true, decision: "human_review" },
  },
  {
    id: "hold-05-low-audience-fit",
    description: "硬规则过但受众契合低分 → 转人工",
    claims: [price],
    variant: { body: "基础版每月 29 元。", claimIds: ["hp"] },
    scores: lowScores,
    expect: { gatePassed: true, decision: "human_review" },
  },
  {
    id: "hold-06-multi-failure",
    description: "多种问题叠加（不存在卖点 + 编造价格）→ 拦下",
    claims: [price],
    variant: { body: "每月仅 9 元！", claimIds: ["ghost"] },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["unknown_claim", "unsupported_number"] },
  },
];
