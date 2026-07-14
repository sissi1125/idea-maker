/**
 * 内容评测离线回归 · 开发集 — feat-400.2
 *
 * 日常调硬规则/决策时对照的用例。覆盖：通过、各种拦截原因、评分驱动的四态决策。
 */

import type { GoldenCase } from "./types";
import type { GateClaim } from "../deterministic-gate";
import type { ContentScores } from "../decision";

const approvedPrice: GateClaim = {
  id: "cp", text: "价格：专业版每月 99 元", status: "approved", claimType: "functional", evidenceChunkIds: ["e1"],
};
const approvedFeature: GateClaim = {
  id: "cf", text: "功能：一键导出 PDF", status: "approved", claimType: "functional", evidenceChunkIds: ["e2"],
};
const candidateFeature: GateClaim = {
  id: "cc", text: "功能：AI 智能润色", status: "candidate", claimType: "functional", evidenceChunkIds: ["e3"],
};
const approvedDiff: GateClaim = {
  id: "cd", text: "差异化：透明可观测", status: "approved", claimType: "differentiation", evidenceChunkIds: [],
};

const goodScores: ContentScores = {
  factualFaithfulness: 5, audienceFit: 4, platformFit: 4, clarity: 4, differentiation: 4, styleFit: 4, issues: [],
};
const blockerScores: ContentScores = {
  ...goodScores, factualFaithfulness: 2, issues: [{ severity: "blocker", category: "fact", recommendation: "与事实不符，改" }],
};

export const DEV_SET: GoldenCase[] = [
  {
    id: "dev-01-clean-no-eval",
    description: "引用已批准卖点、无冲突、无评测 → 通过但转人工",
    claims: [approvedFeature],
    variant: { body: "一键导出 PDF，效率翻倍。", claimIds: ["cf"] },
    expect: { gatePassed: true, decision: "human_review" },
  },
  {
    id: "dev-02-clean-good-eval",
    description: "同上但有高评分 → 可发布",
    claims: [approvedFeature],
    variant: { body: "一键导出 PDF，效率翻倍。", claimIds: ["cf"] },
    scores: goodScores,
    expect: { gatePassed: true, decision: "publish_candidate" },
  },
  {
    id: "dev-03-unapproved-claim",
    description: "引用未批准卖点 → 拦下",
    claims: [candidateFeature],
    variant: { body: "AI 智能润色，好用。", claimIds: ["cc"] },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["unapproved_claim"] },
  },
  {
    id: "dev-04-unknown-claim",
    description: "引用不存在的卖点 → 拦下",
    claims: [approvedFeature],
    variant: { body: "很棒的产品。", claimIds: ["ghost"] },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["unknown_claim"] },
  },
  {
    id: "dev-05-fabricated-price",
    description: "编造价格（199，卖点是 99）→ 拦下",
    claims: [approvedPrice],
    variant: { body: "限时特价每月 199 元！", claimIds: ["cp"] },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["unsupported_number"] },
  },
  {
    id: "dev-06-price-supported",
    description: "价格与卖点一致 → 通过转人工",
    claims: [approvedPrice],
    variant: { body: "专业版每月 99 元，超值。", claimIds: ["cp"] },
    expect: { gatePassed: true, decision: "human_review" },
  },
  {
    id: "dev-07-banned-word",
    description: "命中敏感词 → 拦下",
    claims: [approvedFeature],
    variant: { body: "全网最低价，一键导出 PDF", claimIds: ["cf"] },
    platform: { bannedWords: ["最低价"] },
    expect: { gatePassed: false, decision: "blocked", failureRules: ["banned_word"] },
  },
  {
    id: "dev-08-blocker-issue",
    description: "硬规则过但评测发现 blocker → 要改",
    claims: [approvedDiff],
    variant: { body: "透明可观测，值得信赖。", claimIds: ["cd"] },
    scores: blockerScores,
    expect: { gatePassed: true, decision: "revise" },
  },
];
