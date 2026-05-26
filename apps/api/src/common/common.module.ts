/**
 * CommonModule — feat-200.1 Week 1
 *
 * 把 TraceContextService / TracingInterceptor 放进全局模块，
 * 业务 module 不必显式 import。
 *
 * TracingInterceptor 通过 APP_INTERCEPTOR 全局注册（main.ts 也可走 useGlobalInterceptors，
 * 但走 module token 能享受 DI；TracingInterceptor 依赖 TraceContextService）。
 */

import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TraceContextService } from "./trace-context.service";
import { TracingInterceptor } from "./tracing.interceptor";

@Global()
@Module({
  providers: [
    TraceContextService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
  ],
  exports: [TraceContextService],
})
export class CommonModule {}
