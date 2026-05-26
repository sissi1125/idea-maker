/**
 * PipelineException Filter
 *
 * 把 rag-core 抛出的 PipelineError 翻译成 HTTP envelope，
 * 与 apps/web 的 Next.js routes 保持完全一致的响应结构（envelope.error.code/message/details）。
 *
 * 状态码映射：参考 apps/web 各 pipeline route 的 PIPELINE_ERROR_STATUS。
 * 这里集中维护，避免 controller 重复。
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { isPipelineError } from "@harness/rag-core";
import { ZodError } from "zod";
import type { Response } from "express";

/**
 * 全局 code → HTTP status 表。
 * 来源：apps/web 各 route 的状态码映射并集（feat-100.2 已统一过模式）。
 */
const PIPELINE_ERROR_STATUS: Record<string, number> = {
  // 400 — 客户端输入问题
  empty_chunks: 400,
  empty_queries: 400,
  empty_prompt: 400,
  empty_text: 400,
  missing_endpoint: 400,
  missing_connection: 400,
  invalid_model: 400,
  invalid_params: 400,
  // 401 / 429 — 鉴权 / 限流
  api_auth_failed: 401,
  rate_limited: 429,
  // 409 — 状态冲突（如向量维度不匹配）
  dimension_mismatch: 409,
  // 500 — 注入缺失（路由层应该提供但没提供）
  missing_client: 500,
  vector_count_mismatch: 500,
  // 502 — 上游 provider 故障
  provider_error: 502,
  llm_failed: 502,
};

@Catch()
export class PipelineExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // 已经开始流式响应（SSE / chunked）后再调 res.json 会触发
    // "Cannot set headers after they are sent to the client"。
    // 此时只记录日志，让响应自然结束。
    if (res.headersSent) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[pipeline-exception-filter] 流式响应中发生错误，跳过 res.json:", msg);
      return;
    }

    // 0. ZodError — 参数校验失败，统一翻成 400 invalid_params
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: "invalid_params",
          message: err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
        },
      });
    }

    // 1. PipelineError — 业务域错误
    if (isPipelineError(err)) {
      const status = PIPELINE_ERROR_STATUS[err.code] ?? 500;
      return res.status(status).json({
        error: { code: err.code, message: err.message, ...(err.details ?? {}) },
      });
    }

    // 2. NestJS HttpException（如 ValidationPipe 抛的 BadRequestException）
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const resp = err.getResponse();
      const message =
        typeof resp === "string" ? resp : (resp as { message?: unknown }).message ?? err.message;
      const code =
        status === 400
          ? "invalid_input"
          : status === 401
            ? "unauthorized"
            : status === 404
              ? "not_found"
              : "http_error";
      return res.status(status).json({
        error: { code, message: Array.isArray(message) ? message.join("; ") : message },
      });
    }

    // 3. 兜底 — 其他未知错误
    const message = err instanceof Error ? err.message : String(err);
    return res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: "internal_error", message } });
  }
}
