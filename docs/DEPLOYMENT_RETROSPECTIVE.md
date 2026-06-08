# 部署复盘：从 0 到生产的 11 个坑

> **日期**：2026-06-07 ~ 2026-06-08
> **目标**：feat-013.5 上线 — Vercel 前端 + 阿里云 ECS 后端 + Cloudflare Named Tunnel
> **耗时**：约 1.5 天（含 NS 切换等待）
> **价值**：每个坑都是「本地能跑、上线翻车」的典型，提炼成 CI/工程化反思

---

## 0. 架构变更概览

| 维度 | 计划方案（DEPLOY-PLAN.md） | 实际方案 |
|---|---|---|
| 前端部署 | ECS 同机 Next.js 容器 + Caddy 反代 | **Vercel CDN**（独立部署） |
| 后端反代 | Caddy + Let's Encrypt 自动 SSL | **Cloudflare Named Tunnel**（无入站端口、无备案） |
| Embedding | 本地 ollama bge-m3（600MB RAM） | **智谱云端 embedding-3**（按量计费） |
| ECS 规格 | 2C/4GB（推荐） | **1C/2GB**（实际，靠云端 embedding 节省内存） |
| 域名要求 | 必须有备案的公网域名 | **任何 TLD，无需备案**（Cloudflare 托管） |

---

## 1. 11 个坑的踩坑日志

### 坑 1：NestJS build 漏 YAML 资源

**现象**：生产容器启动崩
```
ERROR [ExceptionHandler] default.yaml 未找到，搜索路径：/app/dist/pipeline-orchestrator/pipelines/default.yaml
```

**根因**：`nest build` 底层是 `tsc`，**只编译 `.ts`，不复制非代码资源**。本地 `pnpm start:dev` 用 ts-node 直接从 `src/` 读 yaml，掩盖了问题。

**修复**：[apps/api/nest-cli.json](apps/api/nest-cli.json) 加 `assets` 声明
```json
"compilerOptions": {
  "assets": [
    { "include": "**/*.yaml", "outDir": "dist" }
  ]
}
```

**反思**：「资源文件」是构建系统盲区。每次引入非 ts 资源（proto / hbs / json schema）都要重新审视 `nest-cli.json`。

---

### 坑 2：phantom dependency（Buffer 类型）

**现象**：Docker 构建报
```
src/pipeline/preprocess.ts(81,13): error TS2580: Cannot find name 'Buffer'.
Do you need to install type definitions for node?
```

**根因**：`shared-types` 包用了 `Buffer` 但 `package.json` 没声明 `@types/node`。本地能编译是因为 pnpm 把别的包的 `@types/node` 透传过来了——典型 **phantom dependency**。Docker `pnpm install --frozen-lockfile` 严格隔离，phantom 立刻暴露。

**修复**：[packages/shared-types/package.json](packages/shared-types/package.json) 加 `@types/node: ^22`。

**反思**：CI / Docker 构建是依赖卫生的最佳检测场所。

---

### 坑 3：pnpm hoist 长期掩盖

**现象**：解决坑 2 后，怀疑还有其他 phantom

**修复**：[pnpm-workspace.yaml](pnpm-workspace.yaml) 加
```yaml
publicHoistPattern: []
```

**反思**：默认 hoist 让 monorepo「能跑」但藏 bug。零 hoist 一开始痛，长期稳。

---

### 坑 4：Vercel 装不到 devDependencies（TypeScript）

**现象**：Vercel build 报
```
sh: line 1: tsc: command not found
```

**根因**：Vercel 默认 `NODE_ENV=production`，pnpm 跳过 devDeps，`typescript` 装不上。

**修复**：Install Command 加 `--prod=false`：
```
cd ../.. && pnpm install --frozen-lockfile --prod=false
```

**反思**：「平台默认值」与「项目约定」错位的经典案例。Render / Heroku / Vercel 都有类似坑。

---

### 坑 5：Postgres 密码含 URL 特殊字符

**现象**：`password authentication failed`，但密码看起来对

**根因**：`openssl rand -base64` 输出包含 `+ / =`，在 `DATABASE_URL=postgresql://user:pwd@host:port` 里被 URL 解析器扭曲（`+`=空格、`=`=分隔符）。

**修复**：改用 `openssl rand -hex 24`（纯 hex，无特殊字符）。

**反思**：连接字符串 = URL，凡含密码必 URL-encode 或避特殊字符。

---

### 坑 6：Postgres 卷已初始化，改 .env 无效

**现象**：改了 `.env` 的 `DB_PASSWORD`，api 还是连不上

**根因**：`POSTGRES_PASSWORD` **只在数据卷第一次初始化时生效**。改 env 不会改 postgres user 的实际密码。

**修复**：`docker compose down` + `docker volume rm idea-maker_postgres_data` 删卷重建。

**反思**：状态化容器的「初始化密码」是个一次性接口，不是配置同步接口。生产环境想改密码用 `ALTER USER`，不要重启大法。

---

### 坑 7：国内镜像加速器缓存远古版本

**现象**：cloudflared 容器启动报 `x509: certificate has expired`，版本号显示 `2020.7.0`

**根因**：阿里云 docker 镜像加速器把 `cloudflare/cloudflared:latest` 缓存成了 6 年前的版本，老根证书已过期。

**修复**：锁版本号
```yaml
image: cloudflare/cloudflared:2026.5.2
```

**反思**：**永远不用 `:latest`**。锁版本是稳定性 + 可复现的最低门槛。

---

### 坑 8：Quick Tunnel 重启 URL 变

**现象**：`docker compose down && up` 后 cloudflared 给的 `*.trycloudflare.com` URL 变了，Vercel 配的 `NEXT_PUBLIC_API_URL` 失效

**修复**：迁移到 Cloudflare **Named Tunnel** — 绑自有域名 `api.retreevo.online`，URL 永远不变。

**反思**：原型 → 生产的演进路径。Quick Tunnel 是「先跑通」的最佳选择，Named Tunnel 是「跑稳定」的最终形态。

---

### 坑 9：cloudflared volume 挂载与文件权限

**现象**：Named Tunnel 容器启动报
```
open /etc/cloudflared/config.yml: no such file or directory
... permission denied
```

**根因**：
- docker compose 里 `~/.cloudflared` 在 root 上下文展开不一致
- `/root/.cloudflared/` 目录权限 `700`，cloudflared 容器内非 root 用户进不去
- `<UUID>.json` 文件权限 `400`，others 无法读

**修复**：把凭证复制到 `/etc/cloudflared/`，权限 `755 / 644`，compose 用绝对路径。

**反思**：distroless 容器是「最小攻击面」的好做法，但要求挂载的文件权限明确开放。

---

### 坑 10：`.env` 里 `${VAR}` 不展开

**现象**：智谱 API 报 401，但 key 看起来对

**根因**：`.env` 里写 `EMBEDDING_API_KEY=${LLM_API_KEY}`，docker compose 读取时**不会展开**，字面值 `${LLM_API_KEY}` 这 16 个字符传给容器。

**修复**：填真实值，或在 compose 里写 `${EMBEDDING_API_KEY:-${LLM_API_KEY}}` 这样的 fallback。

**反思**：`.env` 是简单 KV 存储，不是 shell。变量复用要么明确填，要么靠 docker compose 的 YAML 默认值机制。

---

### 坑 11：2GB ECS 跑 bge-m3 OOM

**现象**：上传文档调 embedding 时 `llama-server process has terminated: signal: killed`

**根因**：bge-m3 加载需 ~600MB，加上 postgres + api + cloudflared，2GB 物理内存撑不住，OOM Killer 杀进程。

**修复**：迁移到**云端智谱 embedding-3**（1024 维兼容 schema），删 ollama 容器，省 ~600MB。
- 代价：网络 IO 延迟 + 按量付费（极便宜，¥0.0005/千 token）
- 收益：1C/2GB ECS 跑稳，不用升级硬件

**反思**：**用钱换资源 vs 用架构换资源**的经典权衡。简历项目演示稳定性 > 自托管完整度。

---

## 2. 这 11 个坑能怎么用 CI 提前发现？

| 坑类型 | CI 检测方式 |
|---|---|
| 坑 1（nest assets 漏） | CI 跑 `docker build` 而不只是 `pnpm build`，并启容器跑健康检查 |
| 坑 2、3（phantom dep） | `pnpm install --frozen-lockfile` + `publicHoistPattern: []` |
| 坑 4（devDeps 不装） | CI 复制 Vercel 的 `NODE_ENV=production` 环境跑 install |
| 坑 5（密码字符） | 用 `dotenv-linter` 或脚本检查 `.env.example` 字段 |
| 坑 6（postgres 初始化） | 加 `e2e/db-rotate-password.test.ts` 检验密码轮换流程 |
| 坑 7（镜像版本） | CI 静态分析 `docker-compose*.yml`，禁 `:latest` |
| 坑 8（quick tunnel） | 不是 bug 是设计选择，文档明确"仅原型期用" |
| 坑 9（权限） | distroless 容器加 `docker run --rm <image> ls /挂载点` 验证 |
| 坑 10（`${VAR}` 不展开） | `dotenv-linter` 静态分析 |
| 坑 11（OOM） | 容器加 mem_limit + healthcheck，CI 跑负载测试 |

可作为 **feat-014（工程化 epic）** 的工作清单。

---

## 3. 部署架构最终形态

```
浏览器 → Vercel CDN (Next.js)
         ↓ HTTPS
        https://api.retreevo.online
         ↓ DNS CNAME
        Cloudflare 边缘 (TLS 终结 + 自动 SSL)
         ↓ 加密隧道 (出站长连接，ECS 无入站端口)
        cloudflared 容器
         ↓ docker bridge
        api:3001 (NestJS) → postgres:5432 (pgvector)
                         ↓ 外部 HTTPS
                  智谱 GLM API (LLM + embedding-3)
```

**对外可见的所有 URL**：
- `https://idea-maker-web.vercel.app`（前端，Vercel 免费）
- `https://api.retreevo.online`（API，Cloudflare 免费托管）

**月成本**（实测）：
- ECS 1C/2GB：~¥30-80（包年）
- 域名 retreevo.online：~¥10/年（折合 ~¥1/月）
- 智谱按量：演示量 < ¥1/月
- Vercel / Cloudflare：免费
- **合计**：< ¥85/月

---

## 4. 简历讲故事的切入点

### 短版（30 秒）

> "做了一个 RAG + Agent 项目，部署架构是 Vercel 前端 + 阿里云 ECS 后端，中间用 Cloudflare Named Tunnel 串起来。两个关键决策：一是用 Tunnel 而不是 Caddy + Let's Encrypt——这样 ECS 不开任何入站端口、域名也不需要备案；二是 embedding 用云端智谱代替本地 ollama——这样 1C/2GB 的 ECS 就能跑得起来，月成本不到 100 块。整个过程踩了 11 个生产坑，每个都写进了 `docs/DEPLOYMENT_RETROSPECTIVE.md`。"

### 长版（关键问答）

| 面试官可能问 | 你的答 |
|---|---|
| 为什么不在 ECS 直接跑 Caddy？ | 国内大陆服务器对外提供 HTTP 服务要工信部备案。Cloudflare Tunnel 走出站连接，流量入口在 CF 边缘，技术上不算「在境内提供服务」，因此**无需备案**。 |
| 为什么不用 ollama？ | 1C/2GB ECS 跑 bge-m3 OOM。用钱换资源比升级硬件性价比高（智谱 embedding ¥0.0005/千 token，演示用量 < ¥1/月）。 |
| Quick Tunnel vs Named Tunnel？ | Quick 是 `trycloudflare.com` 子域，URL 随容器重启变；Named 是绑自有域名，固定。Quick 用来原型期快速跑通，Named 用来生产。 |
| 怎么知道 SSE 跨 Tunnel 没被缓冲？ | 浏览器 Agent Trace 实时一条条出现 reasoning / tool_call。如果被缓冲，会卡在「启动中」然后一次性吐全部。 |
| 改密码 / 加新环境变量怎么办？ | `.env` 改 → `docker compose up -d api`（重要：`restart` 不读 env，必须 `up -d`）。 |

---

## 5. 待办与后续

- [ ] feat-014（工程化）：把 11 个坑的 CI 检测写成具体 task
- [ ] 给 ECS 加 4GB swap，防 LLM 推理峰值 OOM
- [ ] cron 跑 `scripts/backup.sh`（DEPLOY-PLAN §10 已有模板）
- [ ] UptimeRobot 接入 `https://api.retreevo.online/health`
- [ ] 把 `https://idea-maker-web.vercel.app` 绑到自定义域名 `www.retreevo.online`
- [ ] `docs/DEPLOY-PLAN.md` Phase 2 章节更新（性能/容量/成本数据）

---

## 附录：本次涉及的关键 commits

按时间顺序，参见 `git log --oneline` 中以 `fix(deploy)` / `feat(deploy)` 开头的提交。
