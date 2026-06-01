/**
 * AgentController — feat-300.3 任务 7
 *
 * 6 个端点：
 *   POST   /projects/:pid/agent/run                启动 run，返回 { runId, generationId }
 *   GET    /projects/:pid/agent/runs/:runId/stream  SSE 流（事件 step/cost/finish/error + heartbeat）
 *   GET    /projects/:pid/agent/runs/:runId         run 元数据
 *   GET    /projects/:pid/agent/runs/:runId/steps   完整 trace 列表（分页）
 *   GET    /projects/:pid/agent/runs/:runId/steps/:idx/spill  读 spill 全文
 *   DELETE /projects/:pid/agent/runs/:runId         abort
 *
 * 鉴权：常规端点用 @UseGuards(JwtAuthGuard)；SSE 用 CurrentUserOrQueryToken
 * （沿用 ingestion 模块约定，EventSource 不支持自定义 header）。
 *
 * DB 连接：POST 启动用 DbService.withClient 包整个 run（feat-300.3-plan §3.6）；
 * GET 端点也走 withClient，但每次新连接（短查询）。
 *
 * 错误处理：业务异常透传 NotFoundException / UnauthorizedException；
 * AgentRunner 自己已脱敏内部错误为 "Internal error: $eventId"。
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Observable, defer, switchMap } from "rxjs";

import { DbService } from "../db/db.service";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { CurrentUserOrQueryToken } from "../ingestion/ingestion.controller";

import { AgentRunnerService } from "./agent-runner.service";
import { AgentRunsRepository } from "./agent-runs.repository";
import { AgentSseService, type AgentSseFrame } from "./agent-sse.service";
import { SpillStorage } from "./spill-storage.service";
import type { AgentRunInput, ChatMessage } from "./agent.types";

interface RunBody {
  messages: ChatMessage[];
  budgetUsd?: number;
  maxSteps?: number;
  modelOverride?: string;
}

@ApiTags("agent")
@ApiBearerAuth()
@Controller("projects/:projectId/agent")
export class AgentController {
  constructor(
    private readonly db: DbService,
    private readonly runner: AgentRunnerService,
    private readonly repo: AgentRunsRepository,
    private readonly sse: AgentSseService,
    private readonly spill: SpillStorage,
  ) {}

  /**
   * 启动 agent run（feat-300.6 修复：真正的非阻塞启动）。
   *
   * 设计：POST 启动 + GET /stream 流——这是 EventSource 不支持 POST body 的标准绕过。
   *
   * **关键修复**（vs 原实现）：原 `runner.run` 阻塞到整个 ReAct 跑完才返回 → 前端
   * 拿到 runId 时 run 已结束 → SSE 流空。
   *
   * 现在用 `runner.startInBackground`：
   *   - 几十毫秒内（仅等 createRun DB 写入）返回 { runId, generationId }
   *   - 余下 ReAct 在后台进程跑（Node 单进程，promise chain 不被 GC，进程不会因
   *     主请求结束而退出——这是 Node async 模型的天然属性）
   *   - SSE 事件持续推；DELETE /runs/:id 仍可 abort
   *
   * 错误语义：
   *   - 在 ids ready 之前的错误（鉴权/settings/memory 加载失败）→ 冒泡到本 HTTP 响应
   *   - ids ready 之后的错误 → 后端记 agent_runs.error + 通过 SSE error 帧推前端
   */
  @Post("run")
  @UseGuards(JwtAuthGuard)
  async startRun(
    @CurrentUser() user: RequestUser,
    @Param("projectId") projectId: string,
    @Body() body: RunBody,
  ) {
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new BadRequestException("messages 至少含 1 条 ChatMessage");
    }
    const input: AgentRunInput = {
      projectId,
      userId: user.id,
      messages: body.messages,
      budgetUsd: body.budgetUsd,
      maxSteps: body.maxSteps,
      modelOverride: body.modelOverride,
    };
    return this.runner.startInBackground(input);
  }

  /**
   * SSE 流端点。EventSource 不支持自定义 header，所以走 ?token= 鉴权
   * （沿用 ingestion 同款 CurrentUserOrQueryToken 装饰器）。
   *
   * 返回 Observable，NestJS @Sse 自动转换为 SSE 帧格式。
   * 心跳 + 自动关流由 AgentSseService 负责。
   */
  @Sse("runs/:runId/stream")
  stream(
    @CurrentUserOrQueryToken() _user: RequestUser, // 鉴权侧效，user.id 不在 stream 里用
    @Param("projectId") _projectId: string,
    @Param("runId") runId: string,
  ): Observable<AgentSseFrame> {
    // 用 defer 把订阅推迟到客户端连上 SSE 才开始——避免连接前 EventEmitter 事件丢失
    return defer(() => Promise.resolve(this.sse.subscribe(runId))).pipe(
      switchMap((s$) => s$),
    );
  }

  /** 获取 run 元数据（status / cost / finish_reason / 时间戳）。 */
  @Get("runs/:runId")
  @UseGuards(JwtAuthGuard)
  async getRun(
    @CurrentUser() _user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    return this.db.withClient(async (pgClient) => {
      const run = await this.repo.getRun(pgClient, runId);
      if (!run) throw new NotFoundException("agent run 不存在");
      if (run.projectId !== projectId) throw new NotFoundException("agent run 不存在");
      return run;
    });
  }

  /** 获取完整 step 列表（前端 trace 回放）。 */
  @Get("runs/:runId/steps")
  @UseGuards(JwtAuthGuard)
  async getSteps(
    @CurrentUser() _user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.db.withClient(async (pgClient) => {
      const run = await this.repo.getRun(pgClient, runId);
      if (!run || run.projectId !== projectId) {
        throw new NotFoundException("agent run 不存在");
      }
      return this.repo.getSteps(pgClient, runId, {
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
    });
  }

  /**
   * 读取某 step 落盘的完整 payload。
   *
   * 路径在 step.output._spill.path（agent-runner.service.ts 写入）。
   * SpillStorage.read 已做路径白名单校验。
   */
  @Get("runs/:runId/steps/:stepIndex/spill")
  @UseGuards(JwtAuthGuard)
  async getSpill(
    @CurrentUser() _user: RequestUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Param("stepIndex") stepIndex: string,
  ) {
    const idx = parseInt(stepIndex, 10);
    if (Number.isNaN(idx)) throw new BadRequestException("stepIndex 必须是数字");

    return this.db.withClient(async (pgClient) => {
      const run = await this.repo.getRun(pgClient, runId);
      if (!run || run.projectId !== projectId) {
        throw new NotFoundException("agent run 不存在");
      }
      const steps = await this.repo.getSteps(pgClient, runId);
      const step = steps.find((s) => s.stepIndex === idx);
      if (!step) throw new NotFoundException("step 不存在");

      const output = step.output as { _spill?: { path?: string } } | null;
      const spillPath = output?._spill?.path;
      if (!spillPath) {
        throw new NotFoundException("该 step 没有 spill 落盘内容");
      }
      const payload = await this.spill.read(spillPath);
      return { payload };
    });
  }

  /**
   * Abort 一个正在跑的 run。
   *
   * 204 No Content 表示成功；404 表示 runId 未注册（已经跑完或不存在）。
   */
  @Delete("runs/:runId")
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  abort(
    @CurrentUser() _user: RequestUser,
    @Param("projectId") _projectId: string,
    @Param("runId") runId: string,
  ): void {
    const aborted = this.runner.abort(runId);
    if (!aborted) throw new NotFoundException("agent run 不在运行中");
  }
}
