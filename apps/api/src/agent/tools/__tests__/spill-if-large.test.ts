/**
 * spillIfLarge helper 单测：阈值分支 + __trace 隐藏字段 + LLM safe 形态。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { spillIfLarge, TRACE_FIELD } from "../util/spill-if-large";
import { SpillStorage, SPILL_THRESHOLD_BYTES } from "../../spill-storage.service";

describe("spillIfLarge", () => {
  let tmpRoot: string;
  let storage: SpillStorage;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spill-helper-"));
    process.env.SPILL_ROOT = tmpRoot;
    storage = new SpillStorage();
  });
  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("小 payload < 阈值：原样返回", async () => {
    const payload = { foo: "bar" };
    const out = await spillIfLarge(payload, {
      kind: "k",
      preview: () => "p",
      summary: () => ({}),
      storage,
    });
    expect(out).toBe(payload); // 引用相等：完全原样
  });

  it("大 payload >= 阈值：返回 SpillRefLlmSafe + __trace 隐藏字段", async () => {
    const big = { data: "x".repeat(SPILL_THRESHOLD_BYTES + 100) };
    const out = await spillIfLarge(big, {
      kind: "search-web",
      preview: () => "preview",
      summary: () => ({ size: 9000 }),
      storage,
    });
    // LLM 可见层
    expect((out as { spilled?: boolean }).spilled).toBe(true);
    expect((out as { preview?: string }).preview).toBe("preview");
    expect((out as { summary?: object }).summary).toEqual({ size: 9000 });
    expect((out as { kind?: string }).kind).toBe("search-web");
    // 注意：LLM safe 形态不应有 path/size/hash 三字段
    expect((out as Record<string, unknown>).path).toBeUndefined();
    expect((out as Record<string, unknown>).size).toBeUndefined();
    expect((out as Record<string, unknown>).hash).toBeUndefined();
    // __trace 隐藏字段含完整 metadata
    const trace = (out as Record<string, unknown>)[TRACE_FIELD] as
      | { path: string; size: number; hash: string }
      | undefined;
    expect(trace).toBeDefined();
    expect(trace!.path).toMatch(/^\d{4}-\d{2}-\d{2}\/.+\.json$/);
    expect(trace!.size).toBeGreaterThan(SPILL_THRESHOLD_BYTES);
    expect(trace!.hash).toHaveLength(64);
  });

  it("preview 过长会被截到 SPILL_PREVIEW_CHARS", async () => {
    const big = { data: "x".repeat(SPILL_THRESHOLD_BYTES + 100) };
    const longPreview = "y".repeat(1000);
    const out = await spillIfLarge(big, {
      kind: "k",
      preview: () => longPreview,
      summary: () => ({}),
      storage,
    });
    expect(((out as { preview: string }).preview).length).toBeLessThanOrEqual(501); // 500 + "…"
    expect((out as { preview: string }).preview).toMatch(/…$/);
  });

  it("落盘文件可被 storage.read 反读回原 payload", async () => {
    const big = { data: "x".repeat(SPILL_THRESHOLD_BYTES + 100), meta: { a: 1 } };
    const out = await spillIfLarge(big, {
      kind: "k",
      preview: () => "p",
      summary: () => ({}),
      storage,
    });
    const trace = (out as Record<string, unknown>)[TRACE_FIELD] as { path: string };
    const back = await storage.read(trace.path);
    expect(back).toEqual(big);
  });
});
