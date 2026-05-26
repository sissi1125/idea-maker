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

    // 客户端可以通过 header 关联日志（如 Grafana 上钻）
    res.setHeader("x-trace-id", traceId);

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
