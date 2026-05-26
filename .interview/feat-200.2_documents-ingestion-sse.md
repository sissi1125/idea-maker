# feat-200.2 面试题：Documents + Ingestion Job + SSE Progress

> Idea-Maker MVP Week 2。本题面向"讲清楚文件上传、异步处理、实时推送如何串起来"的求职/学习场景，
> 答案结合本项目实际代码（`apps/api/src/mvp-documents|ingestion|common/`）。

---

## 1. SSE（Server-Sent Events）vs WebSocket，为什么进度推送选 SSE？

**答**：

| 维度 | SSE | WebSocket |
|---|---|---|
| 方向 | 单向（服务端→客户端） | 双向 |
| 协议 | 普通 HTTP/1.1（text/event-stream） | 独立协议（ws://），需要 Upgrade |
| 重连 | 浏览器 EventSource 内建自动重连 + Last-Event-ID | 需自己实现 |
| 基础设施兼容 | 过 CDN / Nginx / 负载均衡无需特殊配置 | 需 WebSocket sticky session 或独立通道 |
| NestJS 支持 | `@Sse` 装饰器一行搞定 | 需要 `@WebSocketGateway` + adapter |

本项目进度推送是纯单向（服务端告诉客户端 0→100%），不需要客户端发消息给服务端。SSE 足矣，且：
- Nginx 默认支持 long-lived HTTP，不需要 `proxy_set_header Upgrade`
- 内建重连意味着网络闪断后客户端自动重新订阅，读到最终态 snapshot
- 实现成本：一个 `Observable<MessageEvent>` + `@Sse` 装饰器

**什么时候换 WebSocket**：Phase 3 Studio 需要双向协作编辑（CRDT / OT），那时会引入 WebSocket。

---

## 2. NestJS `@Sse` 装饰器 + 全局 Interceptor 的"headers already sent"问题是怎么产生的？如何修复？

**答**：

**问题根因**：NestJS 的 `@Sse` 处理流程与直觉相反——它在 interceptor 执行 **之前** 就写好了 `Content-Type: text/event-stream` 等响应头（`res.headersSent = true`）。当 TracingInterceptor 试图 `res.setHeader("x-trace-id", traceId)` 时，Node.js 抛出 "Cannot set headers after they are sent to the client"。

**连锁反应**：
1. 异常被 PipelineExceptionFilter 捕获
2. Filter 试图 `res.json(...)` 写错误响应 → 又触发同样的 headers sent 错误
3. NestJS SSE 流封装把未处理异常包成 `event: error` 帧返回客户端
4. 客户端只收到一条错误帧，看不到任何 progress

**三层修复**：

```typescript
// 1. TracingInterceptor：跳过已发送 header 的响应
if (!res.headersSent) {
  res.setHeader("x-trace-id", traceId);
}

// 2. TracingInterceptor：SSE 路由不挂 tap（避免每帧触发 access log）
const isSse = path.endsWith("/events") ||
  (req.headers.accept ?? "").includes("text/event-stream");
if (isSse) {
  return this.tracer.run(traceId, () => next.handle());
}

// 3. PipelineExceptionFilter：流式响应中不再尝试写 JSON
if (res.headersSent) {
  console.error("[filter] 流式响应中发生错误，跳过 res.json:", msg);
  return;
}
```

**面试加分点**：这类 bug 的调试方法论——逐步隔离。先把 interceptor 摘掉验证 SSE 本身能跑，确认是 interceptor 引入的问题后，加 debug log 定位到 `res.headersSent` 状态。

---

## 3. EventEmitter2（进程内）vs 外部消息队列（BullMQ / RabbitMQ），MVP 阶段为什么选前者？升级触发器是什么？

**答**：

**当前选择**：`@nestjs/event-emitter`（基于 eventemitter2）

| 考量 | EventEmitter2 | BullMQ (Redis) |
|---|---|---|
| 依赖 | 0 外部依赖 | 需要 Redis 实例 |
| 部署复杂度 | 单进程即可 | Redis 需持久化配置、监控 |
| 可靠性 | 进程崩 = 事件丢 | 持久化 + 自动重试 |
| 水平扩展 | 单进程内（同 worker 才能收到事件） | 多 worker 天然支持 |
| 可观测 | console.log 即可 | 需 BullBoard / Redis Insight |

MVP 阶段单实例部署，ingestion job 从 `setImmediate` 启动到完成全在同一进程。EventEmitter 的"不持久化、不跨进程"在此场景下不是缺点，反而是优点（零基础设施成本）。

**升级触发器**（任一命中即换）：
1. **多实例部署**：Kubernetes 多 Pod → 事件只在本 Pod 可见，SSE 连接可能落在另一个 Pod
2. **重试需求**：embedding API 限流 / 超时后需要自动重试，EventEmitter 没有 retry 机制
3. **任务积压**：同时上传 50+ 文档，单进程 CPU 打满 → 需要独立 worker 消费

Plan 把 BullMQ 迁移安排在 **Phase 4 工程化** 阶段。

---

## 4. 为什么 `@Sse events()` 方法用 `defer + switchMap` 包裹而不是直接 `async`？

**答**：

NestJS `@Sse` 装饰器期望方法返回 `Observable<MessageEvent>`，而不是 `Promise<Observable<MessageEvent>>`。

如果写成：
```typescript
@Sse(":jobId/events")
async events(...): Promise<Observable<SseFrame>> {
  const initial = await this.jobs.getJob(...);
  return this.buildSseStream(jobId, initial);
}
```

NestJS 会把这个 Promise resolve 后再订阅 Observable。**但**中间有一段时间（await 到 subscribe 之间）是"无人监听"状态，如果 EventEmitter 在这段窗口 emit 了事件，就永久丢失。

正确做法：
```typescript
@Sse(":jobId/events")
events(...): Observable<SseFrame> {
  return defer(async () => {
    const initial = await this.jobs.getJob(...);
    return this.buildSseStream(jobId, initial);
  }).pipe(switchMap((stream$) => stream$));
}
```

`defer` 把 async 逻辑推迟到 NestJS subscribe 那一刻才执行，确保 Observable 链条是同步返回的。`switchMap` 把内层 Observable "拍平"成外层流。

**核心原则**：RxJS 世界里"数据什么时候产生"取决于"什么时候 subscribe"，`defer` 是让 async 初始化与 subscribe 时机对齐的标准模式。

---

## 5. `forwardRef` 解决循环依赖的原理是什么？有更好的架构替代吗？

**答**：

**问题场景**：
- `MvpDocumentsModule` 需要 `IngestionService`（上传后自动触发 ingestion）
- `IngestionModule` 需要 `MvpDocumentsService`（ingestion 完成后更新 document 状态）

这形成 A imports B、B imports A 的循环。

**`forwardRef` 原理**：
```typescript
@Module({
  imports: [forwardRef(() => MvpDocumentsModule)],
})
export class IngestionModule {}
```

`forwardRef` 不在模块加载阶段求值，而是返回一个 thunk。NestJS DI 容器在完成所有模块注册后，第二遍遍历时才调用 `() => MvpDocumentsModule`，此时对方已经注册完毕。本质上是把"加载时依赖"变成"运行时依赖"。

**更好的架构替代**：

1. **Event-driven 解耦**（本项目已部分采用）：
   - 上传完成后 emit `ingestion.start` 事件，IngestionModule 监听并启动 job
   - Ingestion 完成后 emit `ingestion.completed`，DocumentsModule 监听并更新状态
   - 两个 module 互不 import，只共享事件类型定义

2. **抽取第三方 module**：把共用逻辑（如状态更新）下沉到 `SharedModule`，两边都 import 它

本项目 MVP 选 forwardRef 是因为已经写好了直接方法调用的代码，Week 2 时间紧。Phase 4 重构时会完全切到事件驱动模式。

---

## 6.（加分题）Multipart 文件上传的 `FileInterceptor` 在 NestJS 中如何工作？生产环境有哪些安全隐患需要防范？

**答**：

**工作原理**：
- `FileInterceptor("file")` 基于 multer 中间件
- 请求 `Content-Type: multipart/form-data` 时，multer 解析 boundary，按 field name 提取文件流
- 文件默认存在内存（`memoryStorage`），也可配 `diskStorage`
- 解析完后把 `Express.Multer.File` 对象挂到 `req.file`，NestJS 通过 `@UploadedFile()` 装饰器注入

**生产安全隐患**：

| 风险 | 防范措施 |
|---|---|
| **文件炸弹**（几 GB 上传撑爆内存） | `limits: { fileSize: 50 * 1024 * 1024 }` 限制单文件 50MB |
| **恶意文件名**（路径穿越 `../../etc/passwd`） | 服务端不用原始文件名存储，而是 `uuid + 后缀` |
| **MIME 类型欺骗**（改 Content-Type 绕过白名单） | 不信任 `mimetype` 字段，用 magic bytes 检测真实类型 |
| **Zip 炸弹**（解压后放大 1000x） | 解压前检查 ratio / 解压后大小上限 |
| **DoS（并发大量上传）** | 限流中间件 + 队列排队 |
| **临时文件残留** | 确保 finally 块清理 diskStorage 临时文件 |

本项目当前：
- 使用 memoryStorage（文件 < 50MB 可接受）
- 存储到本地 `UPLOAD_ROOT`，文件名 = `${documentId}/${originalname}`
- TODO Week 5：换 S3 presigned URL 直传，API 服务器不经手文件字节流

代码位置：[apps/api/src/mvp-documents/mvp-documents.controller.ts](apps/api/src/mvp-documents/mvp-documents.controller.ts)
