/**
 * IngestionController — feat-200.2 Week 2
 *
 *   GET /projects/:projectId/ingestion              列出近 100 条 job
 *   GET /projects/:projectId/ingestion/:jobId       轮询查 job（curl 友好）
 *   GET /projects/:projectId/ingestion/:jobId/events  SSE 流（浏览器友好）
 *
 * SSE 设计：
 *   - 建立连接后立刻推一次"当前 snapshot"（避免前端刚连上就空白等）
 *   - 监听 EventEmitter 的 ingestion.progress / completed / failed 事件
 *   - 只放本 jobId 的事件穿过（按 jobId filter，避免一个项目所有 job 互相打扰）
 *   - 完成 / 失败后 complete() 关闭流；客户端 EventSource 自动重连可重新建连读最终态
 *   - 心跳：每 15s 推 keepalive comment（: \n\n），防 nginx 60s 超时
 *
 * 为什么用 RxJS Observable 而非裸 res.write：
 *   - NestJS @Sse 装饰器自动处理 Content-Type / SSE 帧格式 / 客户端断开清理
 *   - Observable 可与 EventEmitter 组合（fromEvent + merge + takeUntil）
 */

import {
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  MessageEvent,
  Param,
  Sse,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { defer, fromEvent, merge, Observable, of, interval } from "rxjs";
import { filter, map, switchMap, takeWhile } from "rxjs/operators";
import * as jwt from "jsonwebtoken";
import type { Request } from "express";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { IngestionService } from "./ingestion.service";
import {
  INGESTION_EVENT,
  type IngestionCompletedEvent,
  type IngestionFailedEvent,
  type IngestionJobRow,
  type IngestionProgressEvent,
} from "./ingestion.types";

/** SSE 帧数据（NestJS @Sse 期望的 MessageEvent 形状，data 必须 string|object） */
interface SseFrame extends MessageEvent {
  type: "snapshot" | "progress" | "completed" | "failed" | "keepalive";
  data: object;
}

// ──────────────────────────────────────────────────────────────────────────────
// 自定义参数装饰器：从 header 或 ?token= 取 JWT，校验后注入 RequestUser
// 必须在 @Controller class 之前声明（class decorator 在类定义时执行，
// const 写在文件末尾会触发 TDZ ReferenceError）
// ──────────────────────────────────────────────────────────────────────────────
export const CurrentUserOrQueryToken = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const headerToken = (() => {
      const h = req.headers.authorization;
      if (!h) return null;
      const m = /^Bearer\s+(.+)$/i.exec(h.trim());
      return m ? m[1] : null;
    })();
    const queryTokenRaw = (req.query as Record<string, unknown>).token;
    const queryToken = typeof queryTokenRaw === "string" ? queryTokenRaw : null;
    const token = headerToken ?? queryToken;
    if (!token) throw new UnauthorizedException("缺少 token");

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException("JWT_SECRET 未配置");
    }
    try {
      const payload = jwt.verify(token, secret) as {
        sub: string;
        email: string;
      };
      return { id: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedException("无效或过期的 token");
    }
  },
);

@ApiTags("ingestion")
@ApiBearerAuth()
@Controller("projects/:projectId/ingestion")
export class IngestionController {
  constructor(
    private readonly jobs: IngestionService,
    private readonly eventBus: EventEmitter2,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
  ) {
    const jobs = await this.jobs.listByProject(user.id, projectId);
    return { jobs };
  }

  @Get(":jobId")
  @UseGuards(JwtAuthGuard)
  async getJob(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ) {
    const job = await this.jobs.getJob(user.id, projectId, jobId);
    return { job };
  }

  /**
   * SSE 端点。
   *
   * 鉴权权衡：原生 EventSource 不支持自定义 header，无法带 Bearer token。
   * Week 2 MVP 把 token 作为 query 参数 `?token=` 走，前端 fetch + ReadableStream
   * 或第三方 polyfill (eventsource) 走 header。
   *
   * 这里两条都允许：
   *   - header `Authorization: Bearer ...`（curl / 自定义 fetch 用）
   *   - query `?token=...`（浏览器原生 EventSource 用）
   *
   * **不用 @UseGuards(JwtAuthGuard)**：guard 只识别 header，会 401。
   * 我们手动校验。
   */
  @Sse(":jobId/events")
  events(
    @CurrentUserOrQueryToken() user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ): Observable<SseFrame> {
    // 用 defer 把 await 推到 subscribe 时执行，避免 Promise<Observable> 让
    // @Sse 装饰器与全局 Interceptor 间出现"headers already sent"竞态
    return defer(async () => {
      const initial = await this.jobs.getJob(user.id, projectId, jobId);
      return this.buildSseStream(jobId, initial);
    }).pipe(switchMap((stream$) => stream$));
  }

  private buildSseStream(
    jobId: string,
    initial: IngestionJobRow,
  ): Observable<SseFrame> {
    const progress$ = fromEvent<IngestionProgressEvent>(
      this.eventBus,
      INGESTION_EVENT.progress,
    ).pipe(
      filter((e) => e.jobId === jobId),
      map<IngestionProgressEvent, SseFrame>((e) => ({
        type: "progress",
        data: e,
      })),
    );

    const completed$ = fromEvent<IngestionCompletedEvent>(
      this.eventBus,
      INGESTION_EVENT.completed,
    ).pipe(
      filter((e) => e.jobId === jobId),
      map<IngestionCompletedEvent, SseFrame>((e) => ({
        type: "completed",
        data: e,
      })),
    );

    const failed$ = fromEvent<IngestionFailedEvent>(
      this.eventBus,
      INGESTION_EVENT.failed,
    ).pipe(
      filter((e) => e.jobId === jobId),
      map<IngestionFailedEvent, SseFrame>((e) => ({
        type: "failed",
        data: e,
      })),
    );

    const keepalive$ = interval(15000).pipe(
      map<number, SseFrame>(() => ({
        type: "keepalive",
        data: { ts: Date.now() },
      })),
    );

    // snapshot 起手 → 合并三路事件 + 心跳，遇到 completed/failed 停止
    const snapshot$: Observable<SseFrame> = of({
      type: "snapshot" as const,
      data: initial,
    });

    // 如果一连上 job 已是终止态：发 snapshot + 终态事件，流自然 complete
    if (initial.status === "succeeded" || initial.status === "failed") {
      const terminal: SseFrame = {
        type: initial.status === "succeeded" ? "completed" : "failed",
        data: {
          jobId: initial.id,
          projectId: initial.projectId,
          documentId: initial.documentId,
          ...(initial.status === "failed"
            ? { stage: initial.currentStage, error: initial.error }
            : {
                chunksTotal: initial.chunksTotal,
                costUsd: initial.costUsd,
              }),
        },
      };
      return merge(snapshot$, of(terminal));
    }

    return merge(snapshot$, progress$, completed$, failed$, keepalive$).pipe(
      // takeWhile inclusive=true：completed/failed 帧也发出去再关闭流
      takeWhile((f) => f.type !== "completed" && f.type !== "failed", true),
    );
  }
}
