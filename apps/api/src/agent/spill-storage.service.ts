/**
 * SpillStorage — feat-300.3 任务 0.6
 *
 * 把超阈值的 tool payload 落到磁盘，对外返回轻量索引 SpillRef。设计目标见
 * docs/agent/feat-300.3-plan.md §3.3。
 *
 * **双轨语义**：
 *   - LLM 视角（ai-sdk messages）：SpillRef 不带 path，只看 preview + summary
 *     避免 LLM "看到有路径却用不了"的认知负担（除非未来加 read_spill tool）。
 *   - agent_steps.output JSONB：SpillRef 带完整 path/size/hash，供
 *     trace 回放 / admin UI / eval 通过 GET /spill 端点拉全文。
 *   spillIfLarge helper（同目录 tools/util/spill-if-large.ts）负责拆出两套 ref，
 *   本 service 只生产带 path 的"完整 ref"。
 *
 * **不依赖 NestJS DI 的部分**（path 计算、hash、目录创建）抽成纯函数便于单测；
 * Injectable 类只持有 spillRoot 作为运行时状态。
 *
 * **路径白名单 read**：read(path) 要校验 path 必须落在 spillRoot 下，防 path
 * traversal（如调用方传 "../../etc/passwd"）。Node fs 不会自动做这件事。
 */

import { Injectable, Logger } from "@nestjs/common";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";

/**
 * 完整 SpillRef（含 path）：用于写 agent_steps.output。
 * `spilled: true` 是 discriminator，前端 / 调用方判断"这是个引用不是原值"。
 */
export interface SpillRefFull {
  spilled: true;
  /** 相对 spillRoot 的路径，如 "2026-05-30/abc-uuid.json" */
  path: string;
  /** 字节数 */
  size: number;
  /** 内容 sha256，未来去重 + 校验用 */
  hash: string;
  /** LLM 可见的 ASCII 预览（默认 500 字） */
  preview: string;
  /** 结构化摘要，让 LLM 不读全文也知道里面有什么 */
  summary: Record<string, unknown>;
  /** payload 类型标识，如 'search-web' / 'search-kb' */
  kind: string;
}

/**
 * LLM 可见的 ref：从 SpillRefFull 抽出 path/size/hash 后剩下的部分。
 * spillIfLarge helper 在塞回 tool 返回值前会过滤成这一形态。
 */
export type SpillRefLlmSafe = Omit<SpillRefFull, "path" | "size" | "hash">;

/** SpillStorage 阈值：8KB（与 feat-300.3 任务 0.6 决策一致） */
export const SPILL_THRESHOLD_BYTES = 8 * 1024;

/** SpillStorage 预览长度：500 字符 */
export const SPILL_PREVIEW_CHARS = 500;

/** 单文件硬上限 1MB——防止 tool 失控写满磁盘 */
const SPILL_MAX_BYTES = 1024 * 1024;

@Injectable()
export class SpillStorage {
  private readonly logger = new Logger(SpillStorage.name);
  /** 落盘根目录。默认 apps/api/data/agent-spills，可 SPILL_ROOT env 覆盖（持久卷场景） */
  private readonly spillRoot: string;

  constructor() {
    const fromEnv = process.env.SPILL_ROOT;
    if (fromEnv) {
      this.spillRoot = path.isAbsolute(fromEnv)
        ? fromEnv
        : path.resolve(process.cwd(), fromEnv);
    } else {
      this.spillRoot = path.resolve(process.cwd(), "data/agent-spills");
    }
  }

  /**
   * 落盘 payload，返回 SpillRefFull。
   *
   * preview / summary 由调用方按 payload 形态生成（在 spillIfLarge helper 里完成）。
   * 本方法不假设 payload 形态，只做"序列化 + 写盘 + 计算 metadata"。
   *
   * 文件不存在时自动创建子目录（按日期）。
   *
   * @throws Error 当序列化后超过 SPILL_MAX_BYTES 时（防失控）
   */
  async spill(payload: unknown, opts: {
    kind: string;
    preview: string;
    summary: Record<string, unknown>;
  }): Promise<SpillRefFull> {
    const serialized = JSON.stringify(payload);
    const size = Buffer.byteLength(serialized, "utf-8");

    if (size > SPILL_MAX_BYTES) {
      throw new Error(
        `SpillStorage: payload too large (${size} bytes > ${SPILL_MAX_BYTES} max) for kind=${opts.kind}`,
      );
    }

    const hash = createHash("sha256").update(serialized).digest("hex");
    const dateDir = formatDateDir(new Date());
    const fileName = `${randomUUID()}.json`;
    const relPath = path.posix.join(dateDir, fileName);
    const absPath = path.join(this.spillRoot, dateDir, fileName);

    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, serialized, "utf-8");

    return {
      spilled: true,
      path: relPath,
      size,
      hash,
      preview: opts.preview,
      summary: opts.summary,
      kind: opts.kind,
    };
  }

  /**
   * 读取已落盘的 payload。
   *
   * 路径白名单：必须落在 spillRoot 下；任何 "../" / 绝对路径外的尝试抛错。
   * 这一条是防止 controller 调用方接收 user-provided path 时被绕过。
   */
  async read(relPath: string): Promise<unknown> {
    const absPath = this.resolveSafe(relPath);
    const content = await fsp.readFile(absPath, "utf-8");
    return JSON.parse(content);
  }

  /**
   * 清理 N 天前的 spill 文件。返回删除的数量。
   *
   * 简单实现：按日期子目录扫，每个目录的名字本身就是日期。
   * cron 由 feat-300.7 接，本期只提供方法。
   */
  async cleanup(olderThanDays: number): Promise<number> {
    if (!fs.existsSync(this.spillRoot)) return 0;
    const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    const dirs = await fsp.readdir(this.spillRoot);
    for (const dir of dirs) {
      const dirDate = parseDateDir(dir);
      if (!dirDate) continue; // 非日期格式目录跳过（如 .gitkeep）
      if (dirDate.getTime() >= threshold) continue;
      const dirPath = path.join(this.spillRoot, dir);
      const files = await fsp.readdir(dirPath);
      for (const f of files) {
        await fsp.unlink(path.join(dirPath, f));
        deleted++;
      }
      // 目录本身也删（rmdir 只删空目录，文件已清完应该空）
      await fsp.rmdir(dirPath).catch(() => undefined);
    }
    this.logger.log(`SpillStorage cleanup: removed ${deleted} files older than ${olderThanDays} days`);
    return deleted;
  }

  /** 测试用：root 路径暴露便于校验 */
  get root(): string {
    return this.spillRoot;
  }

  // ─── 内部 ────────────────────────────────────────────────

  /**
   * 把 relPath 解析为 abs path，并校验落在 spillRoot 下。
   * 防 "../"、防绝对路径、防符号链接逃逸（虽然 Node fs 不直接处理 symlink，但
   * 至少把 directory traversal 卡掉）。
   */
  private resolveSafe(relPath: string): string {
    // 拒绝绝对路径
    if (path.isAbsolute(relPath)) {
      throw new Error(`SpillStorage.read: absolute path not allowed: ${relPath}`);
    }
    const absPath = path.resolve(this.spillRoot, relPath);
    // 标准化后必须以 spillRoot 开头
    const normalizedRoot = path.resolve(this.spillRoot) + path.sep;
    if (!absPath.startsWith(normalizedRoot)) {
      throw new Error(`SpillStorage.read: path escapes spill root: ${relPath}`);
    }
    return absPath;
  }
}

/**
 * 把 Date 格式化为 YYYY-MM-DD 字符串（UTC，避免跨时区文件挪位）。
 */
export function formatDateDir(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 解析 YYYY-MM-DD 子目录名为 Date；非该格式返回 null */
export function parseDateDir(name: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * 把 SpillRefFull 转成 LLM 安全形态：去掉 path/size/hash。
 * 用于 spillIfLarge helper 在塞回 tool 返回值前过滤。
 */
export function toLlmSafe(ref: SpillRefFull): SpillRefLlmSafe {
  const { path: _p, size: _s, hash: _h, ...rest } = ref;
  return rest;
}
