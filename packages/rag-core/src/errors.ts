/**
 * Pipeline 统一错误类型。
 *
 * 设计原则：rag-core 是纯库（无 HTTP 概念），不应该 throw NextResponse 或 status code。
 * 它只抛带语义 code 的错误，由 web 路由层翻译成 HTTP 状态码和 JSON envelope。
 *
 * 映射约定（在 apps/web 路由层实现）：
 *   missing_input / invalid_params / missing_upstream  → 400
 *   document_not_found / not_found                     → 404
 *   dimension_mismatch / conflict                      → 409
 *   provider_error / db_error                          → 502
 *   internal_error / 其他                              → 500
 */
export class PipelineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export function isPipelineError(err: unknown): err is PipelineError {
  return err instanceof PipelineError;
}
