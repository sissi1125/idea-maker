/**
 * 集中 re-export 所有 prompt definition。
 *
 * 用途：
 *   1. 调用方 `import { criticReviewSystemPrompt } from "../prompts"` 一行搞定
 *   2. 未来 admin UI 可以 `import * as prompts from "../prompts"` 遍历枚举所有 prompt
 *   3. 添加新 prompt 时只改这一处导出，调用方少写一行路径
 */

// 基础设施
export * from "./types";

// 系统组合
export * from "./system/agent-base.prompt";
export * from "./system/memory-injection.prompt";
export * from "./system/platform-rules-injection.prompt";
export * from "./system/compose";

// Tool prompts（feat-300.2 迁移）
export * from "./tools/generate-draft.prompt";
export * from "./tools/refine-draft.prompt";
export * from "./tools/critic-review.prompt";

// Context manager
export * from "./context/compress-summary.prompt";
