/**
 * 确定性规则门禁 —— feat-400.2 的核心（面试主线）
 *
 * 全是代码死规则、不调用任何模型：内容里的硬事实必须站得住，否则一票否决 blocked。
 * 评测 Agent 的高分不能覆盖这里。为什么："防幻觉不能交给一个自己也会幻觉的模型把关，
 * 硬事实必须用工程规则兜底。"
 *
 * 查（对应 plan §5.3）：
 *   1. 内容引用的每条 Claim 是否 approved（未批准/不存在/被 block → fail）
 *   2. 引用的事实型 Claim 是否仍有 evidence
 *   3. 内容里的价格/规格硬事实是否在引用的 Claim 里有据（防"编造数字"）
 *   4. 是否违反平台字数 / 敏感词
 *   5. 是否重复堆叠同一 Claim
 *
 * 纯函数，输入全部显式传入，便于穷举单测。
 */

import { EVIDENCE_REQUIRED_CLAIM_TYPES, type ClaimType } from "../claims/claims.types";

export interface GateClaim {
  id: string;
  text: string;
  status: "candidate" | "approved" | "blocked";
  claimType: ClaimType;
  evidenceChunkIds: string[];
}

export interface GateVariant {
  body: string;
  hook?: string | null;
  cta?: string | null;
  claimIds: string[];
}

export interface GatePlatform {
  maxLength?: number;
  bannedWords?: string[];
}

export interface GateContext {
  /** 项目全部 Claim（含未批准），用来判断引用是否合法 */
  claimsById: Map<string, GateClaim>;
  platform?: GatePlatform;
}

export interface GateFailure {
  rule:
    | "unknown_claim"
    | "unapproved_claim"
    | "missing_evidence"
    | "unsupported_number"
    | "banned_word"
    | "too_long"
    | "duplicate_claim";
  detail: string;
}

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
}

/**
 * 抽取"硬事实 token"：价格/百分比/容量/频率等带单位的数字，或 ¥/$ 前缀金额。
 * 只挑带单位/货币的，避免把"3 个角度"这类普通计数误判成硬事实。
 */
export function extractHardFacts(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/,/g, "");
  // 货币前缀：¥99 / $5 / ￥1,299
  for (const m of text.matchAll(/[¥$￥]\s?\d[\d,]*(\.\d+)?/g)) out.add(norm(m[0]));
  // 数字 + 单位
  for (const m of text.matchAll(/\d[\d,]*(\.\d+)?\s?(元|块|美元|人民币|%|％|gb|mb|tb|ghz|mhz|mah|寸|英寸|万|亿)/gi)) {
    out.add(norm(m[0]));
  }
  return out;
}

export function runDeterministicGate(variant: GateVariant, ctx: GateContext): GateResult {
  const failures: GateFailure[] = [];
  const text = [variant.hook, variant.body, variant.cta].filter(Boolean).join("\n");

  // 1. 重复引用同一 Claim
  const seen = new Set<string>();
  for (const id of variant.claimIds) {
    if (seen.has(id)) failures.push({ rule: "duplicate_claim", detail: `重复引用 Claim ${id}` });
    seen.add(id);
  }

  // 2. 引用合法性 + evidence
  const referenced: GateClaim[] = [];
  for (const id of seen) {
    const claim = ctx.claimsById.get(id);
    if (!claim) {
      failures.push({ rule: "unknown_claim", detail: `引用了不存在的 Claim ${id}` });
      continue;
    }
    if (claim.status !== "approved") {
      failures.push({ rule: "unapproved_claim", detail: `引用了未批准的 Claim「${claim.text}」（${claim.status}）` });
      continue;
    }
    referenced.push(claim);
    if (
      EVIDENCE_REQUIRED_CLAIM_TYPES.includes(claim.claimType) &&
      claim.evidenceChunkIds.length === 0
    ) {
      failures.push({ rule: "missing_evidence", detail: `Claim「${claim.text}」缺 evidence` });
    }
  }

  // 3. 硬事实一致性：内容里的价格/规格数字，必须在引用的 approved Claim 里有据
  const supported = new Set<string>();
  for (const c of referenced) for (const t of extractHardFacts(c.text)) supported.add(t);
  for (const fact of extractHardFacts(text)) {
    if (!supported.has(fact)) {
      failures.push({ rule: "unsupported_number", detail: `内容出现无 Claim 支撑的硬事实「${fact}」` });
    }
  }

  // 4. 平台约束
  const platform = ctx.platform;
  if (platform?.maxLength && text.length > platform.maxLength) {
    failures.push({ rule: "too_long", detail: `内容 ${text.length} 字超过平台上限 ${platform.maxLength}` });
  }
  if (platform?.bannedWords?.length) {
    const lower = text.toLowerCase();
    for (const w of platform.bannedWords) {
      if (w && lower.includes(w.toLowerCase())) {
        failures.push({ rule: "banned_word", detail: `命中敏感词「${w}」` });
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
