/**
 * SpillStorage 单测：用临时目录 + 阈值 / 路径白名单 / 清理 / hash。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  SpillStorage,
  SPILL_THRESHOLD_BYTES,
  SPILL_PREVIEW_CHARS,
  formatDateDir,
  parseDateDir,
  toLlmSafe,
  type SpillRefFull,
} from "../spill-storage.service";

describe("formatDateDir / parseDateDir", () => {
  it("YYYY-MM-DD（UTC）", () => {
    expect(formatDateDir(new Date(Date.UTC(2026, 4, 30)))).toBe("2026-05-30");
  });
  it("parseDateDir 反向解析", () => {
    const d = parseDateDir("2026-05-30");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(4);
  });
  it("parseDateDir 非该格式返回 null", () => {
    expect(parseDateDir(".gitkeep")).toBeNull();
    expect(parseDateDir("not-a-date")).toBeNull();
  });
});

describe("toLlmSafe", () => {
  it("移除 path/size/hash 三字段", () => {
    const full: SpillRefFull = {
      spilled: true,
      path: "x/y.json",
      size: 100,
      hash: "abc",
      preview: "p",
      summary: { n: 1 },
      kind: "k",
    };
    const safe = toLlmSafe(full);
    expect(safe).toEqual({ spilled: true, preview: "p", summary: { n: 1 }, kind: "k" });
    expect((safe as Record<string, unknown>).path).toBeUndefined();
  });
});

describe("SpillStorage", () => {
  let tmpRoot: string;
  let storage: SpillStorage;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spill-test-"));
    process.env.SPILL_ROOT = tmpRoot;
    storage = new SpillStorage();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("spill() 写文件 + 返回 path/size/hash/preview/summary", async () => {
    const payload = { foo: "bar", items: [1, 2, 3] };
    const ref = await storage.spill(payload, {
      kind: "test",
      preview: "preview text",
      summary: { count: 3 },
    });
    expect(ref.spilled).toBe(true);
    expect(ref.kind).toBe("test");
    expect(ref.preview).toBe("preview text");
    expect(ref.summary).toEqual({ count: 3 });
    expect(ref.path).toMatch(/^\d{4}-\d{2}-\d{2}\//);
    expect(ref.size).toBeGreaterThan(0);
    expect(ref.hash).toHaveLength(64); // sha256 hex

    // 文件真存在
    const abs = path.join(tmpRoot, ref.path);
    expect(fs.existsSync(abs)).toBe(true);
    const content = fs.readFileSync(abs, "utf-8");
    expect(JSON.parse(content)).toEqual(payload);
  });

  it("read() 把落盘内容读回来", async () => {
    const payload = { x: 1 };
    const ref = await storage.spill(payload, {
      kind: "k",
      preview: "p",
      summary: {},
    });
    const back = await storage.read(ref.path);
    expect(back).toEqual(payload);
  });

  it("read() 拒绝绝对路径", async () => {
    await expect(storage.read("/etc/passwd")).rejects.toThrow(/absolute path not allowed/);
  });

  it("read() 拒绝 ../ 路径逃逸", async () => {
    await expect(storage.read("../../../etc/passwd")).rejects.toThrow(/escapes spill root/);
  });

  it("超过 1MB 硬上限抛错", async () => {
    const huge = "x".repeat(2 * 1024 * 1024);
    await expect(
      storage.spill({ huge }, { kind: "k", preview: "p", summary: {} }),
    ).rejects.toThrow(/too large/);
  });

  it("cleanup() 只删旧日期目录", async () => {
    // 准备一个 5 天前的目录 + 一个今天的目录
    const oldDir = path.join(tmpRoot, "2020-01-01");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "old.json"), "{}");

    await storage.spill({ x: 1 }, { kind: "k", preview: "p", summary: {} });

    const deleted = await storage.cleanup(30);
    expect(deleted).toBe(1); // 只删了 old.json
    expect(fs.existsSync(oldDir)).toBe(false);
  });

  it("cleanup() 忽略非日期目录（如 .git）", async () => {
    fs.mkdirSync(path.join(tmpRoot, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, ".git", "config"), "");
    const deleted = await storage.cleanup(0);
    expect(deleted).toBe(0);
    expect(fs.existsSync(path.join(tmpRoot, ".git"))).toBe(true);
  });
});

describe("常量数值检查", () => {
  it("阈值 8KB（feat-300.3 任务 0.6 决策）", () => {
    expect(SPILL_THRESHOLD_BYTES).toBe(8 * 1024);
  });
  it("预览 500 字符", () => {
    expect(SPILL_PREVIEW_CHARS).toBe(500);
  });
});
