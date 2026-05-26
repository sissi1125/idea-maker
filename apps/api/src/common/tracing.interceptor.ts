/**
 * TracingInterceptor — feat-200.1 Week 1
 *
 * 每个 HTTP 请求做三件事：
 *   1. 生成 traceId（uuid v4），写到 response header `x-trace-id`
 *   2. 在 TraceContextService 内开一个 AsyncLocalStorage 上下文
 *   3. 请求结束后打 access log（方法 / 路径 / 状态 / 耗时 / cost）
 *
 * Week 3 起 pipeline-orchestrator 在调 LLM 时通过 TraceContextService.addCost() 累计，
 * 这里只需要在最后读出来打日志。
 *
 * 注意：不写错误处理（让 PipelineExceptionFilter 处理），但 tap 的 error 路径仍要打日志
 * 否则失败请求看不到 trace。
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { TraceContextService } from "./trace-context.service";

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly tracer: TraceContextService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const traceId = randomUUID();
    const startedAt = Date.now();

    // SSE 路由的特殊处理：NestJS @Sse 内部会在 interceptor 执行*之前*就把 SSE 响应头
    // (Content-Type: text/event-stream) 写到 res，此时 res.headersSent=true。
    // 若再调 res.setHeader 会抛 "Cannot set headers after they are sent to the client"，
    // 该异常进入全局 ExceptionFilter，filter 再调 res.json 又触发同一错误，最终被 NestJS
    // 的 SSE 流封装成 `event: error` 帧返回，导致客户端只能收到一条错误而看不到 progress。
    //
    // 修法：
    //   1. setHeader 时若 headersSent 已 true，跳过（SSE 不需要客户端读 x-trace-id）
    //   2. SSE 路由不挂 tap（每帧 emit 触发 access log 也无意义），只起 ALS 上下文
    if (!res.headersSent) {
      res.setHeader("x-trace-id", traceId);
    }

    // originalUrl 含 query string，取 path 部分判断
    const path = req.originalUrl.split("?")[0];
    const isSse =
      path.endsWith("/events") ||
      (req.headers.accept ?? "").includes("text/event-stream");
    if (isSse) {
      console.log(`[trace] ${traceId} ${req.method} ${path} [sse-open]`);
      return this.tracer.run(traceId, () => next.handle());
    }

    return this.tracer.run(traceId, () =>
      next.handle().pipe(
        tap({
          next: () => {
            const durationMs = Date.now() - startedAt;
            const cost = this.tracer.current()?.cost;
            const costStr = cost && cost.costUsd > 0 ? ` cost=$${cost.costUsd.toFixed(4)}` : "";
            console.log(
              `[trace] ${traceId} ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms${costStr}`,
            );
          },
          error: (err: unknown) => {
            const durationMs = Date.now() - startedAt;
            const status =
              (err as { status?: number; getStatus?: () => number })?.getStatus?.() ??
              (err as { status?: number }).status ??
              500;
            console.error(
              `[trace] ${traceId} ${req.method} ${req.originalUrl} ${status} ${durationMs}ms err=${(err as Error).message ?? err}`,
            );
          },
        }),
      ),
    );
  }
}
