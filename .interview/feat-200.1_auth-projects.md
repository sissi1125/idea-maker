# feat-200.1 面试题：Auth + Projects + Tracing

> Idea-Maker MVP Week 1。本题面向"准备讲清自己 MVP 后端如何搭起来"的求职/学习场景，
> 答案结合本项目实际代码（`apps/api/src/auth|projects|common|db/`）。

---

## 1. 为什么不用 `@nestjs/passport` + `@nestjs/jwt`，而是手写 `JwtAuthGuard` + `jsonwebtoken`？

**答**：

NestJS 生态里 `@nestjs/passport` 是惯例，但本项目选择手写有三个理由：

1. **依赖最少（MVP 原则）**：passport 需要装 `passport / passport-jwt / @nestjs/passport / @nestjs/jwt` 四个包 + 写 `JwtStrategy` 类 + 在 module 里 `PassportModule.register({...})`。等价功能用 `jsonwebtoken.sign/verify`（一行）+ 30 行 `JwtAuthGuard` 完成，可读性更高。
2. **JWT 流程极薄**：本项目 Week 1 只需要 sign / verify，不涉及 OAuth / 多 Strategy 切换 / refresh token。passport 的"多 Strategy 抽象"在这里属于过度设计。
3. **可观测性**：手写 guard 里抛 `UnauthorizedException("token 已过期")` vs `UnauthorizedException("无效的 token")`，能区分两种 401。passport-jwt 默认会把所有失败合并成"unauthorized"。

**风险**：如果 Phase 5 要换 OAuth / 第三方登录，重写 guard 是免不了的。但 plan 已经把 OAuth 推迟到 Phase 5，那时候顺手换 Lucia Auth 收益更高。

代码位置：[apps/api/src/auth/jwt-auth.guard.ts](apps/api/src/auth/jwt-auth.guard.ts)

---

## 2. 登录失败时为什么"邮箱不存在"和"密码错"返回同样的错误信息？

**答**：

防止**账户枚举攻击**（account enumeration）。如果区分：
- "用户不存在" → 攻击者拿一份邮箱字典扫一遍，能筛出哪些邮箱在系统中注册过
- "密码错误" → 确认目标邮箱有效，接下来集中精力撞密码

OWASP Top 10 在 Authentication 章节有专项说明（CWE-203 信息泄漏）。本项目 [auth.service.ts:login](apps/api/src/auth/auth.service.ts) 把两个分支都抛 `UnauthorizedException("邮箱或密码错误")`。

**进阶问题：响应时延也算枚举信号吗？**

是。如果用户不存在时跳过 bcrypt.compare，会比"用户存在 + 错密码"快几十毫秒。本项目 MVP 没做时延对齐，**Phase 5 可补**：用户不存在时仍跑一次 bcrypt.compare 跟一个 dummy hash，让两条路径耗时一致。

---

## 3. `project_settings.encrypted_api_key` 字段为什么是 TEXT 不是 BYTEA？AES-256 在 plan 里写明了，为什么 Week 1 不实现？

**答**：

**字段类型**：AES-GCM 输出（密文 + nonce + tag）是字节序列，理论上 BYTEA 更精确。但 TEXT + base64 编码有几个好处：
- pg.Client 默认把 BYTEA 返回成 `Buffer`，把 TEXT 返回成 `string`，TS 类型与 JSON 序列化更直观
- 调试时能直接 `psql ... SELECT encrypted_api_key` 看 base64 字符串，无需 hex dump
- 容量损失可忽略：AES-256 密文 + base64 通常 < 200 字节，远不到 NUMERIC 字段那种空间敏感场景

**为什么 Week 1 不实现 AES**：

Plan 把 BYOK 的 UI 输入 + 加密入库放在 **Week 5（Settings 页面）**。Week 1 只搭骨架，让 `PUT /projects/:id/settings` 能存 `encryptedApiKey` 字段。Week 5 在 Service 里加一层"写入前加密、读出时不解密给前端（只返回 `hasKey: true`）"。

**关键约定**：MVP 阶段 AES 主密钥放 `env.MASTER_KEY`（轮转通过双密钥过渡），Phase 5 才接 KMS。

---

## 4. `TracingInterceptor` + `AsyncLocalStorage` vs NestJS 自带的 REQUEST scope DI，为什么选前者？

**答**：

两种方案都能拿到"当前请求的 traceId"，但代价不同：

| 方案 | 优点 | 缺点 |
|---|---|---|
| **REQUEST scope DI** | NestJS 原生，类型友好 | **整条依赖链全部 scope 化**：被注入 REQUEST scoped service 的 service 也必须是 REQUEST scoped，每请求重建。性能下降 10-30%（NestJS 文档明说） |
| **AsyncLocalStorage** | 零开销，跨 async/await 自动传递；Node 16+ 内置 | 需手动 `tracer.run(...)`；从 ALS 取值时类型断言略繁琐 |

本项目 [common/trace-context.service.ts](apps/api/src/common/trace-context.service.ts) 用 ALS 是因为：
- pipeline-orchestrator（Week 3 加）跨多个 stage service async 调用，REQUEST scope 会让所有 stage service 实例化飙升
- ALS 是 OpenTelemetry / Pino-http 等成熟中间件的标准做法

**陷阱**：ALS 在 EventEmitter 回调里需要手动绑定（`als.bind(handler)`），否则 emit 异步触发后会丢上下文。Week 4 写 AutoGenerationService 监听 `ingestion.completed` 时要注意。

---

## 5. `DbService.withClient` 为什么每请求都 `new Client`，不用连接池？这对生产环境意味着什么？

**答**：

**当前实现**（[db.service.ts](apps/api/src/db/db.service.ts:48)）：

```ts
const client = new PgClient({ connectionString: cs });
await client.connect();
try { return await fn(client); }
finally { await client.end(); }
```

每请求 connect + end 的代价：
- TCP 握手：~1ms（本地）/ ~20-50ms（跨网络）
- TLS（生产必开）：再加 ~20-50ms
- Postgres backend fork：~5-10ms

MVP 阶段（每天 < 1000 请求）这个开销可忽略。**Week 3 后**（pipeline-orchestrator 一次 generate 跑 11 stage，假设每 stage 一次 DB 调用）累积延迟 100-500ms，必须换 `pg.Pool`。

**升级路径**：

```ts
// 切换到 Pool 只改一个文件
@Injectable()
export class DbService {
  private pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  async withClient(fn) {
    const client = await this.pool.connect();
    try { return await fn(client); }
    finally { client.release(); } // 不 end，归还到池
  }
}
```

因为业务代码统一走 `withClient((client) => ...)`，**0 行业务代码改动**。这就是"接口先于实现"的杠杆点：MVP 时拒绝引入 Pool 是为了避免 connection leak 调试，但留好升级位。

---

## 6.（加分题）为什么 DDL 写在 `apps/api/src/db/schema.ts` 而不是 migration 工具（Drizzle / Knex / TypeORM migrations）？trade-off 是什么？

**答**：

**MVP 选择 CREATE TABLE IF NOT EXISTS** 的考量：

| 方案 | MVP 适配 |
|---|---|
| DDL inline（本项目）| ✅ 零依赖；新部署直接拉起；schema 与代码同 PR review；Snapshot 数据库可丢可重建 |
| Drizzle migrations | ❌ 多 1-2 天搭工具链；Week 1 schema 变动频繁，每次 `pnpm drizzle-kit generate` 噪声大 |
| TypeORM | ❌ 引入 entity 装饰器后所有表都要走 ORM 风格，与 SnapshotsService 已有的"裸 SQL"风格分裂 |

**代价**：
- 改字段需要"先改 DDL → 删表 → 重启自动建"，**生产环境绝对不可用**
- 改列类型会被 `IF NOT EXISTS` 静默忽略
- 无法追踪 schema 历史

**升级触发器**：进入 Week 7 / Phase 4 时必须切到 migration 工具，因为：
- 用户实数据已经入库
- 多 worker / 多机部署后并发跑 DDL 会冲突

Plan 总文档 § "Phase 5 工程化" 写明了 **Drizzle Kit + drizzle-orm** 是终态。Week 1 这套 DDL 是个**临时脚手架**，跑通 MVP 后第一件事就是迁。

代码位置：[apps/api/src/db/schema.ts](apps/api/src/db/schema.ts)
