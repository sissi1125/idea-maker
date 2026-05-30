/**
 * 测试工具：fake SpillStorage 不真实落盘，对小 payload 不触发 spill。
 * 用于其他 search tool 单测注入。
 */

import { SpillStorage } from "../../spill-storage.service";

/**
 * 返回一个不真实写文件的 SpillStorage instance。
 * spill 方法仅返回结构化 ref（虚拟 path）；不真实写 fs，避免污染。
 */
export function makeFakeSpillStorage(): SpillStorage {
  const fake = {
    spill: async (
      _payload: unknown,
      opts: { kind: string; preview: string; summary: Record<string, unknown> },
    ) => ({
      spilled: true as const,
      path: "fake/path.json",
      size: 9999,
      hash: "fakehash",
      preview: opts.preview,
      summary: opts.summary,
      kind: opts.kind,
    }),
    read: async () => ({}),
    cleanup: async () => 0,
    root: "/fake",
  };
  return fake as unknown as SpillStorage;
}
