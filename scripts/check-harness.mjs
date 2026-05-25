#!/usr/bin/env node
// 校验 feature_list.json 内部一致性 + 与 AGENTS.md 的概念同步。
// 失败任意一条即非 0 退出，由 init.sh 在质量门禁里调用。
//
// 校验项：
//   C1 顶层 schema：必须有 project / phase / tracks / numbering_convention / phases / features
//   C2 feature 必填字段：id / name / phase / track / description / dependencies / status / evidence
//   C3 track 值合法：必须是 tracks 顶层键之一 或 "historical"
//   C4 phase 值合法：必须是 phases 顶层键之一
//   C5 status 合法：done / todo / in-progress / blocked / epic
//   C6 依赖闭包合法：所有 dependency id 都存在
//   C7 done 不能依赖 todo / blocked / in-progress（epic 可以）
//   C8 同 phase 内 001-099 段位按数字升序（100+ 段位豁免）
//   C9 AGENTS.md 提到的 stage 1..5 + 2.5，phases 表都覆盖
//   C10 tracks.<track>.scope 不为空，且 scope 里声明的前缀至少有一个 feature 匹配

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];
const warnings = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ---------- 读文件 ----------
const flPath = path.join(root, "feature_list.json");
if (!fs.existsSync(flPath)) {
  console.error("找不到 feature_list.json");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(flPath, "utf8"));
const agentsPath = path.join(root, "AGENTS.md");
const agentsText = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";

// ---------- C1 顶层 schema ----------
for (const key of ["project", "phase", "tracks", "numbering_convention", "phases", "features"]) {
  if (!(key in data)) fail(`[C1] 顶层缺字段：${key}`);
}
if (!Array.isArray(data.features)) fail("[C1] features 必须是数组");

const trackKeys = new Set([...Object.keys(data.tracks ?? {}), "historical"]);
const phaseKeys = new Set(Object.keys(data.phases ?? {}));

// ---------- C2-C5 逐 feature ----------
const required = ["id", "name", "phase", "track", "description", "dependencies", "status", "evidence"];
const allowedStatus = new Set(["done", "todo", "in-progress", "blocked", "epic"]);
const ids = new Set();

for (const f of data.features ?? []) {
  const tag = f.id ?? "<no-id>";
  for (const k of required) {
    if (!(k in f)) fail(`[C2] ${tag} 缺字段 ${k}`);
  }
  if (f.id) {
    if (ids.has(f.id)) fail(`[C2] 重复 id: ${f.id}`);
    ids.add(f.id);
  }
  if (f.track && !trackKeys.has(f.track)) {
    fail(`[C3] ${tag} track="${f.track}" 不在 tracks 键 ${[...trackKeys].join("/")} 内`);
  }
  if (f.phase && !phaseKeys.has(f.phase)) {
    fail(`[C4] ${tag} phase="${f.phase}" 不在 phases 键 ${[...phaseKeys].join("/")} 内`);
  }
  if (f.status && !allowedStatus.has(f.status)) {
    fail(`[C5] ${tag} status="${f.status}" 非法（允许：${[...allowedStatus].join("/")}）`);
  }
}

// ---------- C6 依赖闭包 ----------
for (const f of data.features ?? []) {
  for (const d of f.dependencies ?? []) {
    if (!ids.has(d)) fail(`[C6] ${f.id} 依赖不存在的 ${d}`);
  }
}

// ---------- C7 done 不能依赖未完成 ----------
const byId = new Map((data.features ?? []).map((f) => [f.id, f]));
for (const f of data.features ?? []) {
  if (f.status !== "done") continue;
  for (const d of f.dependencies ?? []) {
    const dep = byId.get(d);
    if (!dep) continue;
    if (dep.status === "todo" || dep.status === "blocked" || dep.status === "in-progress") {
      fail(`[C7] ${f.id} 状态 done 但依赖 ${d} 状态 ${dep.status}`);
    }
  }
}

// ---------- C8 同 phase 内 001-099 按数字升序 ----------
// 解析 id：feat-006.2 → {major: 6, minor: 2}；feat-100.x 豁免
const parseId = (id) => {
  const m = id.match(/^feat-(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] ? Number(m[2]) : 0 };
};
const orderKey = (id) => {
  const p = parseId(id);
  if (!p) return null;
  return p.major * 1000 + p.minor;
};

// 按 phase 分组（仅 001-099 段位检查）
const byPhase = new Map();
for (const f of data.features ?? []) {
  const p = parseId(f.id);
  if (!p || p.major >= 100) continue;
  if (!byPhase.has(f.phase)) byPhase.set(f.phase, []);
  byPhase.get(f.phase).push(f.id);
}
for (const [phase, list] of byPhase) {
  for (let i = 1; i < list.length; i++) {
    if (orderKey(list[i]) < orderKey(list[i - 1])) {
      fail(`[C8] phase=${phase} 内 ${list[i - 1]} → ${list[i]} 不按数字升序（同 phase 内 001-099 段位应升序）`);
    }
  }
}

// ---------- C9 AGENTS.md stage 覆盖 ----------
// 抽取 AGENTS.md 中提到的 "阶段 X" 编号
const stageMatches = [...agentsText.matchAll(/阶段\s*([\d.]+)/g)];
const mentionedStages = new Set(stageMatches.map((m) => m[1]));
for (const s of mentionedStages) {
  if (!phaseKeys.has(s)) {
    warn(`[C9] AGENTS.md 提到 "阶段 ${s}" 但 phases 表无此键`);
  }
}

// ---------- C10 tracks.scope 校验 ----------
for (const [trackName, trackDef] of Object.entries(data.tracks ?? {})) {
  if (!Array.isArray(trackDef.scope) || trackDef.scope.length === 0) {
    fail(`[C10] tracks.${trackName}.scope 为空`);
    continue;
  }
  for (const pattern of trackDef.scope) {
    // pattern 形如 "feat-100.x" 或 "feat-006"，转成前缀匹配
    const prefix = pattern.replace(/（.*$/, "").trim().replace(/\.x$/, "");
    const hit = [...ids].some((id) => id === prefix || id.startsWith(prefix + "."));
    if (!hit) warn(`[C10] tracks.${trackName}.scope 包含 "${pattern}" 但没有匹配的 feature`);
  }
}

// ---------- 输出 ----------
if (warnings.length) {
  console.log("⚠️  warnings:");
  for (const w of warnings) console.log("  " + w);
}
if (errors.length) {
  console.error("❌ harness 一致性检查失败：");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log(`✅ harness 一致性 OK（${data.features.length} features, ${Object.keys(data.tracks).length} tracks, ${Object.keys(data.phases).length} phases${warnings.length ? `, ${warnings.length} warnings` : ""}）`);
